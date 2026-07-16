"""arq worker for async claim adjudication — issue #14.

Run as a separate process (later a Render background worker):

    cd backend && arq app.worker.WorkerSettings

Each job loads the claim, runs the engine via the shared adjudication logic, and
writes the Decision/events. Retries with backoff on transient failure; the job is
idempotent — if the claim already has a decision (status != PROCESSING) the job
is a no-op, so a redelivery can't double-adjudicate.
"""

from __future__ import annotations

import os

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from . import adjudication
from . import models as m
from .config import get_settings
from .db import SessionLocal
from .observability import configure_logging, get_logger
from .queue import ADJUDICATION_QUEUE, _redis_settings

log = get_logger("worker")


async def adjudicate_claim_task(ctx: dict, claim_id: str) -> str:
    """Adjudicate one claim. Idempotent: skips if already decided."""
    async with SessionLocal() as db:
        claim = (
            await db.execute(
                select(m.Claim)
                .where(m.Claim.id == claim_id)
                .options(
                    selectinload(m.Claim.policy),
                    selectinload(m.Claim.hospital),
                    selectinload(m.Claim.insurer),
                )
            )
        ).scalar_one_or_none()
        if claim is None:
            log.warning("claim_not_found", claim_id=claim_id)
            return "not_found"
        if claim.status != m.ClaimStatus.PROCESSING:
            # Already adjudicated — idempotent no-op on redelivery.
            log.info("already_decided", claim_id=claim_id, status=claim.status.value)
            return "skipped"

        packet = adjudication.packet_from_claim(
            claim, claim.policy, claim.hospital, claim.insurer
        )
        decision = await adjudication.run_adjudication(db, claim, packet, claim.submittedAt)
        log.info("adjudicated", claim_id=claim_id, verdict=decision["verdict"])
        return decision["verdict"]


async def _startup(ctx: dict) -> None:
    configure_logging("noloop-worker")
    get_logger("worker").info("worker_started")


def _safe_redis_settings():
    """RedisSettings when REDIS_URL is set, else None — keeps this module
    importable in tests/CI without Redis (arq only needs it to actually run)."""
    if not (os.environ.get("REDIS_URL") or get_settings().redis_url):
        return None
    try:
        return _redis_settings()
    except Exception:  # noqa: BLE001
        return None


class WorkerSettings:
    """arq entrypoint: `arq app.worker.WorkerSettings`."""

    functions = [adjudicate_claim_task]
    on_startup = _startup
    queue_name = ADJUDICATION_QUEUE
    max_tries = 4  # retries with arq's default exponential backoff
    job_timeout = 30
    redis_settings = _safe_redis_settings()
