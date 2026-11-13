"""Enums do banco (CREATE TYPE ... AS ENUM em db/01_schema.sql)."""

from enum import StrEnum

from sqlalchemy import Enum as SAEnum


def pg_enum(enum_cls: type[StrEnum], name: str) -> SAEnum:
    return SAEnum(enum_cls, name=name, create_type=False, values_callable=lambda e: [m.value for m in e])


class UserRole(StrEnum):
    resident = "resident"
    manager = "manager"
    admin = "admin"
    doorman = "doorman"
    technician = "technician"


class UnitRelation(StrEnum):
    resident = "resident"
    owner = "owner"


class BookingMode(StrEnum):
    full_day = "full_day"
    hourly = "hourly"


class ReservationStatus(StrEnum):
    pending = "pending"
    confirmed = "confirmed"
    canceled = "canceled"
    rejected = "rejected"


class IncidentOrigin(StrEnum):
    resident = "resident"
    manual = "manual"
    preventive = "preventive"


class IncidentStatus(StrEnum):
    submitted = "submitted"
    under_review = "under_review"
    approved = "approved"
    in_progress = "in_progress"
    done = "done"
    rejected = "rejected"


class IncidentPriority(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"


class IncidentRejection(StrEnum):
    already_done = "already_done"
    provider_already_requested = "provider_already_requested"
    already_scheduled = "already_scheduled"
    unit_responsibility = "unit_responsibility"
    other = "other"


class ProviderKind(StrEnum):
    external = "external"
    employee = "employee"


class ProviderContract(StrEnum):
    on_demand = "on_demand"
    monthly = "monthly"
    semiannual_annual = "semiannual_annual"


class EmployeeShift(StrEnum):
    morning = "morning"
    afternoon = "afternoon"
    business_hours = "business_hours"


class PreventiveTrigger(StrEnum):
    recurring = "recurring"
    event = "event"


class PreventiveFrequency(StrEnum):
    weekly = "weekly"
    monthly = "monthly"
    quarterly = "quarterly"
    semiannual = "semiannual"
    annual = "annual"


class PreventiveEvent(StrEnum):
    reservation_ended = "reservation_ended"
    reservation_canceled = "reservation_canceled"
    move_completed = "move_completed"


class PreventiveWindow(StrEnum):
    within_2h = "within_2h"
    within_4h = "within_4h"
    next_day_10am = "next_day_10am"


OPEN_INCIDENT_STATUSES = (
    IncidentStatus.submitted,
    IncidentStatus.under_review,
    IncidentStatus.approved,
    IncidentStatus.in_progress,
)
ACTIVE_RESERVATION_STATUSES = (ReservationStatus.pending, ReservationStatus.confirmed)
