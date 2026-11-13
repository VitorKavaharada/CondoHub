import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.core.schemas import Ref, Schema, UnitOut
from app.enums import (
    EmployeeShift,
    IncidentOrigin,
    IncidentPriority,
    IncidentRejection,
    IncidentStatus,
    PreventiveEvent,
    PreventiveFrequency,
    PreventiveTrigger,
    PreventiveWindow,
    ProviderContract,
    ProviderKind,
)

# ---------------------------------------------------------------- cadastros


class NamedItemOut(Schema):
    id: uuid.UUID
    name: str
    is_active: bool


class LocationOut(NamedItemOut):
    condo_space_id: uuid.UUID | None


class NamedItemCreate(Schema):
    name: str


class LocationCreate(NamedItemCreate):
    condo_space_id: uuid.UUID | None = None


class NamedItemUpdate(Schema):
    name: str | None = None
    is_active: bool | None = None


# ---------------------------------------------------------------- ocorrências


class IncidentBrief(Schema):
    id: uuid.UUID
    code: str
    title: str
    status: IncidentStatus
    origin: IncidentOrigin
    location: Ref
    maintenance_type: Ref
    assigned_provider: Ref | None
    scheduled_start_at: datetime | None
    scheduled_end_at: datetime | None
    finished_at: datetime | None


class IncidentOut(IncidentBrief):
    description: str | None
    preventive_trigger: PreventiveTrigger | None = Field(
        description="Quando origin = preventive: recurring ou event"
    )
    requested_by: Ref | None
    unit: UnitOut | None
    priority: IncidentPriority | None
    due_at: datetime | None
    rejection_reason: IncidentRejection | None
    rejection_note: str | None
    started_at: datetime | None
    cost: Decimal | None
    created_at: datetime


class HistoryEntryOut(Schema):
    status: IncidentStatus
    note: str | None
    changed_by: Ref | None
    changed_at: datetime


class AttachmentOut(Schema):
    id: uuid.UUID
    file_url: str
    created_at: datetime


class LocationContext(Schema):
    """Apoio à decisão do síndico: o que já houve e o que está agendado no mesmo local."""

    last_done: IncidentBrief | None
    upcoming: list[IncidentBrief]


class IncidentDetail(IncidentOut):
    reviewed_by: Ref | None
    reviewed_at: datetime | None
    related_incident: IncidentBrief | None
    preventive_maintenance: Ref | None
    trigger_reservation_id: uuid.UUID | None
    resident_rating: int | None
    resident_feedback: str | None
    rated_at: datetime | None
    history: list[HistoryEntryOut]
    attachments: list[AttachmentOut]
    location_context: LocationContext


class IncidentCreate(Schema):
    """Solicitação aberta pelo morador (nasce submitted)."""

    title: str = Field(min_length=1, examples=["Vazamento no teto da garagem"])
    description: str | None = None
    location_id: uuid.UUID
    maintenance_type_id: uuid.UUID
    unit_id: uuid.UUID
    photo_urls: list[str] = Field(default_factory=list, description="Fotos já armazenadas (upload fora da POC)")


class ScheduledIncidentCreate(Schema):
    """Manutenção avulsa agendada pelo síndico (nasce approved)."""

    title: str = Field(min_length=1)
    description: str | None = None
    location_id: uuid.UUID
    maintenance_type_id: uuid.UUID
    priority: IncidentPriority
    assigned_provider_id: uuid.UUID
    scheduled_start_at: datetime | None = None
    scheduled_end_at: datetime | None = None


class ApproveIn(Schema):
    priority: IncidentPriority
    assigned_provider_id: uuid.UUID
    scheduled_start_at: datetime | None = None
    scheduled_end_at: datetime | None = None
    note: str | None = Field(None, description="Texto da etapa na linha do tempo; padrão: 'Prioridade alta. Responsável: X.'")


class RejectIncidentIn(Schema):
    reason: IncidentRejection
    note: str = Field(min_length=1, description="Justificativa exibida ao morador")
    related_incident_id: uuid.UUID | None = Field(None, description="Obrigatório com reason = already_scheduled")


class StartIn(Schema):
    started_at: datetime | None = None


class FinishIn(Schema):
    finished_at: datetime | None = None
    cost: Decimal | None = Field(None, ge=0)


class RateIn(Schema):
    rating: int = Field(ge=1, le=5)
    feedback: str | None = None


class AttachmentCreate(Schema):
    file_url: str


class IncidentSummary(Schema):
    by_status: dict[IncidentStatus, int]
    awaiting_decision: int = Field(description="submitted + under_review")
    open_by_priority: dict[Literal["high", "medium", "low", "none"], int]
    done_this_month: int


# ---------------------------------------------------------------- histórico


class HistoryGroup(Schema):
    id: uuid.UUID
    name: str
    count: int
    last_finished_at: datetime | None


