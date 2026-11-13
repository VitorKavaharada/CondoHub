"""Regras de reserva que ficam no backend (modelagem_dados_fluxo_reserva.xlsx, aba Regras de negócio).

O banco garante a não sobreposição (EXCLUDE) e o aceite obrigatório; aqui ficam a grade de
horários, o prazo de antecedência, o limite por unidade, a autorização do morador e o
bloqueio por inadimplência da unidade.
"""

import calendar
import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import and_, func, or_, select

from app.context import Ctx
from app.core.models import AppUser, CondominiumUser, Unit, UnitResident
from app.core.service import manager_ids, notify
from app.enums import ACTIVE_RESERVATION_STATUSES, BookingMode, ReservationStatus
from app.errors import AppError, NotFound
from app.manutencao.models import MaintenanceLocation
from app.reservas.models import CondoSpace, Reservation, RulesDocument, SpaceBlock, TermsAcceptance
from app.reservas.schemas import (
    DayAvailability,
    DaySlots,
    MonthAvailability,
    ReservationCreate,
    ReservationUpdate,
    SlotOut,
    SpaceCreate,
    SpaceUpdate,
)

Interval = tuple[datetime, datetime]

# ---------------------------------------------------------------- áreas


def get_space(ctx: Ctx, space_id: uuid.UUID) -> CondoSpace:
    space = ctx.db.get(CondoSpace, space_id)
    if space is None or space.condominium_id != ctx.condominium_id:
        raise NotFound("Área")
    return space


def current_rules_document(ctx: Ctx, space_id: uuid.UUID) -> RulesDocument | None:
    return ctx.db.scalars(
        select(RulesDocument)
        .where(RulesDocument.condo_space_id == space_id, RulesDocument.published_at <= func.now())
        .order_by(RulesDocument.version.desc())
        .limit(1)
    ).first()


def current_block(ctx: Ctx, space_id: uuid.UUID) -> SpaceBlock | None:
    now = ctx.now()
    return ctx.db.scalars(
        select(SpaceBlock)
        .where(SpaceBlock.condo_space_id == space_id, SpaceBlock.starts_at <= now, SpaceBlock.ends_at > now)
        .order_by(SpaceBlock.ends_at.desc())
        .limit(1)
    ).first()


def create_space(ctx: Ctx, data: SpaceCreate) -> CondoSpace:
    space = CondoSpace(condominium_id=ctx.condominium_id, **data.model_dump())
    ctx.db.add(space)
    ctx.db.flush()
    # Toda área reservável também é um local de manutenção (preventivas por evento).
    ctx.db.add(MaintenanceLocation(condominium_id=ctx.condominium_id, name=space.name, condo_space_id=space.id))
    ctx.db.flush()
    return space


def update_space(ctx: Ctx, space: CondoSpace, data: SpaceUpdate) -> CondoSpace:
    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(space, field, value)
    if "name" in changes:
        location = ctx.db.scalars(select(MaintenanceLocation).where(MaintenanceLocation.condo_space_id == space.id)).first()
        if location is not None:
            location.name = space.name
    ctx.db.flush()
    ctx.db.refresh(space)
    return space


def publish_rules_document(ctx: Ctx, space: CondoSpace, **fields) -> RulesDocument:
    last = ctx.db.scalar(select(func.max(RulesDocument.version)).where(RulesDocument.condo_space_id == space.id))
    document = RulesDocument(
        condominium_id=ctx.condominium_id,
        condo_space_id=space.id,
        version=(last or 0) + 1,
        published_by=ctx.require_user(),
        **fields,
    )
    ctx.db.add(document)
    ctx.db.flush()
    ctx.db.refresh(document)
    return document


# ---------------------------------------------------------------- grade e disponibilidade


def day_start(day: date, ctx: Ctx) -> datetime:
    return datetime.combine(day, time.min, ctx.tz)


def day_slots(space: CondoSpace, day: date, ctx: Ctx) -> list[Interval]:
    """Blocos reserváveis do dia. Dia todo = [00:00, 00:00 do dia seguinte)."""
    if space.booking_mode == BookingMode.full_day:
        return [(day_start(day, ctx), day_start(day + timedelta(days=1), ctx))]
    step = timedelta(minutes=space.slot_minutes)
    start = datetime.combine(day, space.opens_at, ctx.tz)
    close = datetime.combine(day, space.closes_at, ctx.tz)
    slots = []
    while start + step <= close:
        slots.append((start, start + step))
        start += step
    return slots


