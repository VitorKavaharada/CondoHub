"""Regras de manutenção (modelagem_dados_fluxo_manutencao.md).

O banco valida transições, aprovação/recusa completas, prestador ativo com a especialidade e
grava a linha do tempo. Aqui ficam a montagem das respostas, as notificações e a geração das
ocorrências preventivas.
"""

import uuid
from datetime import date, datetime, time, timedelta

from sqlalchemy import Select, func, select
from sqlalchemy.exc import DBAPIError

from app.context import Ctx
from app.core.models import AppUser, Unit, UnitResident
from app.core.schemas import Ref, UnitOut
from app.core.service import manager_ids, notify
from app.enums import (
    OPEN_INCIDENT_STATUSES,
    IncidentOrigin,
    IncidentPriority,
    IncidentRejection,
    IncidentStatus,
    PreventiveEvent,
    PreventiveTrigger,
    ReservationStatus,
)
from app.errors import AppError, NotFound, translate_db_error
from app.manutencao import recurrence
from app.manutencao.models import (
    Incident,
    IncidentAttachment,
    IncidentStatusHistory,
    MaintenanceLocation,
    MaintenanceType,
    PreventiveMaintenance,
    ServiceProvider,
    ServiceProviderSpecialty,
)
from app.manutencao.schemas import (
    ApproveIn,
    AttachmentOut,
    CalendarEvent,
    CalendarOut,
    FinishIn,
    HistoryEntryOut,
    HistoryGroup,
    HistoryOut,
    HistoryRecord,
    IncidentBrief,
    IncidentCreate,
    IncidentDetail,
    IncidentOut,
    IncidentSummary,
    JobResult,
    LocationContext,
    PreventiveBrief,
    PreventiveCreate,
    PreventiveOut,
    PreventiveUpdate,
    ProviderCreate,
    ProviderDetail,
    ProviderOut,
    ProviderSchedule,
    ProviderUpdate,
    RateIn,
    RejectIncidentIn,
    ScheduledIncidentCreate,
)
from app.reservas.models import Reservation

PRIORITY_LABEL = {IncidentPriority.high: "alta", IncidentPriority.medium: "média", IncidentPriority.low: "baixa"}
ALLOWED_TRANSITIONS = {
    IncidentStatus.submitted: {IncidentStatus.under_review, IncidentStatus.rejected},
    IncidentStatus.under_review: {IncidentStatus.approved, IncidentStatus.rejected},
    IncidentStatus.approved: {IncidentStatus.in_progress},
    IncidentStatus.in_progress: {IncidentStatus.done},
}


def _get(ctx: Ctx, model, id_: uuid.UUID, what: str):
    obj = ctx.db.get(model, id_)
    if obj is None or obj.condominium_id != ctx.condominium_id:
        raise NotFound(what)
    return obj


def _ref(id_, name) -> Ref | None:
    return Ref(id=id_, name=name) if id_ is not None else None


# ---------------------------------------------------------------- consultas de ocorrência


def incident_select(ctx: Ctx) -> Select:
    return (
        select(
            Incident,
            MaintenanceLocation.name,
            MaintenanceType.name,
            ServiceProvider.name,
            Unit,
            AppUser.name,
            PreventiveMaintenance.trigger_type,
        )
        .join(MaintenanceLocation, MaintenanceLocation.id == Incident.location_id)
        .join(MaintenanceType, MaintenanceType.id == Incident.maintenance_type_id)
        .outerjoin(ServiceProvider, ServiceProvider.id == Incident.assigned_provider_id)
        .outerjoin(Unit, Unit.id == Incident.unit_id)
        .outerjoin(AppUser, AppUser.id == Incident.requested_by_user_id)
        .outerjoin(PreventiveMaintenance, PreventiveMaintenance.id == Incident.preventive_maintenance_id)
        .where(Incident.condominium_id == ctx.condominium_id)
    )


