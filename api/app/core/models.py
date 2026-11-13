import uuid
from datetime import datetime

from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.enums import UnitRelation, UserRole, pg_enum


class Condominium(Base):
    __tablename__ = "condominium"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]
    document: Mapped[str | None]
    management_company: Mapped[str | None]
    timezone: Mapped[str] = mapped_column(server_default="America/Sao_Paulo")
    is_active: Mapped[bool] = mapped_column(server_default="true")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AppUser(Base):
    __tablename__ = "app_user"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str]
    email: Mapped[str]
    is_active: Mapped[bool] = mapped_column(server_default="true")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class CondominiumUser(Base):
    __tablename__ = "condominium_user"

    condominium_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    role: Mapped[UserRole] = mapped_column(pg_enum(UserRole, "user_role"))
    is_active: Mapped[bool] = mapped_column(server_default="true")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class Unit(Base):
    __tablename__ = "unit"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    code: Mapped[str]
    block: Mapped[str]
    # Pendência financeira da unidade: bloqueia reservas de todos os moradores dela.
    inadimplente: Mapped[bool] = mapped_column(server_default="false")

    @property
    def label(self) -> str:
        return f"Apto {self.code} · Bloco {self.block}"


class UnitResident(Base):
    __tablename__ = "unit_resident"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    unit_id: Mapped[uuid.UUID]
    user_id: Mapped[uuid.UUID]
    relation: Mapped[UnitRelation] = mapped_column(pg_enum(UnitRelation, "unit_relation"))


class Notification(Base):
    __tablename__ = "notification"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    condominium_id: Mapped[uuid.UUID]
    user_id: Mapped[uuid.UUID]
    kind: Mapped[str]
    title: Mapped[str]
    body: Mapped[str | None]
    incident_id: Mapped[uuid.UUID | None]
    reservation_id: Mapped[uuid.UUID | None]
    read_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
