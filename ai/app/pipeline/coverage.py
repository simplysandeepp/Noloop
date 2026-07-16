"""Stage 2 — Coverage check.

Now RAG-backed: coverage is decided by retrieving clauses from the policy
document (hybrid BM25 + vector, RRF-fused) and reading the answer *only* from
what was retrieved, with real clause citations and a low-confidence refusal path
(see app/rag/). This replaces the old exact-list membership test.

The rule-based membership check is kept as a guaranteed fallback: if the RAG
path is disabled (NOLOOP_RAG_COVERAGE=0) or errors, we degrade to it so the
engine never fails to produce a decision.
"""

from __future__ import annotations

import os

from ..schemas import ClaimPacket, CoverageResult


def _rag_enabled() -> bool:
    return os.environ.get("NOLOOP_RAG_COVERAGE", "1").lower() not in ("0", "false", "no")


def _policy_dict(packet: ClaimPacket) -> dict:
    p = packet.policy
    return {
        "policyNo": p.policyNo,
        "sumInsuredPaise": p.sumInsuredPaise,
        "roomRentCapPerDayPaise": p.roomRentCapPerDayPaise,
        "copayPct": p.copayPct,
        "coveredProcedures": p.coveredProcedures,
        "exclusions": p.exclusions,
    }


def check_coverage(packet: ClaimPacket) -> CoverageResult:
    if _rag_enabled():
        try:
            from ..rag import coverage_for_policy

            rag = coverage_for_policy(packet.admission.procedure, _policy_dict(packet))
            return CoverageResult(
                covered=rag.covered,
                reason=rag.reason,
                citedClauseRefs=rag.cited_refs,
            )
        except Exception:  # noqa: BLE001 — never let RAG break adjudication
            pass
    return _rule_based_coverage(packet)


def _rule_based_coverage(packet: ClaimPacket) -> CoverageResult:
    """Exact-list membership fallback (the pre-RAG behaviour)."""
    procedure = packet.admission.procedure.strip().lower()
    excluded = [p.lower() for p in packet.policy.exclusions]
    covered = [p.lower() for p in packet.policy.coveredProcedures]

    if procedure in excluded:
        return CoverageResult(
            covered=False,
            reason=f"'{packet.admission.procedure}' is listed under policy exclusions.",
            citedClauseRefs=["EXCLUSIONS"],
        )
    if procedure in covered:
        return CoverageResult(
            covered=True,
            reason=f"'{packet.admission.procedure}' is a covered procedure under the policy.",
            citedClauseRefs=["COVERED_PROCEDURES"],
        )
    return CoverageResult(
        covered=False,
        reason=f"'{packet.admission.procedure}' is not explicitly listed; needs manual review.",
        citedClauseRefs=[],
    )
