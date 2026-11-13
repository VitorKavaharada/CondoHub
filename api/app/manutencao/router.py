import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from sqlalchemy import or_, select

from app.context import CtxDep
from app.enums import (
    OPEN_INCIDENT_STATUSES,
    IncidentOrigin,
    IncidentPriority,
    IncidentStatus,
    PreventiveTrigger,
    ProviderKind,
)
from app.manutencao import service
from app.manutencao.models import (
    Incident,
    MaintenanceLocation,
    MaintenanceType,
    PreventiveMaintenance,
    ServiceProvider,
    ServiceProviderSpecialty,
)
from app.manutencao.schemas import (
    ApproveIn,
    AttachmentCreate,
    AttachmentOut,
    CalendarOut,
    FinishIn,
    HistoryGroup,
    HistoryOut,
    IncidentCreate,
    IncidentDetail,
    IncidentOut,
    IncidentSummary,
    JobResult,
    LocationCreate,
    LocationOut,
    NamedItemCreate,
    NamedItemOut,
    NamedItemUpdate,
    PreventiveCreate,
    PreventiveOut,
    PreventiveUpdate,
    ProviderCreate,
    ProviderDetail,
    ProviderOut,
    ProviderUpdate,
    RateIn,
    RejectIncidentIn,
    ScheduledIncidentCreate,
    StartIn,
)

