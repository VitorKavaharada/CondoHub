"""Baseline: esquema de db/01_schema.sql

Revision ID: 0001
Revises:
Create Date: 2026-11-02

Banco criado antes do Alembic (pelo psql): marque como aplicado com `alembic stamp 0001`.
"""

import re
from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA_FILE = Path(__file__).resolve().parents[3] / "db" / "01_schema.sql"


def upgrade() -> None:
    sql = SCHEMA_FILE.read_text(encoding="utf-8")
    # O arquivo tem BEGIN/COMMIT próprios para rodar no psql; aqui a transação é do Alembic.
    sql = re.sub(r"^\s*(BEGIN|COMMIT);\s*$", "", sql, flags=re.MULTILINE)
    # Sem parâmetros: o psycopg envia o script como está (os "%" das mensagens dos triggers ficam intactos).
    op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    raise NotImplementedError("Para voltar, recrie o banco (DROP DATABASE condohub).")
