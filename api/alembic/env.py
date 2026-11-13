from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from app.config import settings

if context.config.config_file_name is not None:
    fileConfig(context.config.config_file_name)

# Migrações escritas à mão: o esquema tem triggers, EXCLUDE e FKs compostas que o
# autogenerate não representa. Não há target_metadata de propósito.


def run_migrations_offline() -> None:
    context.configure(url=settings.database_url, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(settings.database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, transaction_per_migration=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
