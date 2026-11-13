"""Contexto de cada requisição: condomínio (do caminho) e usuário que está agindo.

A POC não tem login. O usuário vem no cabeçalho X-User-Id, só para o banco saber quem
abriu, aprovou ou mudou cada registro (linha do tempo, reviewed_by...). Não é autenticação.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import Depends, Header, Path
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.models import Condominium, CondominiumUser
from app.db import get_db
from app.errors import AppError, NotFound


@dataclass
class Ctx:
    db: Session
    condominium: Condominium
    user_id: uuid.UUID | None

    @property
    def condominium_id(self) -> uuid.UUID:
        return self.condominium.id

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.condominium.timezone)

    def now(self) -> datetime:
        return datetime.now(self.tz)

    def require_user(self) -> uuid.UUID:
        if self.user_id is None:
            raise AppError(400, "user_required", "Informe o usuário no cabeçalho X-User-Id")
        return self.user_id

    def status_note(self, note: str | None) -> None:
        """Texto da próxima etapa na linha do tempo da ocorrência (trigger incident_log_status)."""
        self.db.execute(text("SELECT set_config('app.status_note', :note, true)"), {"note": note or ""})


def get_ctx(
    condominium_id: Annotated[uuid.UUID, Path(description="Id do condomínio")],
    x_user_id: Annotated[
        uuid.UUID | None,
        Header(description="Usuário simulado da POC (sem autenticação)"),
    ] = None,
    db: Session = Depends(get_db, scope="function"),
) -> Ctx:
    condominium = db.get(Condominium, condominium_id)
    if condominium is None:
        raise NotFound("Condomínio")
    if x_user_id is not None:
        if db.get(CondominiumUser, (condominium_id, x_user_id)) is None:
            raise AppError(422, "unknown_user", "O usuário informado não participa deste condomínio")
        db.execute(text("SELECT set_config('app.current_user_id', :u, true)"), {"u": str(x_user_id)})
    return Ctx(db=db, condominium=condominium, user_id=x_user_id)


CtxDep = Annotated[Ctx, Depends(get_ctx)]
