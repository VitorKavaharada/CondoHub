import uuid
from datetime import date, datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlalchemy import select

from app.context import CtxDep
from app.core.models import AppUser, Unit
from app.core.schemas import Ref, UnitOut
from app.enums import ReservationStatus
from app.errors import AppError, NotFound
from app.reservas import service
from app.reservas.models import CondoSpace, Reservation, SpaceBlock, TermsAcceptance
from app.reservas.schemas import (
    CancelIn,
    DaySlots,
    MonthAvailability,
    RejectIn,
    ReservationCreate,
    ReservationOut,
    ReservationUpdate,
    RulesDocumentCreate,
    RulesDocumentOut,
    SpaceBlockCreate,
    SpaceBlockOut,
    SpaceCreate,
    SpaceOut,
    SpaceUpdate,
)

router = APIRouter(prefix="/condominiums/{condominium_id}")
SPACES = "Reservas · áreas"
RESERVATIONS = "Reservas · reservas"


# ---------------------------------------------------------------- áreas


def _space_out(ctx, space: CondoSpace) -> SpaceOut:
    out = SpaceOut.model_validate(space)
    block = service.current_block(ctx, space.id)
    document = service.current_rules_document(ctx, space.id)
    out.current_block = SpaceBlockOut.model_validate(block) if block else None
    out.rules_document = RulesDocumentOut.model_validate(document) if document else None
    return out


@router.get("/spaces", response_model=list[SpaceOut], tags=[SPACES], summary="Listar áreas comuns")
def list_spaces(ctx: CtxDep, active: Annotated[bool | None, Query(description="Filtrar por área ativa")] = None):
    query = select(CondoSpace).where(CondoSpace.condominium_id == ctx.condominium_id).order_by(CondoSpace.name)
    if active is not None:
        query = query.where(CondoSpace.is_active == active)
    return [_space_out(ctx, s) for s in ctx.db.scalars(query)]


@router.post("/spaces", response_model=SpaceOut, status_code=201, tags=[SPACES], summary="Cadastrar área (admin)")
def create_space(ctx: CtxDep, data: SpaceCreate):
    return _space_out(ctx, service.create_space(ctx, data))


@router.get("/spaces/{space_id}", response_model=SpaceOut, tags=[SPACES], summary="Detalhe da área")
def get_space(ctx: CtxDep, space_id: uuid.UUID):
    return _space_out(ctx, service.get_space(ctx, space_id))


@router.patch("/spaces/{space_id}", response_model=SpaceOut, tags=[SPACES], summary="Editar área e regras (admin)")
def update_space(ctx: CtxDep, space_id: uuid.UUID, data: SpaceUpdate):
    return _space_out(ctx, service.update_space(ctx, service.get_space(ctx, space_id), data))


@router.get(
    "/spaces/{space_id}/availability",
    response_model=MonthAvailability,
    tags=[SPACES],
    summary="Calendário do mês",
)
def month_availability(
    ctx: CtxDep,
    space_id: uuid.UUID,
    month: Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", examples=["2026-11"])],
):
    year, mon = (int(p) for p in month.split("-"))
    return service.month_availability(ctx, service.get_space(ctx, space_id), year, mon)


@router.get("/spaces/{space_id}/slots", response_model=DaySlots, tags=[SPACES], summary="Horários de um dia")
def day_slots(ctx: CtxDep, space_id: uuid.UUID, date: date):
    return service.slots_for_day(ctx, service.get_space(ctx, space_id), date)


@router.get(
    "/spaces/{space_id}/rules-document",
    response_model=RulesDocumentOut,
    tags=[SPACES],
    summary="Regulamento vigente",
)
def get_rules_document(ctx: CtxDep, space_id: uuid.UUID):
    document = service.current_rules_document(ctx, service.get_space(ctx, space_id).id)
    if document is None:
        raise NotFound("Regulamento")
    return document


