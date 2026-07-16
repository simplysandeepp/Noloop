"""High-level RAG entrypoint used by the adjudication pipeline.

Resolves the right corpus for a claim's policy and returns a citation-grounded
coverage assessment. Two sources, in priority order:

1. A real ingested policy document in the configured store (pgvector in prod),
   scoped by the policy number (namespace).
2. Otherwise, a wording document synthesized from the structured policy fields,
   chunked + embedded into a per-policy in-memory store (cached by content hash).

Either way the answer is grounded in retrieved clauses with real citations, and
low-confidence retrieval refuses to guess.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache

from .chunk import chunk_document
from .config import get_rag_config
from .coverage import RagCoverage, assess_coverage
from .embeddings import get_embedder
from .policy_doc import synthesize_policy_document
from .store import InMemoryStore, VectorStore

_INLINE_NS = "inline"


@lru_cache(maxsize=256)
def _inline_store_for(doc_hash: str, doc_text: str) -> InMemoryStore:
    """Build (once) an in-memory store over a synthesized policy document.

    Keyed by content hash so repeated claims on the same policy reuse the store
    and its embeddings instead of re-embedding every time.
    """
    cfg = get_rag_config()
    store = InMemoryStore()
    chunks = chunk_document(
        doc_text,
        doc_id=f"policy:{doc_hash[:12]}",
        max_chunk_chars=cfg.max_chunk_chars,
        overlap=cfg.chunk_overlap_chars,
    )
    store.add(chunks, get_embedder(cfg), namespace=_INLINE_NS)
    return store


def _external_store() -> VectorStore | None:
    """Return the configured production store if one is wired, else None."""
    cfg = get_rag_config()
    if cfg.store_backend != "pgvector":
        return None
    try:
        from .pgstore import PgVectorStore  # lazy — optional deps + DB

        return PgVectorStore()
    except Exception:  # noqa: BLE001
        return None


def coverage_for_policy(procedure: str, policy: dict) -> RagCoverage:
    """Assess coverage for a procedure against a claim's policy."""
    cfg = get_rag_config()
    embedder = get_embedder(cfg)

    # 1. Real ingested document for this policy, if any.
    external = _external_store()
    policy_no = policy.get("policyNo")
    if external is not None and policy_no:
        try:
            if external.count(policy_no) > 0:
                return assess_coverage(
                    procedure, external, namespace=policy_no, cfg=cfg, embedder=embedder
                )
        except Exception:  # noqa: BLE001 — fall through to synthesized doc
            pass

    # 2. Synthesized wording document (always available).
    doc_text = synthesize_policy_document(policy)
    doc_hash = hashlib.blake2b(doc_text.encode("utf-8"), digest_size=16).hexdigest()
    store = _inline_store_for(doc_hash, doc_text)
    return assess_coverage(
        procedure, store, namespace=_INLINE_NS, cfg=cfg, embedder=embedder
    )