def to_brief(row) -> IncidentBrief:
    inc, location_name, type_name, provider_name, *_ = row
    return IncidentBrief(
        id=inc.id,
        code=inc.code,
        title=inc.title,
        status=inc.status,
        origin=inc.origin,
        location=Ref(id=inc.location_id, name=location_name),
        maintenance_type=Ref(id=inc.maintenance_type_id, name=type_name),
        assigned_provider=_ref(inc.assigned_provider_id, provider_name),
        scheduled_start_at=inc.scheduled_start_at,
        scheduled_end_at=inc.scheduled_end_at,
        finished_at=inc.finished_at,
    )


def to_out(row) -> IncidentOut:
    inc, _, _, _, unit, requester_name, trigger = row
    return IncidentOut(
        **to_brief(row).model_dump(),
        description=inc.description,
        preventive_trigger=trigger,
        requested_by=_ref(inc.requested_by_user_id, requester_name),
        unit=UnitOut.model_validate(unit) if unit else None,
        priority=inc.priority,
        due_at=inc.due_at,
        rejection_reason=inc.rejection_reason,
        rejection_note=inc.rejection_note,
        started_at=inc.started_at,
        cost=inc.cost,
        created_at=inc.created_at,
    )


def get_incident(ctx: Ctx, incident_id: uuid.UUID) -> Incident:
    return _get(ctx, Incident, incident_id, "Ocorrência")


def incident_detail(ctx: Ctx, incident_id: uuid.UUID) -> IncidentDetail:
    row = ctx.db.execute(incident_select(ctx).where(Incident.id == incident_id)).first()
    if row is None:
        raise NotFound("Ocorrência")
    inc = row[0]

    history = [
        HistoryEntryOut(status=h.status, note=h.note, changed_by=_ref(h.changed_by_user_id, name), changed_at=h.changed_at)
        for h, name in ctx.db.execute(
            select(IncidentStatusHistory, AppUser.name)
            .outerjoin(AppUser, AppUser.id == IncidentStatusHistory.changed_by_user_id)
            .where(IncidentStatusHistory.incident_id == inc.id)
            .order_by(IncidentStatusHistory.changed_at)
        )
    ]
    attachments = ctx.db.scalars(
        select(IncidentAttachment).where(IncidentAttachment.incident_id == inc.id).order_by(IncidentAttachment.created_at)
    ).all()

    related = None
    if inc.related_incident_id:
        related_row = ctx.db.execute(incident_select(ctx).where(Incident.id == inc.related_incident_id)).first()
        related = to_brief(related_row) if related_row else None

    reviewer = ctx.db.get(AppUser, inc.reviewed_by_user_id) if inc.reviewed_by_user_id else None
    rule = ctx.db.get(PreventiveMaintenance, inc.preventive_maintenance_id) if inc.preventive_maintenance_id else None

    same_place = incident_select(ctx).where(Incident.location_id == inc.location_id, Incident.id != inc.id)
    last_done = ctx.db.execute(
        same_place.where(Incident.status == IncidentStatus.done).order_by(Incident.finished_at.desc()).limit(1)
    ).first()
    upcoming = ctx.db.execute(
        same_place.where(Incident.status.in_([IncidentStatus.approved, IncidentStatus.in_progress]))
        .order_by(Incident.scheduled_start_at.asc().nulls_last())
        .limit(5)
    ).all()

    return IncidentDetail(
        **to_out(row).model_dump(),
        reviewed_by=_ref(reviewer.id, reviewer.name) if reviewer else None,
        reviewed_at=inc.reviewed_at,
        related_incident=related,
        preventive_maintenance=_ref(rule.id, rule.name) if rule else None,
        trigger_reservation_id=inc.trigger_reservation_id,
        resident_rating=inc.resident_rating,
        resident_feedback=inc.resident_feedback,
        rated_at=inc.rated_at,
        history=history,
        attachments=[AttachmentOut.model_validate(a) for a in attachments],
        location_context=LocationContext(
            last_done=to_brief(last_done) if last_done else None,
            upcoming=[to_brief(r) for r in upcoming],
        ),
    )


