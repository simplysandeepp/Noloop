"""Observability: structured JSON logging, request-id propagation, Prometheus
metrics (golden signals + business metrics). Issue #18.

Design rules for a healthcare API:
- **Never log PHI/PII.** We log ids only — request_id, tenant_id, user_id (the
  JWT `sub`) — never patient names, diagnoses, or credentials/JWTs.
- **One request id end-to-end.** `X-Request-ID` is read from the incoming
  request (or generated), stored in a contextvar, echoed on the response, and
  forwarded by ai_client to the AI engine so a single claim is traceable across
  services.
- **Golden signals** (rate/errors/latency per route) are recorded in the
  middleware against the *route template* (not the raw path) to keep label
  cardinality bounded; business metrics are incremented by the routers.

Uses prometheus_client directly (no framework-coupled exporter) so it is robust
across FastAPI/Starlette versions.
"""

from __future__ import annotations

import logging
import time
import uuid
from contextvars import ContextVar

import structlog
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from .security import decode_token

# ── request-scoped context ────────────────────────────────
_request_id: ContextVar[str] = ContextVar("request_id", default="-")

REQUEST_ID_HEADER = "X-Request-ID"


def get_request_id() -> str:
    return _request_id.get()


# ── structlog config ──────────────────────────────────────
def configure_logging(service: str) -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        cache_logger_on_first_use=True,
    )
    structlog.contextvars.bind_contextvars(service=service)


def get_logger(name: str = "noloop"):
    return structlog.get_logger(name)


# ── golden-signal metrics (RED method) ────────────────────
REQUESTS = Counter(
    "noloop_http_requests_total", "HTTP requests", ["method", "route", "status"]
)
LATENCY = Histogram(
    "noloop_http_request_duration_seconds", "HTTP request latency", ["method", "route"]
)

# ── business metrics ──────────────────────────────────────
CLAIMS_SUBMITTED = Counter("noloop_claims_submitted_total", "Claims submitted")
AI_VERDICTS = Counter("noloop_ai_verdicts_total", "AI verdicts", ["verdict"])
FRAUD_FLAGS = Counter("noloop_fraud_flags_total", "Fraud signals raised", ["signal"])
ENGINE_FALLBACK = Counter(
    "noloop_ai_engine_fallback_total", "Adjudications served by the in-process fallback"
)
LOGIN_FAILURES = Counter("noloop_login_failures_total", "Failed login attempts")


def record_decision(decision: dict) -> None:
    """Increment business metrics from an adjudication decision."""
    CLAIMS_SUBMITTED.inc()
    AI_VERDICTS.labels(verdict=decision.get("verdict", "UNKNOWN")).inc()
    for f in decision.get("fraudFlags", []):
        FRAUD_FLAGS.labels(signal=f.get("signal", "UNKNOWN")).inc()
    if str(decision.get("model", "")).endswith("fallback"):
        ENGINE_FALLBACK.inc()


# ── middleware ────────────────────────────────────────────
def _route_template(request: Request) -> str:
    """Matched route path template, e.g. /claims/{claim_id} — bounded cardinality."""
    route = request.scope.get("route")
    return getattr(route, "path", None) or "unmatched"


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Assign/propagate a request id, record golden signals, and emit one
    structured access log line per request."""

    def __init__(self, app, logger=None):
        super().__init__(app)
        self._log = logger or get_logger("access")

    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        token = _request_id.set(rid)
        structlog.contextvars.bind_contextvars(request_id=rid)
        started = time.monotonic()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers[REQUEST_ID_HEADER] = rid  # echo for correlation
            return response
        finally:
            elapsed = time.monotonic() - started
            route = _route_template(request)
            REQUESTS.labels(request.method, route, str(status)).inc()
            LATENCY.labels(request.method, route).observe(elapsed)
            sub, tenant = _identity(request)
            self._log.info(
                "request",
                method=request.method,
                path=request.url.path,
                route=route,
                status=status,
                latency_ms=int(elapsed * 1000),
                request_id=rid,
                user_id=sub,
                tenant_id=tenant,
            )
            structlog.contextvars.unbind_contextvars("request_id")
            _request_id.reset(token)


def _identity(request: Request) -> tuple[str | None, str | None]:
    """Best-effort actor ids from the bearer token — ids only, never PHI."""
    auth = request.headers.get("authorization")
    if not auth or not auth.startswith("Bearer "):
        return None, None
    try:
        payload = decode_token(auth[7:])
        return payload.get("sub"), payload.get("tenantId")
    except Exception:  # noqa: BLE001
        return None, None


def metrics_response() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


def setup_observability(app, service: str) -> None:
    configure_logging(service)
    app.add_middleware(RequestContextMiddleware)

    @app.get("/internal/metrics", include_in_schema=False)
    def _metrics() -> Response:  # noqa: D401 — Prometheus scrape endpoint
        return metrics_response()
