"""Observability for the AI engine — structured JSON logs, request-id
propagation (continues the id the core API sends), and Prometheus metrics
(golden signals + verdict distribution). Mirrors backend/app/observability.py.
Issue #18. Never logs PHI — the claim ref is an opaque id, not patient data.

Uses prometheus_client directly (no framework-coupled exporter) for robustness
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

REQUEST_ID_HEADER = "X-Request-ID"
_request_id: ContextVar[str] = ContextVar("request_id", default="-")


def get_request_id() -> str:
    return _request_id.get()


def configure_logging(service: str) -> None:
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        cache_logger_on_first_use=True,
    )
    structlog.contextvars.bind_contextvars(service=service)


def get_logger(name: str = "ai-engine"):
    return structlog.get_logger(name)


# Golden signals.
REQUESTS = Counter(
    "noloop_ai_http_requests_total", "HTTP requests", ["method", "route", "status"]
)
LATENCY = Histogram(
    "noloop_ai_http_request_duration_seconds", "HTTP latency", ["method", "route"]
)

# Business metrics.
ADJUDICATIONS = Counter("noloop_ai_adjudications_total", "Adjudications", ["verdict"])
ADJUDICATION_MODEL = Counter("noloop_ai_model_total", "Engine used", ["model"])
COVERAGE_DECISIONS = Counter(
    "noloop_ai_coverage_total", "RAG coverage outcomes", ["decision"]
)
PIPELINE_LATENCY = Histogram(
    "noloop_ai_pipeline_seconds", "Adjudication pipeline latency (s)"
)


def record_decision(verdict: str, model: str) -> None:
    ADJUDICATIONS.labels(verdict=verdict).inc()
    ADJUDICATION_MODEL.labels(model=model).inc()


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    return getattr(route, "path", None) or "unmatched"


class RequestContextMiddleware(BaseHTTPMiddleware):
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
            response.headers[REQUEST_ID_HEADER] = rid
            return response
        finally:
            elapsed = time.monotonic() - started
            route = _route_template(request)
            REQUESTS.labels(request.method, route, str(status)).inc()
            LATENCY.labels(request.method, route).observe(elapsed)
            self._log.info(
                "request",
                method=request.method,
                path=request.url.path,
                route=route,
                status=status,
                latency_ms=int(elapsed * 1000),
                request_id=rid,
            )
            structlog.contextvars.unbind_contextvars("request_id")
            _request_id.reset(token)


def setup_observability(app, service: str = "ai-engine") -> None:
    configure_logging(service)
    app.add_middleware(RequestContextMiddleware)

    @app.get("/internal/metrics", include_in_schema=False)
    def _metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