def summary(ctx: Ctx) -> IncidentSummary:
    by_status = dict.fromkeys(IncidentStatus, 0)
    for status, count in ctx.db.execute(
        select(Incident.status, func.count()).where(Incident.condominium_id == ctx.condominium_id).group_by(Incident.status)
    ):
        by_status[status] = count

    open_by_priority = {"high": 0, "medium": 0, "low": 0, "none": 0}
    for priority, count in ctx.db.execute(
        select(Incident.priority, func.count())
        .where(Incident.condominium_id == ctx.condominium_id, Incident.status.in_(OPEN_INCIDENT_STATUSES))
        .group_by(Incident.priority)
    ):
        open_by_priority[priority.value if priority else "none"] = count

    month_start = datetime.combine(ctx.now().date().replace(day=1), time.min, ctx.tz)
    done_this_month = ctx.db.scalar(
        select(func.count()).where(
            Incident.condominium_id == ctx.condominium_id,
            Incident.status == IncidentStatus.done,
            Incident.finished_at >= month_start,
        )
    )
    return IncidentSummary(
        by_status=by_status,
        awaiting_decision=by_status[IncidentStatus.submitted] + by_status[IncidentStatus.under_review],
        open_by_priority=open_by_priority,
        done_this_month=done_this_month,
    )


# ---------------------------------------------------------------- ciclo da ocorrência


def _check_catalog(ctx: Ctx, location_id: uuid.UUID, type_id: uuid.UUID) -> None:
    if not _get(ctx, MaintenanceLocation, location_id, "Local").is_active:
        raise AppError(422, "location_inactive", "Este local não aceita novas solicitações")
    if not _get(ctx, MaintenanceType, type_id, "Tipo de manutenção").is_active:
        raise AppError(422, "type_inactive", "Este tipo de manutenção não aceita novas solicitações")


def _transition(ctx: Ctx, inc: Incident, target: IncidentStatus, note: str | None = None) -> None:
    if target not in ALLOWED_TRANSITIONS.get(inc.status, set()):
        raise AppError(409, "invalid_transition", f"Não é possível passar de {inc.status} para {target}")
    ctx.status_note(note)
    inc.status = target


def _save(ctx: Ctx, inc: Incident) -> Incident:
    ctx.db.flush()
    ctx.db.refresh(inc)  # code, due_at e updated_at vêm do trigger
    return inc


def create_resident_incident(ctx: Ctx, data: IncidentCreate) -> Incident:
    user_id = ctx.require_user()
    _check_catalog(ctx, data.location_id, data.maintenance_type_id)
    linked = ctx.db.scalar(
        select(func.count()).where(UnitResident.unit_id == data.unit_id, UnitResident.user_id == user_id)
    )
    if not linked:
        raise AppError(422, "unit_not_linked", "Você não está vinculado a esta unidade")

    ctx.status_note(None)
    inc = Incident(
        condominium_id=ctx.condominium_id,
        title=data.title.strip(),
        description=data.description,
        location_id=data.location_id,
        maintenance_type_id=data.maintenance_type_id,
        origin=IncidentOrigin.resident,
        requested_by_user_id=user_id,
        unit_id=data.unit_id,
        status=IncidentStatus.submitted,
    )
    ctx.db.add(inc)
    _save(ctx, inc)
    for url in data.photo_urls:
        ctx.db.add(
            IncidentAttachment(condominium_id=ctx.condominium_id, incident_id=inc.id, file_url=url, uploaded_by_user_id=user_id)
        )
    notify(ctx, manager_ids(ctx), "incident_submitted", f"Nova solicitação {inc.code}: {inc.title}", incident_id=inc.id)
    ctx.db.flush()
    return inc


def create_scheduled_incident(ctx: Ctx, data: ScheduledIncidentCreate) -> Incident:
    user_id = ctx.require_user()
    _check_catalog(ctx, data.location_id, data.maintenance_type_id)
    ctx.status_note("Manutenção agendada pelo síndico.")
    inc = Incident(
        condominium_id=ctx.condominium_id,
        origin=IncidentOrigin.manual,
        status=IncidentStatus.approved,
        created_by_user_id=user_id,
        **data.model_dump(),
    )
    ctx.db.add(inc)
    return _save(ctx, inc)


