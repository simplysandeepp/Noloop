"""Stage 4 — Adjudication.

Turns coverage + fraud signals into a verdict, a payable amount (with an
itemised deduction breakdown), and a plain-language rationale.

Rule-based today; when GROQ_API_KEY is set, the rationale is rewritten by a
Groq-hosted LLM (see pipeline.llm). The verdict logic mirrors policy reality: hard
violations deny, soft anomalies query, clean claims approve.
"""

from ..schemas import (
    ClaimPacket,
    CoverageResult,
    Decision,
    Deduction,
    FraudFlag,
    FraudSignal,
    Verdict,
)

# Signals that hard-deny vs. signals that route to human review.
DENY_SIGNALS = {FraudSignal.BILL_MATH_MISMATCH, FraudSignal.POLICY_EXCLUSION, FraudSignal.DATE_INCONSISTENCY}
QUERY_SIGNALS = {FraudSignal.LENGTH_OF_STAY_ANOMALY, FraudSignal.AMOUNT_OUTLIER}


def _payable(packet: ClaimPacket) -> tuple[int, list[Deduction]]:
    """Compute the payable amount for an APPROVE, with an itemised breakdown."""
    deductions: list[Deduction] = []
    billed = packet.bill.totalPaise
    sum_insured = packet.policy.sumInsuredPaise

    # 1. Cap at the sum insured.
    gross = billed
    if billed > sum_insured:
        over = billed - sum_insured
        deductions.append(Deduction(label="Exceeds sum insured", amountPaise=over))
        gross = sum_insured

    # 2. Room rent above the per-day cap is the patient's liability.
    cap = packet.policy.roomRentCapPerDayPaise
    if cap:
        los = max(1, packet.admission.lengthOfStayDays)
        room_lines = [li for li in packet.bill.lineItems if "room" in li.desc.lower()]
        room_billed = sum(li.amountPaise for li in room_lines)
        room_allowed = cap * los
        if room_billed > room_allowed:
            excess = room_billed - room_allowed
            deductions.append(
                Deduction(label=f"Room rent above ₹{cap/100:,.0f}/day cap", amountPaise=excess)
            )
            gross -= excess

    # 3. Mandatory co-pay on the remaining amount.
    if packet.policy.copayPct > 0:
        copay = round(gross * packet.policy.copayPct / 100)
        deductions.append(
            Deduction(label=f"{packet.policy.copayPct}% co-pay", amountPaise=copay)
        )
        gross -= copay

    return max(0, gross), deductions


def adjudicate(
    packet: ClaimPacket,
    coverage: CoverageResult,
    flags: list[FraudFlag],
) -> Decision:
    signal_types = {f.signal for f in flags}
    reasons = [f.detail for f in flags]
    deductions: list[Deduction] = []

    if signal_types & DENY_SIGNALS:
        verdict = Verdict.DENY
        approved = 0
    elif not coverage.covered:
        verdict = Verdict.QUERY
        approved = None
        reasons.append(coverage.reason)
    elif signal_types & QUERY_SIGNALS:
        verdict = Verdict.QUERY
        approved = None
    else:
        verdict = Verdict.APPROVE
        approved, deductions = _payable(packet)
        if deductions:
            note = ", ".join(f"{d.label} (−₹{d.amountPaise/100:,.0f})" for d in deductions)
            reasons.append(f"Payable after deductions: {note}.")
        reasons.append("Procedure covered, amounts consistent, and stay within norms.")

    rationale = _rationale(verdict, packet, reasons, approved)
    confidence = 0.92 if verdict in (Verdict.APPROVE, Verdict.DENY) else 0.6

    return Decision(
        ref=packet.ref,
        verdict=verdict,
        rationale=rationale,
        citedClauseRefs=coverage.citedClauseRefs,
        fraudFlags=flags,
        approvedAmountPaise=approved,
        deductions=deductions,
        confidence=confidence,
    )


def _rationale(
    verdict: Verdict, packet: ClaimPacket, reasons: list[str], approved: int | None
) -> str:
    head = {
        Verdict.APPROVE: f"Claim approved for ₹{(approved or 0)/100:,.0f}.",
        Verdict.DENY: "Claim denied.",
        Verdict.QUERY: "Claim held for review.",
    }[verdict]
    body = " ".join(reasons) if reasons else "No issues detected."
    return f"{head} {body}"