router = APIRouter(prefix="/condominiums/{condominium_id}")
CATALOG = "Manutenção · cadastros"
INCIDENTS = "Manutenção · ocorrências"
HISTORY = "Manutenção · histórico"
PROVIDERS = "Manutenção · prestadores"
PREVENTIVE = "Manutenção · preventivas"
MONTH = Annotated[str, Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", examples=["2026-11"])]


# ---------------------------------------------------------------- tipos e locais


@router.get("/maintenance-types", response_model=list[NamedItemOut], tags=[CATALOG], summary="Tipos de manutenção")
def list_types(ctx: CtxDep, active: bool | None = None):
    query = select(MaintenanceType).where(MaintenanceType.condominium_id == ctx.condominium_id).order_by(MaintenanceType.name)
    if active is not None:
        query = query.where(MaintenanceType.is_active == active)
    return ctx.db.scalars(query).all()


@router.post("/maintenance-types", response_model=NamedItemOut, status_code=201, tags=[CATALOG], summary="Cadastrar tipo")
def create_type(ctx: CtxDep, data: NamedItemCreate):
    item = MaintenanceType(condominium_id=ctx.condominium_id, name=data.name)
    ctx.db.add(item)
    ctx.db.flush()
    ctx.db.refresh(item)
    return item


@router.patch("/maintenance-types/{type_id}", response_model=NamedItemOut, tags=[CATALOG], summary="Editar ou desativar tipo")
def update_type(ctx: CtxDep, type_id: uuid.UUID, data: NamedItemUpdate):
    item = service._get(ctx, MaintenanceType, type_id, "Tipo de manutenção")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    ctx.db.flush()
    return item


@router.get("/maintenance-locations", response_model=list[LocationOut], tags=[CATALOG], summary="Locais de manutenção")
def list_locations(ctx: CtxDep, active: bool | None = None):
    query = (
        select(MaintenanceLocation)
        .where(MaintenanceLocation.condominium_id == ctx.condominium_id)
        .order_by(MaintenanceLocation.name)
    )
    if active is not None:
        query = query.where(MaintenanceLocation.is_active == active)
    return ctx.db.scalars(query).all()


@router.post("/maintenance-locations", response_model=LocationOut, status_code=201, tags=[CATALOG], summary="Cadastrar local")
def create_location(ctx: CtxDep, data: LocationCreate):
    item = MaintenanceLocation(condominium_id=ctx.condominium_id, **data.model_dump())
    ctx.db.add(item)
    ctx.db.flush()
    ctx.db.refresh(item)
    return item


@router.patch("/maintenance-locations/{location_id}", response_model=LocationOut, tags=[CATALOG], summary="Editar ou desativar local")
def update_location(ctx: CtxDep, location_id: uuid.UUID, data: NamedItemUpdate):
    item = service._get(ctx, MaintenanceLocation, location_id, "Local")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    ctx.db.flush()
    return item


# ---------------------------------------------------------------- ocorrências


@router.get(
    "/incidents",
    response_model=list[IncidentOut],
    tags=[INCIDENTS],
    summary="Listar ocorrências",
    description=(
        "Painel do síndico e lista do morador. `mine=true` traz só as abertas pelo usuário do X-User-Id; "
        "`open=true` exclui done/rejected."
    ),
)
def list_incidents(
    ctx: CtxDep,
    mine: bool = False,
    open_: Annotated[bool | None, Query(alias="open")] = None,
    status: Annotated[list[IncidentStatus] | None, Query()] = None,
    priority: Annotated[list[IncidentPriority] | None, Query()] = None,
    without_priority: Annotated[bool, Query(description="Inclui as sem prioridade (filtro 'Sem prioridade')")] = False,
    origin: Annotated[list[IncidentOrigin] | None, Query()] = None,
    location_id: uuid.UUID | None = None,
    maintenance_type_id: uuid.UUID | None = None,
    provider_id: uuid.UUID | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    limit: Annotated[int, Query(le=500)] = 200,
):
    query = service.incident_select(ctx).order_by(Incident.created_at.desc()).limit(limit)
    if mine:
        query = query.where(Incident.requested_by_user_id == ctx.require_user())
    if open_ is True:
        query = query.where(Incident.status.in_(OPEN_INCIDENT_STATUSES))
    elif open_ is False:
        query = query.where(Incident.status.not_in(OPEN_INCIDENT_STATUSES))
    if status:
        query = query.where(Incident.status.in_(status))
    if priority or without_priority:
        conditions = []
        if priority:
            conditions.append(Incident.priority.in_(priority))
        if without_priority:
            conditions.append(Incident.priority.is_(None))
        query = query.where(or_(*conditions))
    if origin:
        query = query.where(Incident.origin.in_(origin))
    if location_id:
        query = query.where(Incident.location_id == location_id)
    if maintenance_type_id:
        query = query.where(Incident.maintenance_type_id == maintenance_type_id)
    if provider_id:
        query = query.where(Incident.assigned_provider_id == provider_id)
    if created_from:
        query = query.where(Incident.created_at >= created_from)
    if created_to:
        query = query.where(Incident.created_at < created_to)
    return [service.to_out(row) for row in ctx.db.execute(query)]


@router.get("/incidents/summary", response_model=IncidentSummary, tags=[INCIDENTS], summary="Indicadores do painel")
def incidents_summary(ctx: CtxDep):
    return service.summary(ctx)


@router.post(
    "/incidents",
    response_model=IncidentDetail,
    status_code=201,
    tags=[INCIDENTS],
    summary="Abrir solicitação (morador)",
    description="Nasce como `submitted`. O protocolo (MNT-0001) é gerado pelo banco.",
)
def create_incident(ctx: CtxDep, data: IncidentCreate):
    return service.incident_detail(ctx, service.create_resident_incident(ctx, data).id)


@router.post(
    "/incidents/scheduled",
    response_model=IncidentDetail,
    status_code=201,
    tags=[INCIDENTS],
    summary="Agendar manutenção avulsa (síndico)",
    description="Nasce como `approved`, sem passar por análise.",
)
def create_scheduled_incident(ctx: CtxDep, data: ScheduledIncidentCreate):
    return service.incident_detail(ctx, service.create_scheduled_incident(ctx, data).id)


@router.get(
    "/incidents/{incident_id}",
    response_model=IncidentDetail,
    tags=[INCIDENTS],
    summary="Detalhe com linha do tempo",
    description="Inclui `location_context`: última manutenção concluída e as agendadas no mesmo local.",
)
def get_incident(ctx: CtxDep, incident_id: uuid.UUID):
    return service.incident_detail(ctx, incident_id)


@router.post(
    "/incidents/{incident_id}/review",
    response_model=IncidentDetail,
    tags=[INCIDENTS],
    summary="Colocar em análise",
    description="submitted → under_review. Chamar ao abrir a solicitação no painel, antes de aprovar.",
)
def review_incident(ctx: CtxDep, incident_id: uuid.UUID):
    service.review_incident(ctx, service.get_incident(ctx, incident_id))
    return service.incident_detail(ctx, incident_id)


@router.post(
    "/incidents/{incident_id}/approve",
    response_model=IncidentDetail,
    tags=[INCIDENTS],
    summary="Aprovar e atribuir",
    description="under_review → approved. O prazo (due_at) é calculado pela prioridade.",
)
def approve_incident(ctx: CtxDep, incident_id: uuid.UUID, data: ApproveIn):
    service.approve_incident(ctx, service.get_incident(ctx, incident_id), data)
    return service.incident_detail(ctx, incident_id)


@router.post(
    "/incidents/{incident_id}/reject",
    response_model=IncidentDetail,
    tags=[INCIDENTS],
    summary="Recusar e notificar morador",
    description="submitted/under_review → rejected. Com `already_scheduled`, informe `related_incident_id`.",
)
def reject_incident(ctx: CtxDep, incident_id: uuid.UUID, data: RejectIncidentIn):
    service.reject_incident(ctx, service.get_incident(ctx, incident_id), data)
    return service.incident_detail(ctx, incident_id)


@router.post("/incidents/{incident_id}/start", response_model=IncidentDetail, tags=[INCIDENTS], summary="Iniciar execução")
def start_incident(ctx: CtxDep, incident_id: uuid.UUID, data: StartIn | None = None):
    service.start_incident(ctx, service.get_incident(ctx, incident_id), data.started_at if data else None)
    return service.incident_detail(ctx, incident_id)


@router.post("/incidents/{incident_id}/finish", response_model=IncidentDetail, tags=[INCIDENTS], summary="Concluir")
def finish_incident(ctx: CtxDep, incident_id: uuid.UUID, data: FinishIn | None = None):
    service.finish_incident(ctx, service.get_incident(ctx, incident_id), data or FinishIn())
    return service.incident_detail(ctx, incident_id)


@router.post("/incidents/{incident_id}/rating", response_model=IncidentDetail, tags=[INCIDENTS], summary="Avaliar serviço (morador)")
def rate_incident(ctx: CtxDep, incident_id: uuid.UUID, data: RateIn):
    service.rate_incident(ctx, service.get_incident(ctx, incident_id), data)
    return service.incident_detail(ctx, incident_id)


@router.post(
    "/incidents/{incident_id}/attachments",
    response_model=AttachmentOut,
    status_code=201,
    tags=[INCIDENTS],
    summary="Anexar foto",
    description="Recebe o endereço do arquivo já armazenado (upload fora do escopo da POC).",
)
def add_attachment(ctx: CtxDep, incident_id: uuid.UUID, data: AttachmentCreate):
    return service.add_attachment(ctx, service.get_incident(ctx, incident_id), data.file_url)


# ---------------------------------------------------------------- histórico


@router.get(
    "/maintenance-history/groups",
    response_model=list[HistoryGroup],
    tags=[HISTORY],
    summary="Contagem por local ou tipo",
    description="Manutenções concluídas no período (padrão: últimos 12 meses).",
)
def history_groups(ctx: CtxDep, by: Literal["location", "type"] = "location", start: date | None = None, end: date | None = None):
    return service.history_groups(ctx, by, start, end)


@router.get("/maintenance-history", response_model=HistoryOut, tags=[HISTORY], summary="Registros de um local ou tipo")
def history(
    ctx: CtxDep,
    location_id: uuid.UUID | None = None,
    maintenance_type_id: uuid.UUID | None = None,
    start: date | None = None,
    end: date | None = None,
):
    return service.history(ctx, location_id, maintenance_type_id, start, end)


# ---------------------------------------------------------------- prestadores


@router.get("/service-providers", response_model=list[ProviderOut], tags=[PROVIDERS], summary="Listar prestadores e equipe")
def list_providers(
    ctx: CtxDep,
    kind: ProviderKind | None = None,
    active: bool | None = None,
    maintenance_type_id: Annotated[
        uuid.UUID | None, Query(description="Só quem atende este tipo (lista de responsáveis ao aprovar)")
    ] = None,
):
    query = select(ServiceProvider).where(ServiceProvider.condominium_id == ctx.condominium_id).order_by(ServiceProvider.name)
    if kind:
        query = query.where(ServiceProvider.kind == kind)
    if active is not None:
        query = query.where(ServiceProvider.is_active == active)
    if maintenance_type_id:
        query = query.where(
            ServiceProvider.id.in_(
                select(ServiceProviderSpecialty.service_provider_id).where(
                    ServiceProviderSpecialty.maintenance_type_id == maintenance_type_id
                )
            )
        )
    return service.provider_out(ctx, list(ctx.db.scalars(query)))


@router.post("/service-providers", response_model=ProviderDetail, status_code=201, tags=[PROVIDERS], summary="Cadastrar prestador")
def create_provider(ctx: CtxDep, data: ProviderCreate):
    return service.provider_detail(ctx, service.create_provider(ctx, data))


@router.get(
    "/service-providers/{provider_id}",
    response_model=ProviderDetail,
    tags=[PROVIDERS],
    summary="Detalhe com escala",
    description="`schedule.incidents`: ocorrências em aberto; `schedule.preventive_rules`: regras ativas sob sua responsabilidade.",
)
def get_provider(ctx: CtxDep, provider_id: uuid.UUID):
    return service.provider_detail(ctx, service.get_provider(ctx, provider_id))


@router.patch("/service-providers/{provider_id}", response_model=ProviderDetail, tags=[PROVIDERS], summary="Editar ou desativar prestador")
def update_provider(ctx: CtxDep, provider_id: uuid.UUID, data: ProviderUpdate):
    return service.provider_detail(ctx, service.update_provider(ctx, service.get_provider(ctx, provider_id), data))


# ---------------------------------------------------------------- preventivas


@router.get("/preventive-maintenances", response_model=list[PreventiveOut], tags=[PREVENTIVE], summary="Regras preventivas")
def list_preventives(ctx: CtxDep, active: bool | None = None, trigger_type: PreventiveTrigger | None = None):
    query = service.preventive_select(ctx).order_by(PreventiveMaintenance.name)
    if active is not None:
        query = query.where(PreventiveMaintenance.is_active == active)
    if trigger_type:
        query = query.where(PreventiveMaintenance.trigger_type == trigger_type)
    return [service.preventive_out(row) for row in ctx.db.execute(query)]


@router.post("/preventive-maintenances", response_model=PreventiveOut, status_code=201, tags=[PREVENTIVE], summary="Nova regra")
def create_preventive(ctx: CtxDep, data: PreventiveCreate):
    return service.preventive_detail(ctx, service.create_preventive(ctx, data).id)


@router.get("/preventive-maintenances/{rule_id}", response_model=PreventiveOut, tags=[PREVENTIVE], summary="Detalhe da regra")
def get_preventive(ctx: CtxDep, rule_id: uuid.UUID):
    return service.preventive_detail(ctx, rule_id)


@router.patch(
    "/preventive-maintenances/{rule_id}",
    response_model=PreventiveOut,
    tags=[PREVENTIVE],
    summary="Editar, pausar ou reativar regra",
)
def update_preventive(ctx: CtxDep, rule_id: uuid.UUID, data: PreventiveUpdate):
    rule = service._get(ctx, PreventiveMaintenance, rule_id, "Manutenção preventiva")
    service.update_preventive(ctx, rule, data)
    return service.preventive_detail(ctx, rule_id)


@router.get(
    "/maintenance-calendar",
    response_model=CalendarOut,
    tags=[PREVENTIVE],
    summary="Agenda do mês",
    description="Ocorrências agendadas no mês e as próximas execuções previstas das regras recorrentes (`projected`).",
)
def maintenance_calendar(ctx: CtxDep, month: MONTH):
    year, mon = (int(p) for p in month.split("-"))
    return service.calendar_month(ctx, year, mon)


@router.post(
    "/jobs/preventive-maintenance/run",
    response_model=JobResult,
    tags=[PREVENTIVE],
    summary="Gerar ocorrências preventivas (POC)",
    description=(
        "Gera as ocorrências das regras recorrentes vencidas e das reservas encerradas/canceladas. "
        "Em produção roda num agendador. `now` permite simular uma data na POC."
    ),
)
def run_preventive_job(ctx: CtxDep, now: datetime | None = None):
    return service.run_preventive_job(ctx, now)

