import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.enums import UnitRelation, UserRole


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Ref(Schema):
    """Referência curta a outro registro (id + nome para exibir)."""

    id: uuid.UUID
    name: str


class CondominiumOut(Schema):
    id: uuid.UUID
    name: str
    management_company: str | None
    timezone: str


class UnitOut(Schema):
    id: uuid.UUID
    code: str
    block: str
    label: str
    inadimplente: bool = Field(description="Unidade com pendência financeira: os moradores não reservam áreas comuns")


class MemberUnitOut(UnitOut):
    relation: UnitRelation


class MemberOut(Schema):
    user_id: uuid.UUID
    name: str
    email: str
    role: UserRole
    is_active: bool
    has_pending_dues: bool = Field(description="Alguma unidade da pessoa está inadimplente")
    units: list[MemberUnitOut]


class NotificationOut(Schema):
    id: uuid.UUID
    kind: str
    title: str
    body: str | None
    incident_id: uuid.UUID | None
    reservation_id: uuid.UUID | None
    read_at: datetime | None
    created_at: datetime
