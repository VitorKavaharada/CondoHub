"""Inadimplência na unidade: unit.inadimplente

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-07

A flag de pendência financeira passa de condominium_user.has_pending_dues (por pessoa) para
unit.inadimplente (por unidade), para bloquear a reserva de todos os moradores da mesma unidade.
O bloqueio vale em qualquer área, então condo_space.block_if_pending deixa de existir.

Idempotente: num banco vazio, a 0001 já cria o esquema novo a partir de db/01_schema.sql e
esta migração não muda nada. Num banco criado antes (alembic stamp 0001), ela migra os dados:
as unidades de quem tinha has_pending_dues = true ficam inadimplentes.
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE unit ADD COLUMN IF NOT EXISTS inadimplente boolean NOT NULL DEFAULT false;
        COMMENT ON COLUMN unit.inadimplente IS
          'Unidade com pendência financeira; nenhum morador dela reserva áreas comuns';

        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'condominium_user' AND column_name = 'has_pending_dues'
          ) THEN
            UPDATE unit u
               SET inadimplente = true
              FROM unit_resident ur
              JOIN condominium_user cu
                ON cu.condominium_id = ur.condominium_id AND cu.user_id = ur.user_id
             WHERE ur.unit_id = u.id AND cu.has_pending_dues;
          END IF;
        END
        $$;

        ALTER TABLE condominium_user DROP COLUMN IF EXISTS has_pending_dues;
        ALTER TABLE condo_space DROP COLUMN IF EXISTS block_if_pending;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE condominium_user ADD COLUMN IF NOT EXISTS has_pending_dues boolean NOT NULL DEFAULT false;
        ALTER TABLE condo_space ADD COLUMN IF NOT EXISTS block_if_pending boolean NOT NULL DEFAULT false;
        UPDATE condominium_user cu
           SET has_pending_dues = true
          FROM unit_resident ur
          JOIN unit u ON u.id = ur.unit_id
         WHERE ur.condominium_id = cu.condominium_id AND ur.user_id = cu.user_id AND u.inadimplente;
        UPDATE condo_space SET block_if_pending = true;
        ALTER TABLE unit DROP COLUMN IF EXISTS inadimplente;
        """
    )