class HistoryRecord(Schema):
    id: uuid.UUID
    code: str
    title: str
    finished_at: datetime
    origin: IncidentOrigin
    location: Ref
    maintenance_type: Ref
    provider: Ref | None
    provider_kind: ProviderKind | None
    provider_contract_type: ProviderContract | None
    cost: Decimal | None


class HistoryOut(Schema):
    total: int
    by_origin: dict[IncidentOrigin, int]
    last: HistoryRecord | None
    records: list[HistoryRecord]


# ---------------------------------------------------------------- prestadores


class ProviderFields(Schema):
    document: str | None = None
    job_title: str | None = None
    team_size: int = Field(1, ge=1)
    phone: str | None = None
    contract_type: ProviderContract | None = None
    contract_valid_until: date | None = None
    shift: EmployeeShift | None = None
    is_active: bool = True


class ProviderCreate(ProviderFields):
    kind: ProviderKind
    name: str
    specialty_ids: list[uuid.UUID] = Field(default_factory=list, description="Tipos de manutenção que atende")


class ProviderUpdate(Schema):
    name: str | None = None
    document: str | None = None
    job_title: str | None = None
    team_size: int | None = Field(None, ge=1)
    phone: str | None = None
    contract_type: ProviderContract | None = None
    contract_valid_until: date | None = None
    shift: EmployeeShift | None = None
    is_active: bool | None = Field(None, description="Prestadores não são excluídos, apenas desativados")
    specialty_ids: list[uuid.UUID] | None = Field(None, description="Substitui a lista de especialidades")


class ProviderOut(ProviderFields):
    id: uuid.UUID
    kind: ProviderKind
    name: str
    created_at: datetime
    specialties: list[Ref]
    open_assignments: int


class PreventiveBrief(Schema):
    id: uuid.UUID
    name: str
    trigger_type: PreventiveTrigger
    frequency: PreventiveFrequency | None
    trigger_event: PreventiveEvent | None
    location: Ref
    next_run_at: datetime | None


class ProviderSchedule(Schema):
    incidents: list[IncidentBrief] = Field(description="Ocorrências atribuídas que não estão em estado final")
    preventive_rules: list[PreventiveBrief] = Field(description="Regras ativas em que é o responsável padrão")


class ProviderDetail(ProviderOut):
    schedule: ProviderSchedule


# ---------------------------------------------------------------- preventivas


class PreventiveFields(Schema):
    description: str | None = None
    frequency: PreventiveFrequency | None = Field(None, description="Obrigatório em recurring")
    first_run_date: date | None = Field(None, description="Obrigatório em recurring")
    run_time: time | None = Field(None, description="Horário da execução; padrão 08:00")
    trigger_event: PreventiveEvent | None = Field(None, description="Obrigatório em event")
    execution_window: PreventiveWindow | None = Field(None, description="Obrigatório em event")
    default_provider_id: uuid.UUID | None = None
    reminder_days_before: int = Field(2, ge=0)
    is_active: bool = True


class PreventiveCreate(PreventiveFields):
    name: str
    maintenance_type_id: uuid.UUID
    location_id: uuid.UUID
    trigger_type: PreventiveTrigger


class PreventiveUpdate(Schema):
    name: str | None = None
    description: str | None = None
    maintenance_type_id: uuid.UUID | None = None
    location_id: uuid.UUID | None = None
    trigger_type: PreventiveTrigger | None = None
    frequency: PreventiveFrequency | None = None
    first_run_date: date | None = None
    run_time: time | None = None
    trigger_event: PreventiveEvent | None = None
    execution_window: PreventiveWindow | None = None
    default_provider_id: uuid.UUID | None = None
    reminder_days_before: int | None = Field(None, ge=0)
    is_active: bool | None = Field(None, description="false = pausada")


class PreventiveOut(Schema):
    id: uuid.UUID
    name: str
    description: str | None
    maintenance_type: Ref
    location: Ref
    trigger_type: PreventiveTrigger
    frequency: PreventiveFrequency | None
    first_run_date: date | None
    run_time: time | None
    trigger_event: PreventiveEvent | None
    execution_window: PreventiveWindow | None
    default_provider: Ref | None
    reminder_days_before: int
    next_run_at: datetime | None
    is_active: bool
    created_at: datetime


CalendarKind = Literal["recurring", "event", "manual", "corrective"]


class CalendarEvent(Schema):
    starts_at: datetime
    kind: CalendarKind = Field(
        description="recurring/event: preventivas · manual: avulsa do síndico · corrective: aberta por morador"
    )
    projected: bool = Field(description="true = ocorrência futura prevista por uma regra, ainda sem ocorrência gerada")
    title: str
    location: Ref
    provider: Ref | None
    incident_id: uuid.UUID | None
    incident_code: str | None
    status: IncidentStatus | None
    preventive_maintenance_id: uuid.UUID | None


class CalendarOut(Schema):
    month: str
    events: list[CalendarEvent]


class JobResult(Schema):
    created: list[str] = Field(description="Protocolos das ocorrências geradas")
    errors: list[str]
