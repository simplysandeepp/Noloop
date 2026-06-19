"""The adjudication pipeline orchestrator.

    extract → coverage → validate → adjudicate → (optional) LLM rationale

`extract` is a passthrough today (synthetic packets arrive structured); it will
become OCR + LLM structured extraction from raw documents. Each stage returns a
typed object so the whole pipeline is testable and evaluable.
"""

from ..schemas import ClaimPacket, Decision
from .coverage import check_coverage
from .validate import validate
from .adjudicate import adjudicate
from .llm import enrich_rationale


def run_pipeline(packet: ClaimPacket) -> Decision:
    # Stage 1 — extract (passthrough; packets are already structured).
    # Stage 2 — coverage.
    coverage = check_coverage(packet)
    # Stage 3 — validation / fraud signals.
    flags = validate(packet, coverage)
    # Stage 4 — adjudicate into a verdict + payable amount.
    decision = adjudicate(packet, coverage, flags)
    # Stage 5 — optional Claude rationale (no-op without an API key).
    decision = enrich_rationale(packet, coverage, flags, decision)
    return decision
