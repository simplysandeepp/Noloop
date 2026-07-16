"""Cache-aside layer — key namespacing and graceful no-op fallback without Redis.
In CI there is no REDIS_URL, so every helper must degrade to calling the loader.
"""

import pytest

from app import cache


def test_key_namespacing():
    assert cache.key("admin", "stats") == "noloop:v1:admin:stats"
    assert cache.key("track", "CLM-1") == "noloop:v1:track:CLM-1"


@pytest.mark.asyncio
async def test_get_json_none_without_redis(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    cache._client_init = False  # force re-resolution
    assert await cache.get_json(cache.key("x")) is None


@pytest.mark.asyncio
async def test_set_and_delete_are_noops_without_redis(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    cache._client_init = False
    # Must not raise.
    await cache.set_json(cache.key("x"), {"a": 1}, ttl=5)
    await cache.delete(cache.key("x"))


@pytest.mark.asyncio
async def test_cached_json_calls_loader_once_and_returns(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    cache._client_init = False
    calls = {"n": 0}

    async def loader():
        calls["n"] += 1
        return {"value": 42}

    result = await cache.cached_json(cache.key("unit", "k"), 5, loader)
    assert result == {"value": 42}
    assert calls["n"] == 1  # loader ran (no cache to serve from)