def review_incident(ctx: Ctx, inc: Incident) -> Incident:
    _transition(ctx, inc, IncidentStatus.under_review)
    return _save(ctx, inc)


def approve_incident(ctx: Ctx, inc: Incident, data: ApproveIn) -> Incident:
    provider = _get(ctx, ServiceProvider, data.assigned_provider_id, "Prestador")
    note = data.note or f"Prioridade {PRIORITY_LABEL[data.priority]}. Responsável: {provider.name}."
    _transition(ctx, inc, IncidentStatus.approved, note)
    inc.priority = data.priority
    inc.assigned_provider_id = provider.id
    inc.scheduled_start_at = data.scheduled_start_at
    inc.scheduled_end_at = data.scheduled_end_at
    inc.reviewed_by_user_id = ctx.require_user()
    inc.reviewed_at = ctx.now()
    _save(ctx, inc)
    notify(ctx, [inc.requested_by_user_id], "incident_approved", f"Solicitação {inc.code} aprovada", note, incident_id=inc.id)
    return inc


def reject_incident(ctx: Ctx, inc: Incident, data: RejectIncidentIn) -> Incident:
    if data.related_incident_id is not None:
        related = get_incident(ctx, data.related_incident_id)
        if related.location_id != inc.location_id or related.id == inc.id:
            raise AppError(422, "invalid_related_incident", "A manutenção relacionada deve ser de outro registro no mesmo local")
    elif data.reason == IncidentRejection.already_scheduled:
        raise AppError(422, "related_incident_required", "Informe a manutenção já agendada")
    _transition(ctx, inc, IncidentStatus.rejected, data.note)
    inc.rejection_reason = data.reason
    inc.rejection_note = data.note
    inc.related_incident_id = data.related_incident_id
    inc.reviewed_by_user_id = ctx.require_user()
    inc.reviewed_at = ctx.now()
    _save(ctx, inc)
    notify(ctx, [inc.requested_by_user_id], "incident_rejected", f"Solicitação {inc.code} recusada", data.note, incident_id=inc.id)
    return inc


def start_incident(ctx: Ctx, inc: Incident, started_at: datetime | None) -> Incident:
    _transition(ctx, inc, IncidentStatus.in_progress)
    inc.started_at = started_at or ctx.now()
    _save(ctx, inc)
    notify(ctx, [inc.requested_by_user_id], "incident_in_progress", f"Manutenção {inc.code} em execução", incident_id=inc.id)
    return inc


def finish_incident(ctx: Ctx, inc: Incident, data: FinishIn) -> Incident:
    _transition(ctx, inc, IncidentStatus.done)
    inc.finished_at = data.finished_at or ctx.now()
    inc.cost = data.cost
    _save(ctx, inc)
    notify(ctx, [inc.requested_by_user_id], "incident_done", f"Manutenção {inc.code} concluída", incident_id=inc.id)
    return inc


def rate_incident(ctx: Ctx, inc: Incident, data: RateIn) -> Incident:
    if inc.status != IncidentStatus.done:
        raise AppError(409, "not_done", "Só é possível avaliar uma manutenção concluída")
    inc.resident_rating = data.rating
    inc.resident_feedback = data.feedback
    inc.rated_at = ctx.now()
    return _save(ctx, inc)


def add_attachment(ctx: Ctx, inc: Incident, file_url: str) -> IncidentAttachment:
    attachment = IncidentAttachment(
        condominium_id=ctx.condominium_id, incident_id=inc.id, file_url=file_url, uploaded_by_user_id=ctx.require_user()
    )
    ctx.db.add(attachment)
    ctx.db.flush()
    return attachment


# ---------------------------------------------------------------- histórico por local / tipo


def _done_in_period(ctx: Ctx, start: date | None, end: date | None):
    start = start or (ctx.now().date() - timedelta(days=365))
    conditions = [
        Incident.condominium_id == ctx.condominium_id,
        Incident.status == IncidentStatus.done,
        Incident.finished_at >= datetime.combine(start, time.min, ctx.tz),
    ]
    if end is not None:
        conditions.append(Incident.finished_at < datetime.combine(end + timedelta(days=1), time.min, ctx.tz))
    return conditions


