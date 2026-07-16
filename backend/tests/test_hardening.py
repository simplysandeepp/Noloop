"""Security headers, body-size limit, CORS allowlist parsing, and the rate
limiter. Uses /internal/metrics (no database) so it runs in CI.
"""

import os

from fastapi.testclient import TestClient

from app.hardening import _MemoryBackend, cors_origins, rate_limit
from app.main import app

client = TestClient(app)


def test_security_headers_present():
    r = client.get("/internal/metrics")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    assert "max-age" in r.headers["Strict-Transport-Security"]


def test_body_size_limit_rejects_large_payload():
    # A body over the 10MB cap is rejected at 413 before routing/DB.
    big = b"0" * (10 * 1024 * 1024 + 1)
    r = client.post("/auth/login", content=big)
    assert r.status_code == 413
    assert r.json()["statusCode"] == 413


def test_cors_origins_parsing(monkeypatch):
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    assert cors_origins() is None
    monkeypatch.setenv("CORS_ORIGINS", "https://a.com, https://b.com ,")
    assert cors_origins() == ["https://a.com", "https://b.com"]


def test_memory_rate_limiter_counts_within_window():
    b = _MemoryBackend()
    counts = [b.incr("k", window=60) for _ in range(5)]
    assert counts == [1, 2, 3, 4, 5]
    # A different key is independent.
    assert b.incr("other", window=60) == 1


def test_rate_limit_dependency_raises_429_over_limit():
    from fastapi import HTTPException, Request

    os.environ.pop("REDIS_URL", None)
    dep = rate_limit("unit-test-bucket", limit=3, window=60)
    scope = {"type": "http", "headers": [], "client": ("1.2.3.4", 1234)}
    req = Request(scope)
    # First 3 allowed, 4th blocked.
    for _ in range(3):
        dep(req)
    try:
        dep(req)
        raised = False
    except HTTPException as e:
        raised = e.status_code == 429
    assert raised
