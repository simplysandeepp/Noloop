"""AI engine: request-id propagation, Prometheus endpoint, and that the
adjudicate/coverage endpoints record business metrics.
"""

from fastapi.testclient import TestClient

from app.main import app
from app.observability import REQUEST_ID_HEADER

client = TestClient(app)


def test_request_id_echoed():
    r = client.get("/health", headers={REQUEST_ID_HEADER: "rid-xyz"})
    assert r.status_code == 200
    assert r.headers.get(REQUEST_ID_HEADER) == "rid-xyz"


def test_prometheus_endpoint():
    r = client.get("/internal/metrics")
    assert r.status_code == 200
    assert "noloop_ai_http_requests_total" in r.text


def test_adjudicate_records_verdict_metric():
    from app.observability import ADJUDICATIONS

    packet = {
        "ref": "OBS-1",
        "policy": {
            "sumInsuredPaise": 50000000,
            "coveredProcedures": ["Appendectomy"],
            "exclusions": [],
        },
        "admission": {"lengthOfStayDays": 1, "procedure": "Appendectomy"},
        "bill": {"lineItems": [{"desc": "Appendectomy", "amountPaise": 2000000}],
                 "totalPaise": 2000000},
    }
    before = ADJUDICATIONS.labels(verdict="APPROVE")._value.get()
    r = client.post("/adjudicate", json=packet)
    assert r.status_code == 200
    assert r.json()["verdict"] == "APPROVE"
    assert ADJUDICATIONS.labels(verdict="APPROVE")._value.get() == before + 1
