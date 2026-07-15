from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def check(db: AsyncSession = Depends(get_db)):
    # Round-trips to Postgres so a 200 means the DB is actually reachable.
    await db.execute(text("SELECT 1"))
    return {"status": "ok", "db": "connected"}
