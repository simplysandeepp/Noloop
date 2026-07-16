"""Shared adjudication-persist logic used by BOTH the inline submit path and the
async worker (issue #14). Extracted from routers/claims.py verbatim so the two
code paths can never drift: run the engine, persist the Decision + fraud flags +
timeline events, and mirror the result onto the claim row.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from . import ai_client, observability
from . import models as m
from .ai_client import inr
from .common import js_round


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _verdict_to_status(v: str) -> m.ClaimStatus:
    if v == "APPROVE":
        return m.ClaimStatus.APPROVED
    if v == "DENY":
        return m.ClaimStatus.DENIED
    return m.ClaimStatus.QUERIED


def _severity(s: str) -> m.FraudSeverity:
    return (
        m.FraudSeverity.HIGH
        if s == "HIGH"
        else m.FraudSeverity.LOW
        if s == "LOW"
        else m.FraudSeverity.MEDIUM
    )


def packet_from_claim(
    claim: m.Claim, policy: m.Policy, hospital: m.Tenant, insurer: m.Tenant
) -> dict:
    """Rebuild the engine packet from a persisted claim — used by the worker,
    which loads the claim from the DB rather than from the submit DTO."""
    return {
        "ref": claim.claimNumber,
        "type": claim.type.value,
        "hospital": hospital.name,
        "insurer": insurer.name,
        "policy": {
            "policyNo": policy.planCode,
            "sumInsuredPaise": policy.sumInsuredPaise,
            "roomRentCapPerDayPaise": policy.roomRentCapPerDayPaise,
            "copayPct": policy.copayPct,
            "coveredProcedures": policy.coveredProcedures,
            "exclusions": policy.exclusions,
        },
        "admission": {
            "admittedAt": claim.admittedAt.strftime("%Y-%m-%d") if claim.admittedAt else None,
            "dischargedAt": claim.dischargedAt.strftime("%Y-%m-%d")
            if claim.dischargedAt
            else None,
            "lengthOfStayDays": claim.lengthOfStayDays,
            "procedure": claim.procedure,
            "diagnosis": claim.diagnosis,
        },
        "bill": {"lineItems": claim.lineItems, "totalPaise": claim.billedPaise},
        "dischargeSummary": (
            f"Patient {claim.patientName} ({claim.patientAge}y) admitted for "
            f"{claim.procedure}; {claim.lengthOfStayDays} day(s); "
            f"billed ₹{inr(claim.billedPaise / 100)}."
        ),
    }


async def run_adjudication(
    db: AsyncSession, claim: m.Claim, packet: dict, submitted_at: datetime
) -> dict:
    """Run the engine and persist the outcome. Commits and returns the decision."""
    decision, latency_ms = await ai_client.adjudicate(packet)
    observability.record_decision(decision)

    decided_at = _now()
    tat_seconds = max(0, int((decided_at - submitted_at).total_seconds() + 0.5))
    status = _verdict_to_status(decision["verdict"])

    db.add(
        m.Decision(
            claimId=claim.id,
            verdict=m.Verdict(decision["verdict"]),
            approvedAmountPaise=decision.get("approvedAmountPaise"),
            confidence=decision["confidence"],
            rationale=decision["rationale"],
            citedClauseRefs=decision["citedClauseRefs"],
            model=decision["model"],
            latencyMs=latency_ms,
        )
    )
    for f in decision["fraudFlags"]:
        db.add(
            m.FraudFlag(
                claimId=claim.id,
                signal=f["signal"],
                severity=_severity(f["severity"]),
                detail=f["detail"],
            )
        )
    db.add(
        m.ClaimEvent(
            claimId=claim.id,
            type=m.ClaimEventType.AI_DECISION,
            message=(
                f"AI verdict: {decision['verdict']} "
                f"({js_round(decision['confidence'] * 100)}% confidence, {latency_ms}ms). "
                f"{decision['rationale']}"
            ),
        )
    )
    if decision["fraudFlags"]:
        db.add(
            m.ClaimEvent(
                claimId=claim.id,
                type=m.ClaimEventType.FRAUD_FLAGGED,
                message=(
                    f"{len(decision['fraudFlags'])} anomaly signal(s): "
                    + ", ".join(f["signal"] for f in decision["fraudFlags"])
                    + "."
                ),
            )
        )
    if decision["verdict"] == "QUERY":
        db.add(
            m.ClaimEvent(
                claimId=claim.id,
                type=m.ClaimEventType.QUERY_RAISED,
                message="Routed for review — additional information required.",
            )
        )
    claim.status = status
    claim.verdict = m.Verdict(decision["verdict"])
    claim.approvedAmountPaise = decision.get("approvedAmountPaise")
    claim.confidence = decision["confidence"]
    claim.rationale = decision["rationale"]
    claim.citedClauseRefs = decision["citedClauseRefs"]
    claim.aiModel = decision["model"]
    claim.aiLatencyMs = latency_ms
    claim.tatSeconds = tat_seconds
    claim.decidedAt = decided_at
    await db.commit()
    return decision
