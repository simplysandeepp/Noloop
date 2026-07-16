"""RAG configuration — all env-driven, all with safe defaults.

The whole subsystem runs with ZERO external dependencies out of the box:
the default embedder is a deterministic hashing embedder (no model download),
and the default store is in-memory. Point it at pgvector + a real embedding
model in production by setting the env below. Nothing here needs GROQ_API_KEY.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class RagConfig:
    # Embeddings ----------------------------------------------------------
    # "hash"  → deterministic hashing embedder (default; no deps, works in CI)
    # "sentence-transformers" → local bge-small / all-MiniLM (needs the extra)
    embedding_backend: str = os.environ.get("NOLOOP_EMBEDDING_BACKEND", "hash")
    embedding_model: str = os.environ.get(
        "NOLOOP_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
    )
    embedding_dim: int = _int("NOLOOP_EMBEDDING_DIM", 256)

    # Store ---------------------------------------------------------------
    # "memory" → in-process (default). "pgvector" → Supabase Postgres.
    store_backend: str = os.environ.get("NOLOOP_RAG_STORE", "memory")

    # Retrieval -----------------------------------------------------------
    top_k: int = _int("NOLOOP_RAG_TOP_K", 5)
    candidate_k: int = _int("NOLOOP_RAG_CANDIDATE_K", 20)
    rrf_k: int = _int("NOLOOP_RAG_RRF_K", 60)  # RRF damping constant
    rerank: bool = os.environ.get("NOLOOP_RAG_RERANK", "").lower() in ("1", "true", "yes")
    rerank_model: str = os.environ.get(
        "NOLOOP_RAG_RERANK_MODEL", "cross-encoder/ms-marco-MiniLM-L-6-v2"
    )
    # Below this fused/normalised confidence we refuse to answer from policy
    # (anti-hallucination floor) and route to human review instead of guessing.
    min_confidence: float = _float("NOLOOP_RAG_MIN_CONFIDENCE", 0.12)

    # Chunking ------------------------------------------------------------
    max_chunk_chars: int = _int("NOLOOP_RAG_MAX_CHUNK_CHARS", 900)
    chunk_overlap_chars: int = _int("NOLOOP_RAG_CHUNK_OVERLAP", 120)


def get_rag_config() -> RagConfig:
    return RagConfig()