def history_groups(ctx: Ctx, by: str, start: date | None, end: date | None) -> list[HistoryGroup]:
    model, column = (
        (MaintenanceLocation, Incident.location_id) if by == "location" else (MaintenanceType, Incident.maintenance_type_id)
    )
    rows = ctx.db.execute(
        select(model.id, model.name, func.count(Incident.id), func.max(Incident.finished_at))
        .join(Incident, column == model.id)
        .where(*_done_in_period(ctx, start, end))
        .group_by(model.id, model.name)
        .order_by(func.count(Incident.id).desc(), model.name)
    )
    return [HistoryGroup(id=i, name=n, count=c, last_finished_at=last) for i, n, c, last in rows]


def history(
    ctx: Ctx, location_id: uuid.UUID | None, type_id: uuid.UUID | None, start: date | None, end: date | None
) -> HistoryOut:
    query = (
        select(Incident, MaintenanceLocation.name, MaintenanceType.name, ServiceProvider)
        .join(MaintenanceLocation, MaintenanceLocation.id == Incident.location_id)
        .join(MaintenanceType, MaintenanceType.id == Incident.maintenance_type_id)
        .outerjoin(ServiceProvider, ServiceProvider.id == Incident.assigned_provider_id)
        .where(*_done_in_period(ctx, start, end))
        .order_by(Incident.finished_at.desc())
    )
    if location_id:
        query = query.where(Incident.location_id == location_id)
    if type_id:
        query = query.where(Incident.maintenance_type_id == type_id)
    records = [
        HistoryRecord(
            id=inc.id,
            code=inc.code,
            title=inc.title,
            finished_at=inc.finished_at,
            origin=inc.origin,
            location=Ref(id=inc.location_id, name=location_name),
            maintenance_type=Ref(id=inc.maintenance_type_id, name=type_name),
            provider=_ref(provider.id, provider.name) if provider else None,
            provider_kind=provider.kind if provider else None,
            provider_contract_type=provider.contract_type if provider else None,
            cost=inc.cost,
        )
        for inc, location_name, type_name, provider in ctx.db.execute(query)
    ]
    by_origin = dict.fromkeys(IncidentOrigin, 0)
    for record in records:
        by_origin[record.origin] += 1
    return HistoryOut(total=len(records), by_origin=by_origin, last=records[0] if records else None, records=records)


# ---------------------------------------------------------------- prestadores


def get_provider(ctx: Ctx, provider_id: uuid.UUID) -> ServiceProvider:
    return _get(ctx, ServiceProvider, provider_id, "Prestador")


def provider_out(ctx: Ctx, providers: list[ServiceProvider]) -> list[ProviderOut]:
    ids = [p.id for p in providers]
    specialties: dict[uuid.UUID, list[Ref]] = {}
    for provider_id, type_id, type_name in ctx.db.execute(
        select(ServiceProviderSpecialty.service_provider_id, MaintenanceType.id, MaintenanceType.name)
        .join(MaintenanceType, MaintenanceType.id == ServiceProviderSpecialty.maintenance_type_id)
        .where(ServiceProviderSpecialty.service_provider_id.in_(ids))
        .order_by(MaintenanceType.name)
    ):
        specialties.setdefault(provider_id, []).append(Ref(id=type_id, name=type_name))
    open_counts = dict(
        ctx.db.execute(
            select(Incident.assigned_provider_id, func.count())
            .where(Incident.assigned_provider_id.in_(ids), Incident.status.in_(OPEN_INCIDENT_STATUSES))
            .group_by(Incident.assigned_provider_id)
        ).all()
    )
    own_fields = [f for f in ProviderOut.model_fields if f not in ("specialties", "open_assignments")]
    return [
        ProviderOut(
            **{f: getattr(p, f) for f in own_fields},
            specialties=specialties.get(p.id, []),
            open_assignments=open_counts.get(p.id, 0),
        )
        for p in providers
    ]


