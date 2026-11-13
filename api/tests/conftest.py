"""Testes contra um PostgreSQL real (as regras moram no banco).

Recria o banco condohub_test com db/01_schema.sql, 02_seed.sql e 03_demo.sql a cada execução.
Cada teste roda numa transação desfeita no final.
"""

import os
from pathlib import Path

TEST_DB = os.environ.get("CONDOHUB_TEST_DB", "condohub_test")
os.environ["CONDOHUB_DATABASE_URL"] = f"postgresql+psycopg:///{TEST_DB}"

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db import engine, get_db  # noqa: E402
from app.main import app  # noqa: E402

DB_DIR = Path(__file__).resolve().parents[2] / "db"

CONDO = "11111111-1111-1111-1111-111111111111"
ALINE = "aaaaaaaa-0000-0000-0000-000000000001"
ROBERTO = "aaaaaaaa-0000-0000-0000-000000000002"
MARCOS = "aaaaaaaa-0000-0000-0000-000000000003"
PAULA = "aaaaaaaa-0000-0000-0000-000000000004"


@pytest.fixture(scope="session", autouse=True)
def database():
    with psycopg.connect("dbname=postgres", autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}"')
        conn.execute(
            f"""CREATE DATABASE "{TEST_DB}" WITH ENCODING 'UTF8' LOCALE_PROVIDER icu
                ICU_LOCALE 'pt-BR' LOCALE 'C.UTF-8' TEMPLATE template0"""
        )
        conn.execute(f"""ALTER DATABASE "{TEST_DB}" SET timezone TO 'America/Sao_Paulo'""")
    with psycopg.connect(f"dbname={TEST_DB}", autocommit=True) as conn:
        for name in ("01_schema.sql", "02_seed.sql", "03_demo.sql"):
            conn.execute((DB_DIR / name).read_text(encoding="utf-8"))
    yield
    engine.dispose()


@pytest.fixture
def session():
    """Sessão do teste: tudo o que ela e a API gravam é desfeito no final."""
    connection = engine.connect()
    outer = connection.begin()
    db = Session(bind=connection, join_transaction_mode="create_savepoint", autoflush=False, expire_on_commit=False)
    try:
        yield db
    finally:
        db.close()
        outer.rollback()
        connection.close()


@pytest.fixture
def client(session):
    def override_get_db():
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def url(path: str) -> str:
    return f"/condominiums/{CONDO}{path}"


def as_user(user_id: str) -> dict:
    return {"X-User-Id": user_id}


def error_code(response) -> str:
    return response.json()["error"]["code"]
