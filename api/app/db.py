from collections.abc import Iterator
from datetime import datetime

from sqlalchemy import DateTime, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, echo=settings.echo_sql, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """O esquema é mantido em db/01_schema.sql; os modelos só mapeiam as tabelas existentes."""

    type_annotation_map = {datetime: DateTime(timezone=True)}


def get_db() -> Iterator[Session]:
    """Uma transação por requisição: commit no fim, rollback em qualquer erro.

    Injete sempre com Depends(get_db, scope="function"): assim o commit acontece antes de a
    resposta sair, e uma falha no commit (ex.: trigger adiado) vira erro em vez de um 201 falso.
    """
    with SessionLocal() as db:
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
