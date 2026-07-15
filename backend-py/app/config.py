"""Settings — same env contract as backend/ (NestJS reads these names too).

Reads backend/.env by default so both backends share one config during the
migration; a local backend-py/.env wins if present.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_HERE = Path(__file__).resolve().parent.parent  # backend-py/
_NEST_ENV = _HERE.parent / "backend" / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[str(_NEST_ENV), str(_HERE / ".env")],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    direct_url: str | None = None
    jwt_secret: str
    jwt_expires_in: str = "7d"
    api_port: int = 4000
    redis_url: str | None = None
    supabase_url: str | None = None
    supabase_service_key: str | None = None
    ai_engine_url: str = "http://localhost:8000"

    @property
    def sqlalchemy_url(self) -> str:
        """Prisma-style postgres URL -> asyncpg URL, query params stripped
        (pgbouncer/sslmode params are handled via connect_args instead)."""
        url = self.database_url.split("?", 1)[0]
        return url.replace("postgresql://", "postgresql+asyncpg://").replace(
            "postgres://", "postgresql+asyncpg://"
        )

    @property
    def jwt_expires_seconds(self) -> int:
        """'7d' / '12h' / '30m' / '3600' -> seconds (matches @nestjs/jwt)."""
        raw = self.jwt_expires_in.strip().lower()
        units = {"s": 1, "m": 60, "h": 3600, "d": 86400}
        if raw and raw[-1] in units:
            return int(float(raw[:-1]) * units[raw[-1]])
        return int(raw)


@lru_cache
def get_settings() -> Settings:
    return Settings()