def provider_detail(ctx: Ctx, provider: ServiceProvider) -> ProviderDetail:
    base = provider_out(ctx, [provider])[0]
    incidents = ctx.db.execute(
        incident_select(ctx)
        .where(Incident.assigned_provider_id == provider.id, Incident.status.in_(OPEN_INCIDENT_STATUSES))
        .order_by(Incident.scheduled_start_at.asc().nulls_last(), Incident.created_at)
    ).all()
    rules = ctx.db.execute(
        select(PreventiveMaintenance, MaintenanceLocation.name)
        .join(MaintenanceLocation, MaintenanceLocation.id == PreventiveMaintenance.location_id)
        .where(PreventiveMaintenance.default_provider_id == provider.id, PreventiveMaintenance.is_active)
        .order_by(PreventiveMaintenance.next_run_at.asc().nulls_last(), PreventiveMaintenance.name)
    ).all()
    return ProviderDetail(
        **base.model_dump(),
        schedule=ProviderSchedule(
            incidents=[to_brief(r) for r in incidents],
            preventive_rules=[
                PreventiveBrief(
                    id=rule.id,
                    name=rule.name,
                    trigger_type=rule.trigger_type,
                    frequency=rule.frequency,
                    trigger_event=rule.trigger_event,
                    location=Ref(id=rule.location_id, name=location_name),
                    next_run_at=rule.next_run_at,
                )
                for rule, location_name in rules
            ],
        ),
    )


def _set_specialties(ctx: Ctx, provider: ServiceProvider, type_ids: list[uuid.UUID]) -> None:
    for existing in ctx.db.scalars(
        select(ServiceProviderSpecialty).where(ServiceProviderSpecialty.service_provider_id == provider.id)
    ):
        ctx.db.delete(existing)
    ctx.db.flush()
    for type_id in dict.fromkeys(type_ids):
        ctx.db.add(
            ServiceProviderSpecialty(
                condominium_id=ctx.condominium_id, service_provider_id=provider.id, maintenance_type_id=type_id
            )
        )
    ctx.db.flush()


def create_provider(ctx: Ctx, data: ProviderCreate) -> ServiceProvider:
    provider = ServiceProvider(condominium_id=ctx.condominium_id, **data.model_dump(exclude={"specialty_ids"}))
    ctx.db.add(provider)
    ctx.db.flush()
    _set_specialties(ctx, provider, data.specialty_ids)
    ctx.db.refresh(provider)
    return provider


def update_provider(ctx: Ctx, provider: ServiceProvider, data: ProviderUpdate) -> ServiceProvider:
    changes = data.model_dump(exclude_unset=True, exclude={"specialty_ids"})
    for field, value in changes.items():
        setattr(provider, field, value)
    ctx.db.flush()
    if data.specialty_ids is not None:
        _set_specialties(ctx, provider, data.specialty_ids)
    ctx.db.refresh(provider)
    return provider


# ---------------------------------------------------------------- preventivas


def preventive_select(ctx: Ctx) -> Select:
    return (
        select(PreventiveMaintenance, MaintenanceType.name, MaintenanceLocation.name, ServiceProvider.name)
        .join(MaintenanceType, MaintenanceType.id == PreventiveMaintenance.maintenance_type_id)
        .join(MaintenanceLocation, MaintenanceLocation.id == PreventiveMaintenance.location_id)
        .outerjoin(ServiceProvider, ServiceProvider.id == PreventiveMaintenance.default_provider_id)
        .where(PreventiveMaintenance.condominium_id == ctx.condominium_id)
    )


def preventive_out(row) -> PreventiveOut:
    rule, type_name, location_name, provider_name = row
    return PreventiveOut(
        id=rule.id,
        name=rule.name,
        description=rule.description,
        maintenance_type=Ref(id=rule.maintenance_type_id, name=type_name),
        location=Ref(id=rule.location_id, name=location_name),
        trigger_type=rule.trigger_type,
        frequency=rule.frequency,
        first_run_date=rule.first_run_date,
        run_time=rule.run_time,
        trigger_event=rule.trigger_event,
        execution_window=rule.execution_window,
        default_provider=_ref(rule.default_provider_id, provider_name),
        reminder_days_before=rule.reminder_days_before,
        next_run_at=rule.next_run_at,
        is_active=rule.is_active,
        created_at=rule.created_at,
    )


