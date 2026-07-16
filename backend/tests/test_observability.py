"""Request-id propagation, the Prometheus endpoint, and business-metric
recording. Uses /internal/metrics (no database) so it runs in CI.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.observability import REQUEST_ID_HEADER, record_decision

client = TestClient(app)


def test_generates_request_id_when_absent():
    r = client.get("/internal/metrics")
    assert r.status_code == 200
    assert r.headers.get(REQUEST_ID_HEADER)  # generated when the client omits it


def test_incoming_request_id_is_echoed():
    r = client.get("/internal/metrics", headers={REQUEST_ID_HEADER: "trace-abc-123"})
    assert r.headers.get(REQUEST_ID_HEADER) == "trace-abc-123"


def test_prometheus_endpoint_exposes_metrics():
    r = client.get("/internal/metrics")
    assert r.status_code == 200
    assert "noloop_http_requests_total" in r.text


def test_record_decision_updates_business_metrics():
    from app.observability import CLAIMS_SUBMITTED, ENGINE_FALLBACK

    before = CLAIMS_SUBMITTED._value.get()
    before_fb = ENGINE_FALLBACK._value.get()
    record_decision(
        {
            "verdict": "APPROVE",
            "model": "rule-engine-py-fallback",
            "fraudFlags": [{"signal": "AMOUNT_OUTLIER"}],
        }
    )
    assert CLAIMS_SUBMITTED._value.get() == before + 1
    assert ENGINE_FALLBACK._value.get() == before_fb + 1
