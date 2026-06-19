"""Stage 4 — Adjudication.

Turns coverage + fraud signals into a verdict with a plain-language rationale.
Rule-based today; when ANTHROPIC_API_KEY is set, the rationale (and harder
judgment calls) will be produced by Claude. The verdict logic mirrors the
policy reality: hard violations deny, soft anomalies query, clean approves.
"""

from ..schemas import (
    ClaimPacket,
    CoverageResult,
    Decision,
    FraudFlag,
    FraudSignal,
    Verdict,
)

# Signals that hard-deny vs. signals that route to human review.
DENY_SIGNALS = {FraudSignal.BILL_MATH_MISMATCH, FraudSignal.POLICY_EXCLUSION}
QUERY_SIGNALS = {FraudSignal.LENGTH_OF_STAY_ANOMALY, FraudSignal.AMOUNT_OUTLIER}


def adjudicate(
    packet: ClaimPacket,
    coverage: CoverageResult,
    flags: list[FraudFlag],
) -> Decision:
    signal_types = {f.signal for f in flags}
    reasons = [f.detail for f in flags]

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
        approved = packet.bill.totalPaise
        reasons.append(
            "Procedure covered, amounts consistent, and stay within norms."
        )

    rationale = _rationale(verdict, packet, reasons)
    confidence = 0.9 if verdict in (Verdict.APPROVE, Verdict.DENY) else 0.6

    return Decision(
        ref=packet.ref,
        verdict=verdict,
        rationale=rationale,
        citedClauseRefs=coverage.citedClauseRefs,
        fraudFlags=flags,
        approvedAmountPaise=approved,
        confidence=confidence,
    )


def _rationale(verdict: Verdict, packet: ClaimPacket, reasons: list[str]) -> str:
    head = {
        Verdict.APPROVE: "Claim approved.",
        Verdict.DENY: "Claim denied.",
        Verdict.QUERY: "Claim held for review.",
    }[verdict]
    body = " ".join(reasons) if reasons else "No issues detected."
    return f"{head} {body}"