def preventive_detail(ctx: Ctx, rule_id: uuid.UUID) -> PreventiveOut:
    row = ctx.db.execute(preventive_select(ctx).where(PreventiveMaintenance.id == rule_id)).first()
    if row is None:
        raise NotFound("Manutenção preventiva")
    return preventive_out(row)


def _schedule_next_run(ctx: Ctx, rule: PreventiveMaintenance) -> None:
    """Recorrente ativa: próxima ocorrência a partir de agora. Pausada ou por evento: sem próxima."""
    if rule.is_active and rule.trigger_type == PreventiveTrigger.recurring and rule.frequency and rule.first_run_date:
        rule.next_run_at = recurrence.next_occurrence(rule, ctx.tz, ctx.now())
    else:
        rule.next_run_at = None


def create_preventive(ctx: Ctx, data: PreventiveCreate) -> PreventiveMaintenance:
    rule = PreventiveMaintenance(condominium_id=ctx.condominium_id, created_by=ctx.require_user(), **data.model_dump())
    _schedule_next_run(ctx, rule)
    ctx.db.add(rule)
    ctx.db.flush()
    return rule


SCHEDULE_FIELDS = {"trigger_type", "frequency", "first_run_date", "run_time", "is_active"}


def update_preventive(ctx: Ctx, rule: PreventiveMaintenance, data: PreventiveUpdate) -> PreventiveMaintenance:
    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(rule, field, value)
    if SCHEDULE_FIELDS & changes.keys():
        _schedule_next_run(ctx, rule)
    ctx.db.flush()
    return rule


# ---------------------------------------------------------------- agenda do mês


