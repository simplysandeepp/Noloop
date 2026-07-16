"""Async task queue (arq on Upstash Redis) — issue #14.

Moves claim adjudication off the request path: POST /claims persists the claim in
PROCESSING and enqueues a job; the worker (app.worker) runs the engine and writes
the Decision/events; the claim flows to its verdict event-driven. Frontends already
poll/track by status, so PROCESSING → APPROVED/DENIED/QUERIED needs no UI change.

Degrades gracefully: when NOLOOP_USE_QUEUE is off, arq is missing, or Redis is
unreachable, `enqueue_adjudication` returns False and the caller adjudicates
inline (today's synchronous behaviour). Idempotency uses the claimNumber as the
arq job_id, so a duplicate enqueue for the same claim is de-duplicated by arq.
"""

from __future__ import annotations

import os

from .config import get_settings

ADJUDICATION_QUEUE = "noloop:adjudication"


def queue_enabled() -> bool:
    return os.environ.get("NOLOOP_USE_QUEUE", "").lower() in ("1", "true", "yes")


def _redis_settings():
    from arq.connections import RedisSettings  # lazy, optional

    url = get_settings().redis_url or os.environ.get("REDIS_URL")
    if not url:
        raise RuntimeError("REDIS_URL is required for the task queue")
    return RedisSettings.from_dsn(url)


async def enqueue_adjudication(claim_id: str, claim_number: str) -> bool:
    """Enqueue an adjudication job. Returns True if enqueued, False if the caller
    should adjudicate inline (queue disabled/unavailable)."""
    if not queue_enabled():
        return False
    try:
        from arq import create_pool  # lazy, optional

        pool = await create_pool(_redis_settings())
        # job_id = claimNumber → arq drops duplicate enqueues for the same claim.
        job = await pool.enqueue_job(
            "adjudicate_claim_task",
            claim_id,
            _job_id=f"adj:{claim_number}",
            _queue_name=ADJUDICATION_QUEUE,
        )
        await pool.close()
        return job is not None
    except Exception:  # noqa: BLE001 — any failure → inline fallback
        return False