def last_bookable_date(space: CondoSpace, ctx: Ctx) -> date:
    return ctx.now().date() + timedelta(days=space.booking_horizon_days)


def busy_intervals(
    ctx: Ctx, space_id: uuid.UUID, start: datetime, end: datetime, exclude_reservation: uuid.UUID | None = None
) -> tuple[list[Interval], list[Interval]]:
    """Reservas ativas e bloqueios da área que tocam [start, end)."""
    query = select(Reservation.start_datetime, Reservation.end_datetime).where(
        Reservation.condo_space_id == space_id,
        Reservation.status.in_(ACTIVE_RESERVATION_STATUSES),
        Reservation.start_datetime < end,
        Reservation.end_datetime > start,
    )
    if exclude_reservation is not None:
        query = query.where(Reservation.id != exclude_reservation)
    reservations = [tuple(r) for r in ctx.db.execute(query)]
    blocks = [
        tuple(b)
        for b in ctx.db.execute(
            select(SpaceBlock.starts_at, SpaceBlock.ends_at).where(
                SpaceBlock.condo_space_id == space_id, SpaceBlock.starts_at < end, SpaceBlock.ends_at > start
            )
        )
    ]
    return reservations, blocks


def _overlaps(interval: Interval, others: list[Interval]) -> bool:
    return any(interval[0] < o_end and interval[1] > o_start for o_start, o_end in others)


def _slot_status(space: CondoSpace, slot: Interval, ctx: Ctx, reservations, blocks) -> str:
    if slot[0] < ctx.now():
        return "past"
    if not space.is_active or slot[0].date() > last_bookable_date(space, ctx) or _overlaps(slot, blocks):
        return "unavailable"
    if _overlaps(slot, reservations):
        return "occupied"
    return "available"


def slots_for_day(ctx: Ctx, space: CondoSpace, day: date) -> DaySlots:
    slots = day_slots(space, day, ctx)
    reservations, blocks = busy_intervals(ctx, space.id, day_start(day, ctx), day_start(day + timedelta(days=1), ctx))
    return DaySlots(
        space_id=space.id,
        date=day,
        booking_mode=space.booking_mode,
        slots=[
            SlotOut(start=s, end=e, start_time=s.time(), status=_slot_status(space, (s, e), ctx, reservations, blocks))
            for s, e in slots
        ],
    )


def month_availability(ctx: Ctx, space: CondoSpace, year: int, month: int) -> MonthAvailability:
    first = date(year, month, 1)
    days_in_month = calendar.monthrange(year, month)[1]
    reservations, blocks = busy_intervals(
        ctx, space.id, day_start(first, ctx), day_start(first + timedelta(days=days_in_month), ctx)
    )
    today = ctx.now().date()
    days = []
    for offset in range(days_in_month):
        day = first + timedelta(days=offset)
        if day < today:
            days.append(DayAvailability(date=day, status="past", free_slots=0))
            continue
        statuses = [_slot_status(space, slot, ctx, reservations, blocks) for slot in day_slots(space, day, ctx)]
        free = statuses.count("available")
        occupied = statuses.count("occupied")
        if free and occupied:
            status = "partial"
        elif free:
            status = "available"
        elif occupied:
            status = "full"
        elif statuses and all(s == "past" for s in statuses):
            status = "past"
        else:
            status = "unavailable"
        days.append(DayAvailability(date=day, status=status, free_slots=free))
    return MonthAvailability(
        space_id=space.id,
        booking_mode=space.booking_mode,
        month=f"{year:04d}-{month:02d}",
        last_bookable_date=last_bookable_date(space, ctx),
        days=days,
    )


# ---------------------------------------------------------------- validações da reserva


