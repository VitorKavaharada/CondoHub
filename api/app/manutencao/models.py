import uuid
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import FetchedValue, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
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
    pg_enum,
)


class MaintenanceType(Base):
    __tablename__ = "maintenance_type"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    name: Mapped[str]
    is_active: Mapped[bool] = mapped_column(server_default="true")


class MaintenanceLocation(Base):
    __tablename__ = "maintenance_location"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    name: Mapped[str]
    condo_space_id: Mapped[uuid.UUID | None]
    is_active: Mapped[bool] = mapped_column(server_default="true")


class ServiceProvider(Base):
    __tablename__ = "service_provider"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    kind: Mapped[ProviderKind] = mapped_column(pg_enum(ProviderKind, "provider_kind"))
    name: Mapped[str]
    document: Mapped[str | None]
    job_title: Mapped[str | None]
    team_size: Mapped[int] = mapped_column(server_default="1")
    phone: Mapped[str | None]
    contract_type: Mapped[ProviderContract | None] = mapped_column(pg_enum(ProviderContract, "provider_contract"))
    contract_valid_until: Mapped[date | None]
    shift: Mapped[EmployeeShift | None] = mapped_column(pg_enum(EmployeeShift, "employee_shift"))
    is_active: Mapped[bool] = mapped_column(server_default="true")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ServiceProviderSpecialty(Base):
    __tablename__ = "service_provider_specialty"

    condominium_id: Mapped[uuid.UUID]
    service_provider_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    maintenance_type_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)


class PreventiveMaintenance(Base):
    __tablename__ = "preventive_maintenance"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    name: Mapped[str]
    description: Mapped[str | None]
    maintenance_type_id: Mapped[uuid.UUID]
    location_id: Mapped[uuid.UUID]
    trigger_type: Mapped[PreventiveTrigger] = mapped_column(pg_enum(PreventiveTrigger, "preventive_trigger"))
    frequency: Mapped[PreventiveFrequency | None] = mapped_column(pg_enum(PreventiveFrequency, "preventive_frequency"))
    first_run_date: Mapped[date | None]
    run_time: Mapped[time | None]
    trigger_event: Mapped[PreventiveEvent | None] = mapped_column(pg_enum(PreventiveEvent, "preventive_event"))
    execution_window: Mapped[PreventiveWindow | None] = mapped_column(pg_enum(PreventiveWindow, "preventive_window"))
    default_provider_id: Mapped[uuid.UUID | None]
    reminder_days_before: Mapped[int] = mapped_column(server_default="2")
    next_run_at: Mapped[datetime | None]
    is_active: Mapped[bool] = mapped_column(server_default="true")
    created_by: Mapped[uuid.UUID]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Incident(Base):
    __tablename__ = "incident"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    code: Mapped[str] = mapped_column(server_default=FetchedValue())  # gerado pelo trigger
    title: Mapped[str]
    description: Mapped[str | None]
    location_id: Mapped[uuid.UUID]
    maintenance_type_id: Mapped[uuid.UUID]
    origin: Mapped[IncidentOrigin] = mapped_column(pg_enum(IncidentOrigin, "incident_origin"))
    requested_by_user_id: Mapped[uuid.UUID | None]
    unit_id: Mapped[uuid.UUID | None]
    preventive_maintenance_id: Mapped[uuid.UUID | None]
    trigger_reservation_id: Mapped[uuid.UUID | None]
    status: Mapped[IncidentStatus] = mapped_column(pg_enum(IncidentStatus, "incident_status"))
    priority: Mapped[IncidentPriority | None] = mapped_column(pg_enum(IncidentPriority, "incident_priority"))
    due_at: Mapped[datetime | None]
    assigned_provider_id: Mapped[uuid.UUID | None]
    scheduled_start_at: Mapped[datetime | None]
    scheduled_end_at: Mapped[datetime | None]
    reviewed_by_user_id: Mapped[uuid.UUID | None]
    reviewed_at: Mapped[datetime | None]
    rejection_reason: Mapped[IncidentRejection | None] = mapped_column(pg_enum(IncidentRejection, "incident_rejection"))
    rejection_note: Mapped[str | None]
    related_incident_id: Mapped[uuid.UUID | None]
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]
    cost: Mapped[Decimal | None]
    resident_rating: Mapped[int | None]
    resident_feedback: Mapped[str | None]
    rated_at: Mapped[datetime | None]
    created_by_user_id: Mapped[uuid.UUID | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class IncidentStatusHistory(Base):
    __tablename__ = "incident_status_history"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    incident_id: Mapped[uuid.UUID]
    status: Mapped[IncidentStatus] = mapped_column(pg_enum(IncidentStatus, "incident_status"))
    note: Mapped[str | None]
    changed_by_user_id: Mapped[uuid.UUID | None]
    changed_at: Mapped[datetime] = mapped_column(server_default=func.now())


class IncidentAttachment(Base):
    __tablename__ = "incident_attachment"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    incident_id: Mapped[uuid.UUID]
    file_url: Mapped[str]
    uploaded_by_user_id: Mapped[uuid.UUID]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
