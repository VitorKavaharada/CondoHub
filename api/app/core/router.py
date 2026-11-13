import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.context import CtxDep
from app.core.models import AppUser, Condominium, CondominiumUser, Notification, Unit, UnitResident
from app.core.schemas import CondominiumOut, MemberOut, MemberUnitOut, NotificationOut, UnitOut
from app.db import get_db
from app.errors import NotFound

router = APIRouter(tags=["Condomínio"])


@router.get("/condominiums", response_model=list[CondominiumOut], summary="Listar condomínios")
def list_condominiums(db: Session = Depends(get_db, scope="function")):
    return db.scalars(select(Condominium).where(Condominium.is_active).order_by(Condominium.name)).all()


@router.get("/condominiums/{condominium_id}", response_model=CondominiumOut, summary="Dados do condomínio")
def get_condominium(ctx: CtxDep):
    return ctx.condominium


@router.get("/condominiums/{condominium_id}/units", response_model=list[UnitOut], summary="Listar unidades")
def list_units(ctx: CtxDep):
    return ctx.db.scalars(
        select(Unit).where(Unit.condominium_id == ctx.condominium_id).order_by(Unit.block, Unit.code)
    ).all()


def _members(ctx, user_id: uuid.UUID | None = None) -> list[MemberOut]:
    query = (
        select(CondominiumUser, AppUser)
        .join(AppUser, AppUser.id == CondominiumUser.user_id)
        .where(CondominiumUser.condominium_id == ctx.condominium_id)
        .order_by(AppUser.name)
    )
    if user_id is not None:
        query = query.where(CondominiumUser.user_id == user_id)
    rows = ctx.db.execute(query).all()

    units: dict[uuid.UUID, list[MemberUnitOut]] = {}
    for ur, unit in ctx.db.execute(
        select(UnitResident, Unit)
        .join(Unit, Unit.id == UnitResident.unit_id)
        .where(UnitResident.condominium_id == ctx.condominium_id)
        .order_by(Unit.block, Unit.code)
    ):
        units.setdefault(ur.user_id, []).append(
            MemberUnitOut(
                id=unit.id,
                code=unit.code,
                block=unit.block,
                label=unit.label,
                inadimplente=unit.inadimplente,
                relation=ur.relation,
            )
        )

    return [
        MemberOut(
            user_id=member.user_id,
            name=user.name,
            email=user.email,
            role=member.role,
            is_active=member.is_active and user.is_active,
            has_pending_dues=any(u.inadimplente for u in units.get(member.user_id, [])),
            units=units.get(member.user_id, []),
        )
        for member, user in rows
    ]


@router.get(
    "/condominiums/{condominium_id}/members",
    response_model=list[MemberOut],
    summary="Listar participantes",
    description="Pessoas do condomínio com papel e unidades. Na POC, serve para escolher o X-User-Id.",
)
def list_members(ctx: CtxDep):
    return _members(ctx)


@router.get(
    "/condominiums/{condominium_id}/me",
    response_model=MemberOut,
    summary="Usuário atual",
    description="Dados do usuário do cabeçalho X-User-Id (cabeçalho da home: nome e unidade).",
)
def get_me(ctx: CtxDep):
    found = _members(ctx, ctx.require_user())
    if not found:
        raise NotFound("Usuário")
    return found[0]


@router.get(
    "/condominiums/{condominium_id}/notifications",
    response_model=list[NotificationOut],
    tags=["Notificações"],
    summary="Notificações do usuário atual",
)
def list_notifications(ctx: CtxDep, unread: bool = False, limit: int = 50):
    query = (
        select(Notification)
        .where(Notification.condominium_id == ctx.condominium_id, Notification.user_id == ctx.require_user())
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    if unread:
        query = query.where(Notification.read_at.is_(None))
    return ctx.db.scalars(query).all()


@router.post(
    "/condominiums/{condominium_id}/notifications/{notification_id}/read",
    response_model=NotificationOut,
    tags=["Notificações"],
    summary="Marcar notificação como lida",
)
def read_notification(ctx: CtxDep, notification_id: uuid.UUID):
    notification = ctx.db.get(Notification, notification_id)
    if notification is None or notification.condominium_id != ctx.condominium_id:
        raise NotFound("Notificação")
    if notification.read_at is None:
        notification.read_at = datetime.now(UTC)
    return notification