def resolve_period(ctx: Ctx, space: CondoSpace, day: date, start_time: time | None) -> Interval:
    slots = day_slots(space, day, ctx)
    if space.booking_mode == BookingMode.full_day:
        return slots[0]
    if start_time is None:
        raise AppError(422, "start_time_required", "Escolha um horário")
    for slot in slots:
        if slot[0].time() == start_time.replace(tzinfo=None):
            return slot
    raise AppError(422, "invalid_slot", "Horário fora da grade de funcionamento da área")


def check_unit_not_delinquent(ctx: Ctx, unit_id: uuid.UUID) -> None:
    """Restrição por inadimplência: a flag fica na unidade e vale para todos os moradores dela,
    em qualquer área. Roda antes das demais validações do agendamento."""
    unit = ctx.db.get(Unit, unit_id)
    if unit is None or unit.condominium_id != ctx.condominium_id:
        raise NotFound("Unidade")
    if unit.inadimplente:
        raise AppError(
            403,
            "pending_dues",
            "A unidade tem pendências financeiras; regularize com a administração para reservar",
        )


def check_user_can_book(ctx: Ctx, user_id: uuid.UUID, unit_id: uuid.UUID) -> None:
    member = ctx.db.get(CondominiumUser, (ctx.condominium_id, user_id))
    user = ctx.db.get(AppUser, user_id)
    if not (member and member.is_active and user and user.is_active):
        raise AppError(422, "user_inactive", "Usuário inativo não pode reservar")
    linked = ctx.db.scalar(
        select(func.count()).select_from(UnitResident).where(UnitResident.unit_id == unit_id, UnitResident.user_id == user_id)
    )
    if not linked:
        raise AppError(422, "unit_not_linked", "Você não está vinculado a esta unidade")
    check_unit_not_delinquent(ctx, unit_id)


def check_period(
    ctx: Ctx, space: CondoSpace, period: Interval, exclude_reservation: uuid.UUID | None = None
) -> None:
    if not space.is_active:
        raise AppError(409, "space_unavailable", "Este local está indisponível para reserva")
    if period[0] < ctx.now():
        raise AppError(422, "date_in_past", "Escolha uma data e horário futuros")
    if period[0].date() > last_bookable_date(space, ctx):
        raise AppError(422, "beyond_horizon", f"Reservas abrem com até {space.booking_horizon_days} dias de antecedência")
    reservations, blocks = busy_intervals(ctx, space.id, period[0], period[1], exclude_reservation)
    if _overlaps(period, blocks):
        raise AppError(409, "space_unavailable", "Este local está bloqueado no período escolhido")
    if _overlaps(period, reservations):
        raise AppError(409, "slot_taken", "Este horário já foi reservado")


def check_unit_limit(ctx: Ctx, space: CondoSpace, unit_id: uuid.UUID, exclude_reservation: uuid.UUID | None = None) -> None:
    query = select(func.count()).where(
        Reservation.unit_id == unit_id,
        Reservation.condo_space_id == space.id,
        Reservation.status.in_(ACTIVE_RESERVATION_STATUSES),
        Reservation.start_datetime > ctx.now(),
    )
    if exclude_reservation is not None:
        query = query.where(Reservation.id != exclude_reservation)
    if ctx.db.scalar(query) >= space.max_per_unit:
        raise AppError(
            422, "limit_reached", f"A unidade já tem {space.max_per_unit} reserva(s) futura(s) nesta área"
        )


# ---------------------------------------------------------------- ciclo da reserva


def get_reservation(ctx: Ctx, reservation_id: uuid.UUID) -> Reservation:
    reservation = ctx.db.get(Reservation, reservation_id)
    if reservation is None or reservation.condominium_id != ctx.condominium_id:
        raise NotFound("Reserva")
    return reservation


