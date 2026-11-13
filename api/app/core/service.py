import uuid
from collections.abc import Iterable

from sqlalchemy import select

from app.context import Ctx
from app.core.models import CondominiumUser, Notification, Unit, UnitResident
from app.enums import UserRole


def manager_ids(ctx: Ctx) -> list[uuid.UUID]:
    rows = ctx.db.scalars(
        select(CondominiumUser.user_id).where(
            CondominiumUser.condominium_id == ctx.condominium_id,
            CondominiumUser.role.in_([UserRole.manager, UserRole.admin]),
            CondominiumUser.is_active,
        )
    )
    return list(rows)


def notify(
    ctx: Ctx,
    user_ids: Iterable[uuid.UUID | None],
    kind: str,
    title: str,
    body: str | None = None,
    *,
    incident_id: uuid.UUID | None = None,
    reservation_id: uuid.UUID | None = None,
) -> None:
    for user_id in {u for u in user_ids if u is not None}:
        ctx.db.add(
            Notification(
                condominium_id=ctx.condominium_id,
                user_id=user_id,
                kind=kind,
                title=title,
                body=body,
                incident_id=incident_id,
                reservation_id=reservation_id,
            )
        )


def user_units(ctx: Ctx, user_id: uuid.UUID) -> list[Unit]:
    return list(
        ctx.db.scalars(
            select(Unit)
            .join(UnitResident, UnitResident.unit_id == Unit.id)
            .where(UnitResident.user_id == user_id, Unit.condominium_id == ctx.condominium_id)
            .order_by(Unit.block, Unit.code)
        )
    )
