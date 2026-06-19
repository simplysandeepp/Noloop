"""The adjudication pipeline orchestrator.

    extract → coverage → validate → adjudicate

`extract` is a passthrough today (synthetic packets arrive structured); it will
become OCR + LLM structured extraction from raw documents. Each stage returns a
typed object so the whole pipeline is testable and evaluable.
"""

from ..schemas import ClaimPacket, Decision
from .coverage import check_coverage
from .validate import validate
from .adjudicate import adjudicate


def run_pipeline(packet: ClaimPacket) -> Decision:
    coverage = check_coverage(packet)
    flags = validate(packet, coverage)
    return adjudicate(packet, coverage, flags)