@router.post(
    "/spaces/{space_id}/rules-documents",
    response_model=RulesDocumentOut,
    status_code=201,
    tags=[SPACES],
    summary="Publicar nova versão do regulamento (admin)",
)
def publish_rules_document(ctx: CtxDep, space_id: uuid.UUID, data: RulesDocumentCreate):
    return service.publish_rules_document(ctx, service.get_space(ctx, space_id), **data.model_dump())


@router.get("/spaces/{space_id}/blocks", response_model=list[SpaceBlockOut], tags=[SPACES], summary="Bloqueios da área")
def list_blocks(ctx: CtxDep, space_id: uuid.UUID, include_past: bool = False):
    service.get_space(ctx, space_id)
    query = select(SpaceBlock).where(SpaceBlock.condo_space_id == space_id).order_by(SpaceBlock.starts_at)
    if not include_past:
        query = query.where(SpaceBlock.ends_at > ctx.now())
    return ctx.db.scalars(query).all()


@router.post(
    "/spaces/{space_id}/blocks",
    response_model=SpaceBlockOut,
    status_code=201,
    tags=[SPACES],
    summary="Bloquear área (admin)",
)
def create_block(ctx: CtxDep, space_id: uuid.UUID, data: SpaceBlockCreate):
    service.get_space(ctx, space_id)
    block = SpaceBlock(
        condominium_id=ctx.condominium_id, condo_space_id=space_id, created_by=ctx.require_user(), **data.model_dump()
    )
    ctx.db.add(block)
    ctx.db.flush()
    return block


@router.delete("/spaces/{space_id}/blocks/{block_id}", status_code=204, tags=[SPACES], summary="Remover bloqueio (admin)")
def delete_block(ctx: CtxDep, space_id: uuid.UUID, block_id: uuid.UUID):
    block = ctx.db.get(SpaceBlock, block_id)
    if block is None or block.condo_space_id != space_id or block.condominium_id != ctx.condominium_id:
        raise NotFound("Bloqueio")
    ctx.db.delete(block)
    return Response(status_code=204)


# ---------------------------------------------------------------- reservas


def _reservation_query(ctx):
    return (
        select(Reservation, CondoSpace, Unit, AppUser, TermsAcceptance.accepted_at)
        .join(CondoSpace, CondoSpace.id == Reservation.condo_space_id)
        .join(Unit, Unit.id == Reservation.unit_id)
        .join(AppUser, AppUser.id == Reservation.requested_by)
        .outerjoin(TermsAcceptance, TermsAcceptance.reservation_id == Reservation.id)
        .where(Reservation.condominium_id == ctx.condominium_id)
    )


def _to_out(row) -> ReservationOut:
    reservation, space, unit, user, accepted_at = row
    return ReservationOut(
        id=reservation.id,
        space=Ref(id=space.id, name=space.name),
        booking_mode=space.booking_mode,
        unit=UnitOut.model_validate(unit),
        requested_by=Ref(id=user.id, name=user.name),
        start_datetime=reservation.start_datetime,
        end_datetime=reservation.end_datetime,
        status=reservation.status,
        reviewed_at=reservation.reviewed_at,
        rejection_reason=reservation.rejection_reason,
        canceled_at=reservation.canceled_at,
        cancel_reason=reservation.cancel_reason,
        terms_accepted_at=accepted_at,
        created_at=reservation.created_at,
    )


def _reservation_out(ctx, reservation_id: uuid.UUID) -> ReservationOut:
    row = ctx.db.execute(_reservation_query(ctx).where(Reservation.id == reservation_id)).first()
    if row is None:
        raise NotFound("Reserva")
    return _to_out(row)


