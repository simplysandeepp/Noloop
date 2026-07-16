"""Deduction-math tests for the adjudication stage — sum-insured cap, room-rent
cap, and co-pay, plus the JS-round semantics the platform depends on.
"""

from app.pipeline.adjudicate import _payable
from app.schemas import Admission, Bill, ClaimPacket, LineItem, Policy


def _packet(**over) -> ClaimPacket:
    policy = Policy(
        sumInsuredPaise=over.get("sumInsuredPaise", 10_000_00),
        roomRentCapPerDayPaise=over.get("roomRentCapPerDayPaise"),
        copayPct=over.get("copayPct", 0),
        coveredProcedures=["Appendectomy"],
        exclusions=[],
    )
    admission = Admission(
        lengthOfStayDays=over.get("lengthOfStayDays", 2),
        procedure="Appendectomy",
    )
    bill = Bill(
        lineItems=over.get("lineItems", [LineItem(desc="Appendectomy", amountPaise=8_000_00)]),
        totalPaise=over.get("totalPaise", 8_000_00),
    )
    return ClaimPacket(ref="T", policy=policy, admission=admission, bill=bill)


def test_no_deductions_pays_full():
    payable, deductions = _payable(_packet())
    assert payable == 8_000_00
    assert deductions == []


def test_sum_insured_cap():
    p = _packet(sumInsuredPaise=5_000_00, totalPaise=8_000_00,
                lineItems=[LineItem(desc="Appendectomy", amountPaise=8_000_00)])
    payable, deductions = _payable(p)
    assert payable == 5_000_00
    assert any("sum insured" in d.label.lower() for d in deductions)


def test_room_rent_cap():
    # Cap ₹2,000/day * 2 days = ₹4,000 allowed; room billed ₹6,000 → ₹2,000 excess.
    p = _packet(
        roomRentCapPerDayPaise=2_000_00,
        lengthOfStayDays=2,
        lineItems=[
            LineItem(desc="Room charges", amountPaise=6_000_00),
            LineItem(desc="Surgery", amountPaise=2_000_00),
        ],
        totalPaise=8_000_00,
    )
    payable, deductions = _payable(p)
    assert any("Room rent" in d.label for d in deductions)
    assert payable == 6_000_00  # 8000 - 2000 excess


def test_copay_uses_js_round():
    # 10% co-pay on ₹8,000 = ₹800.
    p = _packet(copayPct=10)
    payable, deductions = _payable(p)
    assert any("10% co-pay" in d.label for d in deductions)
    assert payable == 7_200_00