def calendar_month(ctx: Ctx, year: int, month: int) -> CalendarOut:
    start = datetime(year, month, 1, tzinfo=ctx.tz)
    end = datetime(year + month // 12, month % 12 + 1, 1, tzinfo=ctx.tz)
    when = func.coalesce(Incident.scheduled_start_at, Incident.due_at)
    rows = ctx.db.execute(
        incident_select(ctx)
        .where(Incident.status != IncidentStatus.rejected, when >= start, when < end)
        .order_by(when)
    ).all()

    events: list[CalendarEvent] = []
    generated: set[tuple[uuid.UUID, datetime]] = set()
    for row in rows:
        inc, location_name, _, provider_name, _, _, trigger = row
        kind = {IncidentOrigin.manual: "manual", IncidentOrigin.resident: "corrective"}.get(inc.origin, trigger)
        starts_at = inc.scheduled_start_at or inc.due_at
        if inc.preventive_maintenance_id:
            generated.add((inc.preventive_maintenance_id, starts_at))
        events.append(
            CalendarEvent(
                starts_at=starts_at,
                kind=kind,
                projected=False,
                title=inc.title,
                location=Ref(id=inc.location_id, name=location_name),
                provider=_ref(inc.assigned_provider_id, provider_name),
                incident_id=inc.id,
                incident_code=inc.code,
                status=inc.status,
                preventive_maintenance_id=inc.preventive_maintenance_id,
            )
        )

    now = ctx.now()
    for rule, _, location_name, provider_name in ctx.db.execute(
        preventive_select(ctx).where(
            PreventiveMaintenance.is_active, PreventiveMaintenance.trigger_type == PreventiveTrigger.recurring
        )
    ):
        for occurrence in recurrence.occurrences_between(rule, ctx.tz, max(start, now), end):
            if (rule.id, occurrence) in generated:
                continue
            events.append(
                CalendarEvent(
                    starts_at=occurrence,
                    kind="recurring",
                    projected=True,
                    title=rule.name,
                    location=Ref(id=rule.location_id, name=location_name),
                    provider=_ref(rule.default_provider_id, provider_name),
                    incident_id=None,
                    incident_code=None,
                    status=None,
                    preventive_maintenance_id=rule.id,
                )
            )
    events.sort(key=lambda e: e.starts_at)
    return CalendarOut(month=f"{year:04d}-{month:02d}", events=events)


# ---------------------------------------------------------------- geração das preventivas


def _generate(ctx: Ctx, rule: PreventiveMaintenance, scheduled_at: datetime, due_at: datetime,
              reservation_id: uuid.UUID | None, result: JobResult) -> bool:
    try:
        with ctx.db.begin_nested():
            ctx.status_note(f"Gerada pela preventiva “{rule.name}”.")
            inc = Incident(
                condominium_id=ctx.condominium_id,
                title=rule.name,
                description=rule.description,
                location_id=rule.location_id,
                maintenance_type_id=rule.maintenance_type_id,
                origin=IncidentOrigin.preventive,
                preventive_maintenance_id=rule.id,
                trigger_reservation_id=reservation_id,
                status=IncidentStatus.approved,
                priority=IncidentPriority.medium,
                assigned_provider_id=rule.default_provider_id,
                scheduled_start_at=scheduled_at,
                due_at=due_at,
            )
            ctx.db.add(inc)
            ctx.db.flush()
        ctx.db.refresh(inc)
        result.created.append(inc.code)
        return True
    except DBAPIError as exc:
        err = translate_db_error(exc)
        result.errors.append(f"{rule.name}: {err.message if err else exc.orig}")
        return False


def run_preventive_job(ctx: Ctx, now: datetime | None = None) -> JobResult:
    """Gera as ocorrências das preventivas vencidas e dos eventos de reserva já ocorridos.

    Em produção isto roda num agendador; na POC é disparado por endpoint.
    """
    now = now or ctx.now()
    result = JobResult(created=[], errors=[])

    recurring = ctx.db.scalars(
        select(PreventiveMaintenance).where(
            PreventiveMaintenance.condominium_id == ctx.condominium_id,
            PreventiveMaintenance.is_active,
            PreventiveMaintenance.trigger_type == PreventiveTrigger.recurring,
            PreventiveMaintenance.next_run_at <= now,
        )
    ).all()
    for rule in recurring:
        due = rule.next_run_at + timedelta(days=5)  # prioridade média
        if _generate(ctx, rule, rule.next_run_at, due, None, result):  # com erro, tenta de novo na próxima execução
            rule.next_run_at = recurrence.next_occurrence(rule, ctx.tz, now, inclusive=False)

    event_rules = ctx.db.execute(
        select(PreventiveMaintenance, MaintenanceLocation.condo_space_id)
        .join(MaintenanceLocation, MaintenanceLocation.id == PreventiveMaintenance.location_id)
        .where(
            PreventiveMaintenance.condominium_id == ctx.condominium_id,
            PreventiveMaintenance.is_active,
            PreventiveMaintenance.trigger_type == PreventiveTrigger.event,
            PreventiveMaintenance.trigger_event.in_(
                [PreventiveEvent.reservation_ended, PreventiveEvent.reservation_canceled]
            ),
        )
    ).all()
    for rule, space_id in event_rules:
        if rule.trigger_event == PreventiveEvent.reservation_ended:
            event_at, status = Reservation.end_datetime, ReservationStatus.confirmed
        else:
            event_at, status = Reservation.canceled_at, ReservationStatus.canceled
        already = select(Incident.trigger_reservation_id).where(
            Incident.preventive_maintenance_id == rule.id, Incident.trigger_reservation_id.is_not(None)
        )
        pending = ctx.db.execute(
            select(Reservation.id, event_at).where(
                Reservation.condo_space_id == space_id,
                Reservation.status == status,
                event_at <= now,
                event_at >= rule.created_at,  # não gera retroativamente para reservas anteriores à regra
                Reservation.id.not_in(already),
            )
        ).all()
        for reservation_id, happened_at in pending:
            due = recurrence.event_due_at(rule.execution_window, happened_at, ctx.tz)
            _generate(ctx, rule, happened_at, due, reservation_id, result)

    ctx.db.flush()
    return result
