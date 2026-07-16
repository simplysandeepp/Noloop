"""API security hardening — security headers, body-size limits, CORS allowlist,
and a rate limiter. Issue #19.

The rate limiter is a fixed-window token counter with two backends: an in-process
counter (default — works everywhere, fine for a single instance) and Redis
(when REDIS_URL is set — shared across instances). It fails **open** on backend
errors so a Redis blip can never lock users out of a healthcare system.

429 responses use the same Nest-shaped error body as the rest of the API.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

# ── security headers ──────────────────────────────────────
_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    # HSTS: only meaningful over HTTPS; harmless on http and correct in prod.
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        for k, v in _SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        return response


# ── request body size limit ───────────────────────────────
class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject oversized request bodies early (uploads on /claims/extract etc.)."""

    def __init__(self, app, max_bytes: int = 10 * 1024 * 1024):
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):
        cl = request.headers.get("content-length")
        if cl is not None:
            try:
                if int(cl) > self.max_bytes:
                    return _error_response(
                        413, f"Request body exceeds {self.max_bytes} bytes"
                    )
            except ValueError:
                pass
        return await call_next(request)


def _error_response(status: int, message: str) -> Response:
    import json

    names = {413: "Payload Too Large", 429: "Too Many Requests"}
    body = json.dumps(
        {"message": message, "error": names.get(status, "Error"), "statusCode": status}
    )
    return Response(body, status_code=status, media_type="application/json")


# ── CORS allowlist ────────────────────────────────────────
def cors_origins() -> list[str] | None:
    """Explicit allowlist from CORS_ORIGINS (comma-separated). None → caller
    keeps the permissive dev default (documented as a deploy TODO)."""
    raw = os.environ.get("CORS_ORIGINS", "").strip()
    if not raw:
        return None
    return [o.strip() for o in raw.split(",") if o.strip()]


# ── rate limiter ──────────────────────────────────────────
class _MemoryBackend:
    def __init__(self) -> None:
        self._hits: dict[str, tuple[int, float]] = defaultdict(lambda: (0, 0.0))

    def incr(self, key: str, window: int) -> int:
        count, reset = self._hits[key]
        now = time.monotonic()
        if now >= reset:
            count, reset = 0, now + window
        count += 1
        self._hits[key] = (count, reset)
        return count


class _RedisBackend:
    def __init__(self, url: str) -> None:
        import redis  # lazy, optional

        self._r = redis.Redis.from_url(url)

    def incr(self, key: str, window: int) -> int:
        pipe = self._r.pipeline()
        pipe.incr(key)
        pipe.expire(key, window)
        count, _ = pipe.execute()
        return int(count)


_backend = None


def _get_backend():
    global _backend
    if _backend is not None:
        return _backend
    url = os.environ.get("REDIS_URL")
    if url:
        try:
            _backend = _RedisBackend(url)
            return _backend
        except Exception:  # noqa: BLE001 — fall back to in-process
            pass
    _backend = _MemoryBackend()
    return _backend


def _client_ip(request: Request) -> str:
    # Honour a single proxy hop (Render/Vercel set X-Forwarded-For).
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, limit: int, window: int = 60):
    """FastAPI dependency: allow `limit` requests per `window` seconds per IP.
    Fails open on backend errors (never locks a healthcare system out)."""

    def dep(request: Request) -> None:
        try:
            key = f"noloop:v1:rl:{bucket}:{_client_ip(request)}"
            count = _get_backend().incr(key, window)
        except Exception:  # noqa: BLE001 — never block on limiter failure
            return
        if count > limit:
            raise HTTPException(429, "Too many requests — please slow down")

    return dep


def install_hardening(app, max_body_bytes: int = 10 * 1024 * 1024) -> None:
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=max_body_bytes)
