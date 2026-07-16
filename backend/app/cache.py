"""Redis cache-aside layer (Upstash) — issue #23.

Namespaced (``noloop:v1:…``) with a version prefix so a deploy can bulk-bust by
bumping the version. Two consistency strategies, chosen per key and documented at
the call site:
  - **TTL-only** (eventual): stats/overview — cheap to be a few seconds stale.
  - **TTL + explicit invalidation** (read-after-write): /track — the write path
    deletes the key so a patient sees their claim update immediately.

Degrades to a no-op when REDIS_URL is unset or Redis is unreachable: every helper
falls back to calling the loader directly, so the app is fully functional without
a cache. A per-process asyncio lock gives basic single-flight stampede protection
on the local instance.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Awaitable, Callable
from typing import Any

from .config import get_settings

VERSION = "v1"
_PREFIX = f"noloop:{VERSION}"

_client = None
_client_init = False
_locks: dict[str, asyncio.Lock] = {}


def key(*parts: str) -> str:
    return ":".join((_PREFIX, *parts))


def _get_client():
    global _client, _client_init
    if _client_init:
        return _client
    _client_init = True
    url = get_settings().redis_url or os.environ.get("REDIS_URL")
    if not url:
        _client = None
        return None
    try:
        import redis.asyncio as aioredis  # lazy, optional

        _client = aioredis.from_url(url, decode_responses=True)
    except Exception:  # noqa: BLE001
        _client = None
    return _client


async def get_json(k: str) -> Any | None:
    client = _get_client()
    if client is None:
        return None
    try:
        raw = await client.get(k)
        return json.loads(raw) if raw is not None else None
    except Exception:  # noqa: BLE001 — cache read must never break a request
        return None


async def set_json(k: str, value: Any, ttl: int) -> None:
    client = _get_client()
    if client is None:
        return
    try:
        await client.set(k, json.dumps(value), ex=ttl)
    except Exception:  # noqa: BLE001
        pass


async def delete(*keys: str) -> None:
    client = _get_client()
    if client is None or not keys:
        return
    try:
        await client.delete(*keys)
    except Exception:  # noqa: BLE001
        pass


async def cached_json(k: str, ttl: int, loader: Callable[[], Awaitable[Any]]) -> Any:
    """Cache-aside: return cached value or load, store, and return it. Falls back
    to calling the loader directly when the cache is unavailable."""
    hit = await get_json(k)
    if hit is not None:
        return hit
    # Single-flight per key on this process to blunt local stampedes.
    lock = _locks.setdefault(k, asyncio.Lock())
    async with lock:
        hit = await get_json(k)  # re-check after acquiring the lock
        if hit is not None:
            return hit
        value = await loader()
        await set_json(k, value, ttl)
        return value