@router.get(
    "/reservations",
    response_model=list[ReservationOut],
    tags=[RESERVATIONS],
    summary="Listar reservas",
    description="`mine=true` traz as reservas das unidades do usuário do X-User-Id (tela Minhas reservas).",
)
def list_reservations(
    ctx: CtxDep,
    mine: bool = False,
    space_id: uuid.UUID | None = None,
    unit_id: uuid.UUID | None = None,
    status: Annotated[list[ReservationStatus] | None, Query()] = None,
    start: Annotated[datetime | None, Query(description="Reservas que terminam depois deste instante")] = None,
    end: Annotated[datetime | None, Query(description="Reservas que começam antes deste instante")] = None,
):
    query = _reservation_query(ctx).order_by(Reservation.start_datetime)
    if mine:
        query = query.where(service.reservation_filter_mine(ctx))
    if space_id:
        query = query.where(Reservation.condo_space_id == space_id)
    if unit_id:
        query = query.where(Reservation.unit_id == unit_id)
    if status:
        query = query.where(Reservation.status.in_(status))
    if (period := service.period_filter(start, end)) is not None:
        query = query.where(period)
    return [_to_out(row) for row in ctx.db.execute(query)]


@router.post(
    "/reservations",
    response_model=ReservationOut,
    status_code=201,
    tags=[RESERVATIONS],
    summary="Solicitar reserva",
    description=(
        "Cria a reserva como `pending`. A primeira verificação é a inadimplência: se a unidade tem "
        "`inadimplente = true`, responde **403** com `pending_dues` e nada é gravado. "
        "Outros erros com `code` para a tela de confirmação: "
        "`slot_taken` (horário ocupado), `space_unavailable` (local indisponível), "
        "`unit_conflict` (a unidade já tem reserva no período), `limit_reached`, "
        "`unit_not_linked`, `terms_required`, `terms_outdated`, `invalid_slot`, `date_in_past`, `beyond_horizon`."
    ),
)
def create_reservation(ctx: CtxDep, data: ReservationCreate):
    return _reservation_out(ctx, service.create_reservation(ctx, data).id)


@router.get("/reservations/{reservation_id}", response_model=ReservationOut, tags=[RESERVATIONS], summary="Detalhe da reserva")
def get_reservation(ctx: CtxDep, reservation_id: uuid.UUID):
    return _reservation_out(ctx, reservation_id)


@router.patch(
    "/reservations/{reservation_id}",
    response_model=ReservationOut,
    tags=[RESERVATIONS],
    summary="Editar data/horário",
    description=(
        "A reserva volta para `pending` e passa de novo pela administração. "
        "Unidade inadimplente não altera reservas (403 `pending_dues`)."
    ),
)
def update_reservation(ctx: CtxDep, reservation_id: uuid.UUID, data: ReservationUpdate):
    service.update_reservation(ctx, service.get_reservation(ctx, reservation_id), data)
    return _reservation_out(ctx, reservation_id)


@router.post(
    "/reservations/{reservation_id}/cancel", response_model=ReservationOut, tags=[RESERVATIONS], summary="Cancelar reserva"
)
def cancel_reservation(ctx: CtxDep, reservation_id: uuid.UUID, data: CancelIn | None = None):
    service.cancel_reservation(ctx, service.get_reservation(ctx, reservation_id), data.reason if data else None)
    return _reservation_out(ctx, reservation_id)


@router.post(
    "/reservations/{reservation_id}/approve", response_model=ReservationOut, tags=[RESERVATIONS], summary="Aprovar (admin)"
)
def approve_reservation(ctx: CtxDep, reservation_id: uuid.UUID):
    service.review_reservation(ctx, service.get_reservation(ctx, reservation_id), approve=True)
    return _reservation_out(ctx, reservation_id)


@router.post(
    "/reservations/{reservation_id}/reject", response_model=ReservationOut, tags=[RESERVATIONS], summary="Recusar (admin)"
)
def reject_reservation(ctx: CtxDep, reservation_id: uuid.UUID, data: RejectIn):
    if not data.reason.strip():
        raise AppError(422, "reason_required", "Informe o motivo da recusa")
    service.review_reservation(ctx, service.get_reservation(ctx, reservation_id), approve=False, reason=data.reason)
    return _reservation_out(ctx, reservation_id)
