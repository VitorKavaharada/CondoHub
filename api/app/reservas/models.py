import uuid
from datetime import datetime, time

from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.enums import BookingMode, ReservationStatus, pg_enum


class CondoSpace(Base):
    __tablename__ = "condo_space"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    name: Mapped[str]
    description: Mapped[str | None]
    capacity: Mapped[int | None]
    icon: Mapped[str | None]
    booking_mode: Mapped[BookingMode] = mapped_column(pg_enum(BookingMode, "booking_mode"))
    opens_at: Mapped[time | None]
    closes_at: Mapped[time | None]
    slot_minutes: Mapped[int | None]
    max_per_unit: Mapped[int] = mapped_column(server_default="3")
    booking_horizon_days: Mapped[int] = mapped_column(server_default="90")
    requires_terms: Mapped[bool] = mapped_column(server_default="false")
    is_active: Mapped[bool] = mapped_column(server_default="true")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class RulesDocument(Base):
    __tablename__ = "rules_document"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    condo_space_id: Mapped[uuid.UUID]
    file_url: Mapped[str]
    file_size_bytes: Mapped[int | None]
    summary: Mapped[str | None]
    version: Mapped[int]
    published_at: Mapped[datetime] = mapped_column(server_default=func.now())
    published_by: Mapped[uuid.UUID]


class Reservation(Base):
    __tablename__ = "reservation"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    condo_space_id: Mapped[uuid.UUID]
    unit_id: Mapped[uuid.UUID]
    requested_by: Mapped[uuid.UUID]
    start_datetime: Mapped[datetime]
    end_datetime: Mapped[datetime]
    status: Mapped[ReservationStatus] = mapped_column(
        pg_enum(ReservationStatus, "reservation_status"), default=ReservationStatus.pending
    )
    reviewed_by: Mapped[uuid.UUID | None]
    reviewed_at: Mapped[datetime | None]
    rejection_reason: Mapped[str | None]
    canceled_at: Mapped[datetime | None]
    canceled_by: Mapped[uuid.UUID | None]
    cancel_reason: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now())


class TermsAcceptance(Base):
    __tablename__ = "terms_acceptance"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    reservation_id: Mapped[uuid.UUID]
    rules_document_id: Mapped[uuid.UUID]
    condo_space_id: Mapped[uuid.UUID]
    user_id: Mapped[uuid.UUID]
    accepted_at: Mapped[datetime] = mapped_column(server_default=func.now())


class SpaceBlock(Base):
    __tablename__ = "space_block"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    condo_space_id: Mapped[uuid.UUID]
    starts_at: Mapped[datetime]
    ends_at: Mapped[datetime]
    reason: Mapped[str]
    incident_id: Mapped[uuid.UUID | None]
    created_by: Mapped[uuid.UUID]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
