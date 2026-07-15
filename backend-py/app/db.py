"""Async SQLAlchemy engine/session against the same Supabase Postgres.

Connects via the pooler host (pgbouncer, transaction mode), which requires
statement_cache_size=0 — asyncpg's prepared statements break behind pgbouncer.
"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .config import get_settings

engine = create_async_engine(
    get_settings().sqlalchemy_url,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    connect_args={"statement_cache_size": 0},
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency — one session per request, rolled back on error."""
    async with SessionLocal() as session:
        yield session