def create_reservation(ctx: Ctx, data: ReservationCreate) -> Reservation:
    user_id = ctx.require_user()
    space = get_space(ctx, data.space_id)
    check_user_can_book(ctx, user_id, data.unit_id)  # inclui a inadimplência, antes de qualquer outra regra
    period = resolve_period(ctx, space, data.date, data.start_time)
    check_period(ctx, space, period)
    check_unit_limit(ctx, space, data.unit_id)

    document = None
    if space.requires_terms:
        document = current_rules_document(ctx, space.id)
        if document is None:
            raise AppError(409, "terms_unavailable", "A área exige aceite, mas não há regulamento publicado")
        if data.rules_document_id is not None and data.rules_document_id != document.id:
            raise AppError(409, "terms_outdated", "O regulamento foi atualizado; leia e aceite a versão vigente")
        if not data.accept_terms:
            raise AppError(422, "terms_required", "É preciso aceitar o regulamento para reservar")

    reservation = Reservation(
        condominium_id=ctx.condominium_id,
        condo_space_id=space.id,
        unit_id=data.unit_id,
        requested_by=user_id,
        start_datetime=period[0],
        end_datetime=period[1],
    )
    ctx.db.add(reservation)
    ctx.db.flush()  # EXCLUDE: corrida com outro morador vira slot_taken / unit_conflict
    if document is not None:
        ctx.db.add(
            TermsAcceptance(
                condominium_id=ctx.condominium_id,
                reservation_id=reservation.id,
                rules_document_id=document.id,
                condo_space_id=space.id,
                user_id=user_id,
            )
        )
    notify(
        ctx,
        manager_ids(ctx),
        "reservation_requested",
        f"Nova solicitação de reserva: {space.name}",
        reservation_id=reservation.id,
    )
    ctx.db.flush()
    ctx.db.refresh(reservation)
    return reservation


def _require_active_future(ctx: Ctx, reservation: Reservation, action: str) -> None:
    if reservation.status not in ACTIVE_RESERVATION_STATUSES or reservation.start_datetime <= ctx.now():
        raise AppError(409, f"not_{action}", "Só reservas futuras pendentes ou confirmadas podem ser alteradas")


def update_reservation(ctx: Ctx, reservation: Reservation, data: ReservationUpdate) -> Reservation:
    """Editar data/horário. A reserva volta para pending e passa de novo pela administração."""
    _require_active_future(ctx, reservation, "editable")
    check_unit_not_delinquent(ctx, reservation.unit_id)  # a alteração é um novo pedido de agendamento
    space = get_space(ctx, reservation.condo_space_id)
    period = resolve_period(ctx, space, data.date, data.start_time)
    check_period(ctx, space, period, exclude_reservation=reservation.id)
    reservation.start_datetime, reservation.end_datetime = period
    reservation.status = ReservationStatus.pending
    reservation.reviewed_by = reservation.reviewed_at = None
    ctx.db.flush()
    ctx.db.refresh(reservation)
    return reservation


def cancel_reservation(ctx: Ctx, reservation: Reservation, reason: str | None) -> Reservation:
    _require_active_future(ctx, reservation, "cancelable")
    reservation.status = ReservationStatus.canceled
    reservation.canceled_at = ctx.now()
    reservation.canceled_by = ctx.require_user()
    reservation.cancel_reason = reason
    ctx.db.flush()
    ctx.db.refresh(reservation)
    return reservation


def review_reservation(ctx: Ctx, reservation: Reservation, approve: bool, reason: str | None = None) -> Reservation:
    if reservation.status != ReservationStatus.pending:
        raise AppError(409, "not_pending", "Só reservas pendentes podem ser aprovadas ou recusadas")
    reservation.reviewed_by = ctx.require_user()
    reservation.reviewed_at = ctx.now()
    if approve:
        reservation.status = ReservationStatus.confirmed
        title = "Sua reserva foi confirmada"
    else:
        reservation.status = ReservationStatus.rejected
        reservation.rejection_reason = reason
        title = "Sua reserva foi recusada"
    notify(ctx, [reservation.requested_by], f"reservation_{reservation.status}", title, reason, reservation_id=reservation.id)
    ctx.db.flush()
    ctx.db.refresh(reservation)
    return reservation


def reservation_filter_mine(ctx: Ctx):
    """Reservas da casa: feitas pelo usuário ou por alguém das unidades dele."""
    user_id = ctx.require_user()
    my_units = select(UnitResident.unit_id).where(UnitResident.user_id == user_id)
    return or_(Reservation.requested_by == user_id, Reservation.unit_id.in_(my_units))


def period_filter(start: datetime | None, end: datetime | None):
    conditions = []
    if start is not None:
        conditions.append(Reservation.end_datetime > start)
    if end is not None:
        conditions.append(Reservation.start_datetime < end)
    return and_(*conditions) if conditions else None
