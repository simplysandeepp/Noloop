"""Ports of src/common/slug.ts + the activity-log helper."""

import math
import re
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m

EMAIL_DOMAIN = "noloop.in"


def js_round(x: float) -> int:
    """JS Math.round — half-up. Python's round() is half-to-even (12.5→12,
    JS gives 13), which silently drifts percentages vs the old backend."""
    return math.floor(x + 0.5)


def iso(dt: datetime | None) -> str | None:
    """Serialize like Prisma/JS: UTC, milliseconds, trailing Z. The DB stores
    naive UTC timestamps; without the Z the browser parses them as local time."""
    if dt is None:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def to_dotted(name: str) -> str:
    """'Acme Hospital' -> 'acme.hospital' (words joined by dots)."""
    words = re.sub(r"[^a-z0-9]+", " ", name.lower()).split()
    return ".".join(words)


def to_compact(name: str) -> str:
    """'Acme Hospital' -> 'acmehospital' (alphanumeric only)."""
    return re.sub(r"[^a-z0-9]+", "", name.lower())


async def unique_email(db: AsyncSession, local_base: str) -> str:
    """Build a unique email, appending 1, 2, 3… on collision."""
    candidate = f"{local_base}@{EMAIL_DOMAIN}"
    n = 1
    while (
        await db.execute(select(m.User.id).where(m.User.email == candidate))
    ).scalar_one_or_none():
        candidate = f"{local_base}{n}@{EMAIL_DOMAIN}"
        n += 1
    return candidate


def log_activity(
    db: AsyncSession,
    *,
    tenant_id: str | None,
    actor_id: str | None,
    action: str,
    detail: str | None = None,
    metadata: dict | None = None,
) -> m.ActivityLog:
    """Append to the audit trail (flushed with the surrounding commit)."""
    row = m.ActivityLog(
        tenantId=tenant_id,
        actorId=actor_id,
        action=action,
        detail=detail,
        metadata_=metadata,
    )
    db.add(row)
    return row
