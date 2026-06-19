"""Stage 2 — Coverage check.

Rule-based for now: is the procedure excluded / covered by the policy?
Later this becomes a RAG step over the policy document (pgvector + Claude)
with real clause-level citations.
"""

from ..schemas import ClaimPacket, CoverageResult


def check_coverage(packet: ClaimPacket) -> CoverageResult:
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
