"""In-process fallback engine — verdicts + en-IN ₹ formatting. This path runs
whenever the AI engine service is unreachable, so it must mirror the pipeline.
"""

from app.ai_client import _fallback, inr


def _packet(**over) -> dict:
    return {
        "ref": over.get("ref", "T-1"),
        "type": "CASHLESS",
        "policy": {
            "sumInsuredPaise": over.get("sumInsuredPaise", 50_000_000),
            "roomRentCapPerDayPaise": over.get("roomRentCapPerDayPaise"),
            "copayPct": over.get("copayPct", 0),
            "coveredProcedures": over.get("coveredProcedures", ["Appendectomy"]),
            "exclusions": over.get("exclusions", ["Cosmetic Rhinoplasty"]),
        },
        "admission": {
            "admittedAt": over.get("admittedAt", "2026-03-25"),
            "dischargedAt": over.get("dischargedAt", "2026-03-26"),
            "lengthOfStayDays": over.get("lengthOfStayDays", 1),
            "procedure": over.get("procedure", "Appendectomy"),
            "diagnosis": "dx",
        },
        "bill": {
            "lineItems": over.get("lineItems", [{"desc": "Appendectomy", "amountPaise": 2_000_000}]),
            "totalPaise": over.get("totalPaise", 2_000_000),
        },
    }


def test_inr_indian_grouping():
    assert inr(1234567) == "12,34,567"
    assert inr(100000) == "1,00,000"
    assert inr(999) == "999"
    assert inr(-1234567) == "-12,34,567"


def test_fallback_approve():
    d = _fallback(_packet())
    assert d["verdict"] == "APPROVE"
    assert d["approvedAmountPaise"] == 2_000_000
    assert d["model"] == "rule-engine-py-fallback"


def test_fallback_deny_on_exclusion():
    d = _fallback(_packet(procedure="Cosmetic Rhinoplasty"))
    assert d["verdict"] == "DENY"
    assert d["approvedAmountPaise"] == 0
    assert any(f["signal"] == "POLICY_EXCLUSION" for f in d["fraudFlags"])


def test_fallback_deny_on_bill_mismatch():
    d = _fallback(_packet(
        lineItems=[{"desc": "Surgery", "amountPaise": 1_000_000}],
        totalPaise=2_000_000,
    ))
    assert d["verdict"] == "DENY"
    assert any(f["signal"] == "BILL_MATH_MISMATCH" for f in d["fraudFlags"])


def test_fallback_query_on_los_anomaly():
    d = _fallback(_packet(
        procedure="Cataract Surgery",
        coveredProcedures=["Cataract Surgery"],
        lengthOfStayDays=14,
        lineItems=[{"desc": "Room", "amountPaise": 2_000_000}],
        totalPaise=2_000_000,
    ))
    assert d["verdict"] == "QUERY"
    assert any(f["signal"] == "LENGTH_OF_STAY_ANOMALY" for f in d["fraudFlags"])


def test_fallback_copay_deduction():
    d = _fallback(_packet(copayPct=10))
    # 10% co-pay on ₹20,000 = ₹2,000 → payable ₹18,000.
    assert d["approvedAmountPaise"] == 1_800_000
