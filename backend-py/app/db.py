"""Async SQLAlchemy engine/session against the same Supabase Postgres.

Connects via the pooler host (pgbouncer, transaction mode), which requires
statement_cache_size=0 — asyncpg's prepared statements break behind pgbouncer.
"""

from collections.abc import AsyncIterator
from uuid import uuid4

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from .config import get_settings

# NullPool + statement_cache_size=0 + unique prepared-statement names is the
# documented SQLAlchemy recipe for pgbouncer transaction mode — names from
# asyncpg's default counter collide across pgbouncer's shared server conns.
engine = create_async_engine(
    get_settings().sqlalchemy_url,
    poolclass=NullPool,
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
    },
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency — one session per request, rolled back on error."""
    async with SessionLocal() as session:
        yield session
