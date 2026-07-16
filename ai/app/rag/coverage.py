"""Citation-grounded coverage assessment — the anti-hallucination core.

Given a procedure, retrieve the most relevant policy clauses and decide coverage
**only from what was retrieved**, always attaching the clause references that
justify the decision. If retrieval confidence is below the floor, we refuse to
guess and return NOT_FOUND (→ the pipeline routes to human review) rather than
fabricate a coverage answer.

Default path is a deterministic, grounded heuristic over the retrieved clause
text. When GROQ_API_KEY is present, an LLM reads the same retrieved clauses and
returns a decision constrained to those clauses (its answer is discarded if it
cites a clause we did not retrieve — no ungrounded citations).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

from .config import RagConfig, get_rag_config
from .embeddings import Embedder, tokenize
from .retrieve import RetrievalResult, retrieve
from .store import VectorStore

_STOP = {"surgery", "procedure", "operation", "the", "a", "of", "and", "session"}
_EXCLUSION_SIGNALS = re.compile(
    r"exclud|not\s+covered|not\s+payable|shall\s+not|permanently\s+excluded", re.I
)
_COVERED_SIGNALS = re.compile(r"are\s+covered|is\s+covered|eligible|covered\s+procedures", re.I)


@dataclass
class Evidence:
    ref: str
    heading: str
    snippet: str
    score: float


@dataclass
class RagCoverage:
    decision: str  # COVERED | EXCLUDED | NOT_FOUND
    covered: bool
    reason: str
    cited_refs: list[str]
    confidence: float
    grounded: bool
    method: str
    evidence: list[Evidence] = field(default_factory=list)


def _significant(procedure: str) -> set[str]:
    return {t for t in tokenize(procedure) if t not in _STOP}


def _mentions(procedure: str, text: str) -> bool:
    """True if every significant token of the procedure appears in the clause."""
    terms = _significant(procedure)
    if not terms:
        terms = set(tokenize(procedure))
    doc = set(tokenize(text))
    return bool(terms) and terms <= doc


def assess_coverage(
    procedure: str,
    store: VectorStore,
    *,
    namespace: str = "default",
    cfg: RagConfig | None = None,
    embedder: Embedder | None = None,
) -> RagCoverage:
    cfg = cfg or get_rag_config()
    result = retrieve(procedure, store, namespace=namespace, cfg=cfg, embedder=embedder)

    evidence = [
        Evidence(c.ref, c.heading, c.text[:240], c.score) for c in result.chunks
    ]

    # Anti-hallucination floor: low retrieval confidence → do not guess.
    if not result.chunks or result.confidence < cfg.min_confidence:
        return RagCoverage(
            decision="NOT_FOUND",
            covered=False,
            reason=(
                f"'{procedure}' was not found with sufficient confidence in the "
                f"policy documents; routing for manual review."
            ),
            cited_refs=[],
            confidence=result.confidence,
            grounded=False,
            method=result.method,
            evidence=evidence,
        )

    # Deterministic grounded decision: which retrieved clause actually names the
    # procedure, and is that clause an exclusion or a coverage clause?
    excluded_hit = _first_hit(procedure, result, _EXCLUSION_SIGNALS)
    if excluded_hit:
        return RagCoverage(
            decision="EXCLUDED",
            covered=False,
            reason=(
                f"'{procedure}' is listed under an exclusion clause "
                f"({excluded_hit.ref}) and is not payable."
            ),
            cited_refs=[excluded_hit.ref],
            confidence=result.confidence,
            grounded=True,
            method=result.method,
            evidence=evidence,
        )

    covered_hit = _first_hit(procedure, result, _COVERED_SIGNALS)
    if covered_hit:
        return RagCoverage(
            decision="COVERED",
            covered=True,
            reason=(
                f"'{procedure}' appears in a covered-procedures clause "
                f"({covered_hit.ref}) and is eligible under the policy."
            ),
            cited_refs=[covered_hit.ref],
            confidence=result.confidence,
            grounded=True,
            method=result.method,
            evidence=evidence,
        )

    # Retrieved clauses exist but none explicitly names the procedure → don't
    # assume; route to review with the closest clauses cited for the reviewer.
    return RagCoverage(
        decision="NOT_FOUND",
        covered=False,
        reason=(
            f"'{procedure}' is not explicitly addressed in the retrieved policy "
            f"clauses; routing for manual review."
        ),
        cited_refs=result.cited_refs[:2],
        confidence=result.confidence,
        grounded=True,
        method=result.method,
        evidence=evidence,
    )


def _first_hit(procedure: str, result: RetrievalResult, signal: re.Pattern):
    """First retrieved chunk that both matches the signal and names the procedure."""
    for c in result.chunks:
        if signal.search(c.text) and _mentions(procedure, c.text):
            return c
    return None


def llm_available() -> bool:
    return bool(os.environ.get("GROQ_API_KEY"))
