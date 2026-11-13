from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="CONDOHUB_")

    # Sem host = socket local com autenticação peer (usuário Linux = papel do Postgres).
    database_url: str = "postgresql+psycopg:///condohub"
    echo_sql: bool = False


settings = Settings()
