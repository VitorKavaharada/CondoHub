import uuid
from datetime import date, datetime, time
from typing import Literal

from pydantic import Field

from app.core.schemas import Ref, Schema, UnitOut
from app.enums import BookingMode, ReservationStatus

# ---------------------------------------------------------------- áreas


class RulesDocumentOut(Schema):
    id: uuid.UUID
    version: int
    file_url: str
    file_size_bytes: int | None
    summary: str | None
    published_at: datetime


class RulesDocumentCreate(Schema):
    file_url: str = Field(description="Endereço do PDF já armazenado (upload fora do escopo da POC)")
    file_size_bytes: int | None = None
    summary: str | None = Field(None, description="Resumo das regras, uma por linha")


class SpaceBlockOut(Schema):
    id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    reason: str
    incident_id: uuid.UUID | None


class SpaceBlockCreate(Schema):
    starts_at: datetime
    ends_at: datetime
    reason: str = Field(examples=["Manutenção"])
    incident_id: uuid.UUID | None = Field(None, description="Ocorrência de manutenção que motivou o bloqueio")


class SpaceFields(Schema):
    description: str | None = None
    capacity: int | None = Field(None, gt=0)
    icon: str | None = None
    opens_at: time | None = Field(None, description="Só no modo hourly")
    closes_at: time | None = Field(None, description="Só no modo hourly")
    slot_minutes: int | None = Field(None, gt=0, description="Duração do bloco; só no modo hourly")
    max_per_unit: int = Field(3, ge=1, le=10)
    booking_horizon_days: int = Field(90, gt=0)
    requires_terms: bool = False
    is_active: bool = True


class SpaceCreate(SpaceFields):
    name: str
    booking_mode: BookingMode


class SpaceUpdate(Schema):
    name: str | None = None
    description: str | None = None
    capacity: int | None = Field(None, gt=0)
    icon: str | None = None
    booking_mode: BookingMode | None = None
    opens_at: time | None = None
    closes_at: time | None = None
    slot_minutes: int | None = Field(None, gt=0)
    max_per_unit: int | None = Field(None, ge=1, le=10)
    booking_horizon_days: int | None = Field(None, gt=0)
    requires_terms: bool | None = None
    is_active: bool | None = None


class SpaceOut(SpaceCreate):
    id: uuid.UUID
    current_block: SpaceBlockOut | None = Field(
        None, description="Bloqueio vigente agora (ex.: selo 'Manutenção' na lista do admin)"
    )
    rules_document: RulesDocumentOut | None = Field(None, description="Regulamento vigente")


# ---------------------------------------------------------------- disponibilidade

DayStatus = Literal["available", "partial", "full", "unavailable", "past"]
SlotStatus = Literal["available", "occupied", "unavailable", "past"]


class DayAvailability(Schema):
    date: date
    status: DayStatus = Field(
        description=(
            "available: livre · partial: por horário com algum bloco ocupado (ainda reservável) · "
            "full: sem horário livre / dia já reservado · unavailable: bloqueado, área inativa ou "
            "fora do prazo de antecedência · past: data passada"
        )
    )
    free_slots: int


class MonthAvailability(Schema):
    space_id: uuid.UUID
    booking_mode: BookingMode
    month: str
    last_bookable_date: date
    days: list[DayAvailability]


class SlotOut(Schema):
    start: datetime
    end: datetime
    start_time: time
    status: SlotStatus


class DaySlots(Schema):
    space_id: uuid.UUID
    date: date
    booking_mode: BookingMode
    slots: list[SlotOut]


# ---------------------------------------------------------------- reservas


class ReservationCreate(Schema):
    space_id: uuid.UUID
    unit_id: uuid.UUID
    date: date
    start_time: time | None = Field(None, description="Obrigatório em áreas por horário; ignorado no dia todo")
    accept_terms: bool = Field(False, description="Aceite do regulamento (obrigatório se a área exigir)")
    rules_document_id: uuid.UUID | None = Field(
        None, description="Versão que o morador leu; se informada e não for a vigente, retorna terms_outdated"
    )


class ReservationUpdate(Schema):
    date: date
    start_time: time | None = None


class CancelIn(Schema):
    reason: str | None = None


class RejectIn(Schema):
    reason: str


class ReservationOut(Schema):
    id: uuid.UUID
    space: Ref
    booking_mode: BookingMode
    unit: UnitOut
    requested_by: Ref
    start_datetime: datetime
    end_datetime: datetime
    status: ReservationStatus
    reviewed_at: datetime | None
    rejection_reason: str | None
    canceled_at: datetime | None
    cancel_reason: str | None
    terms_accepted_at: datetime | None
    created_at: datetime
