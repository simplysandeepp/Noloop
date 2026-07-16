"""NoLoop RAG subsystem — pgvector ingestion, hybrid retrieval, and
citation-grounded coverage answers over policy documents.

Runs fully offline by default (hashing embedder + in-memory store); point it at
pgvector + a real embedding model via env for production. See ai/docs/rag.md.
"""

from .coverage import RagCoverage, assess_coverage
from .retrieve import RetrievalResult, RetrievedChunk, retrieve
from .service import coverage_for_policy

__all__ = [
    "RagCoverage",
    "RetrievalResult",
    "RetrievedChunk",
    "assess_coverage",
    "coverage_for_policy",
    "retrieve",
]
