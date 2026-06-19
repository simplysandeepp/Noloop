"""Stage 3 — Validation / fraud signals.

Deterministic rule checks (no LLM needed). Later, an LLM anomaly pass
(Claude) adds LLM_ANOMALY for things rules can't capture.
"""

from ..schemas import ClaimPacket, CoverageResult, FraudFlag, FraudSignal, Severity

# Typical length-of-stay (days) by procedure — domain benchmark.
TYPICAL_LOS = {
    "appendectomy": 2,
    "cataract surgery": 1,
    "angioplasty": 3,
    "cesarean delivery": 3,
    "knee replacement": 4,
    "dialysis session": 1,
}
DEFAULT_TYPICAL_LOS = 3
LOS_TOLERANCE_DAYS = 5  # flag if stay exceeds benchmark by more than this


def validate(packet: ClaimPacket, coverage: CoverageResult) -> list[FraudFlag]:
    flags: list[FraudFlag] = []

    # 1. Bill math — line items must sum to the stated total.
    #    Exception: when the genuine line items reconcile to within the sum
    #    insured but the *stated total* is inflated past it, the gap is a
    #    coverage-cap overage (AMOUNT_OUTLIER → query), not arithmetic fraud
    #    (BILL_MATH_MISMATCH → deny). If the line items themselves already blow
    #    the cap, an extra mismatch on top is still treated as fraud.
    line_sum = sum(li.amountPaise for li in packet.bill.lineItems)
    over_cap_overage = (
        packet.bill.totalPaise > packet.policy.sumInsuredPaise
        and line_sum <= packet.policy.sumInsuredPaise
    )
    if line_sum != packet.bill.totalPaise and not over_cap_overage:
        flags.append(
            FraudFlag(
                signal=FraudSignal.BILL_MATH_MISMATCH,
                severity=Severity.HIGH,
                detail=(
                    f"Line items sum to ₹{line_sum/100:,.0f} but the bill total is "
                    f"₹{packet.bill.totalPaise/100:,.0f}."
                ),
            )
        )

    # 2. Length-of-stay anomaly (the bed-blocking signal).
    proc = packet.admission.procedure.strip().lower()
    benchmark = TYPICAL_LOS.get(proc, DEFAULT_TYPICAL_LOS)
    los = packet.admission.lengthOfStayDays
    if los > benchmark + LOS_TOLERANCE_DAYS:
        flags.append(
            FraudFlag(
                signal=FraudSignal.LENGTH_OF_STAY_ANOMALY,
                severity=Severity.MEDIUM,
                detail=(
                    f"Stay of {los} days far exceeds the ~{benchmark}-day benchmark "
                    f"for {packet.admission.procedure}."
                ),
            )
        )

    # 3. Amount outlier — total exceeds the sum insured.
    if packet.bill.totalPaise > packet.policy.sumInsuredPaise:
        flags.append(
            FraudFlag(
                signal=FraudSignal.AMOUNT_OUTLIER,
                severity=Severity.MEDIUM,
                detail=(
                    f"Claimed ₹{packet.bill.totalPaise/100:,.0f} exceeds the sum insured "
                    f"₹{packet.policy.sumInsuredPaise/100:,.0f}."
                ),
            )
        )

    # 4. Date inconsistency — discharge before admission.
    if packet.admission.admittedAt and packet.admission.dischargedAt:
        if packet.admission.dischargedAt < packet.admission.admittedAt:
            flags.append(
                FraudFlag(
                    signal=FraudSignal.DATE_INCONSISTENCY,
                    severity=Severity.HIGH,
                    detail=(
                        f"Discharge date {packet.admission.dischargedAt} is before "
                        f"admission date {packet.admission.admittedAt}."
                    ),
                )
            )

    # 5. Policy exclusion (surfaced from the coverage stage).
    if not coverage.covered and "EXCLUSIONS" in coverage.citedClauseRefs:
        flags.append(
            FraudFlag(
                signal=FraudSignal.POLICY_EXCLUSION,
                severity=Severity.HIGH,
                detail=coverage.reason,
            )
        )

    return flags
