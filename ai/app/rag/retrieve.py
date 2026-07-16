"""Hybrid retrieval: BM25 + vector similarity fused with Reciprocal Rank Fusion,
an optional cross-encoder reranker, and a calibrated retrieval confidence.

RRF is rank-based, so it fuses the two very differently-scaled signals (BM25
term scores vs. cosine) without hand-tuned weights. The confidence is derived
from ranking agreement between the two retrievers — high when both put the same
clause on top, low when they disagree — which is exactly the signal the
anti-hallucination gate needs.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import RagConfig, get_rag_config
from .embeddings import Embedder, get_embedder
from .store import Scored, VectorStore


@dataclass
class RetrievedChunk:
    ref: str
    heading: str
    text: str
    score: float  # fused RRF (or rerank) score
    doc_id: str


@dataclass
class RetrievalResult:
    chunks: list[RetrievedChunk]
    confidence: float
    method: str

    @property
    def cited_refs(self) -> list[str]:
        seen: list[str] = []
        for c in self.chunks:
            if c.ref not in seen:
                seen.append(c.ref)
        return seen


def _rrf_merge(
    ranked_lists: list[list[Scored]], rrf_k: int
) -> dict[str, tuple[Scored, float]]:
    fused: dict[str, tuple[Scored, float]] = {}
    for ranked in ranked_lists:
        for rank, scored in enumerate(ranked):
            cid = scored.chunk.id
            contribution = 1.0 / (rrf_k + rank + 1)
            if cid in fused:
                prev_scored, prev = fused[cid]
                fused[cid] = (prev_scored, prev + contribution)
            else:
                fused[cid] = (scored, contribution)
    return fused


def _maybe_rerank(
    query: str, candidates: list[tuple[Scored, float]], cfg: RagConfig
) -> list[tuple[Scored, float]] | None:
    """Cross-encoder rerank the fused candidates. Returns None if unavailable."""
    if not cfg.rerank:
        return None
    try:
        from sentence_transformers import CrossEncoder  # lazy, optional
    except Exception:  # noqa: BLE001
        return None
    try:
        model = CrossEncoder(cfg.rerank_model)
        pairs = [(query, sc.chunk.text) for sc, _ in candidates]
        scores = model.predict(pairs)
        return [
            (sc, float(s)) for (sc, _), s in sorted(
                zip(candidates, scores, strict=True), key=lambda z: z[1], reverse=True
            )
        ]
    except Exception:  # noqa: BLE001
        return None


def retrieve(
    query: str,
    store: VectorStore,
    *,
    namespace: str = "default",
    cfg: RagConfig | None = None,
    embedder: Embedder | None = None,
) -> RetrievalResult:
    cfg = cfg or get_rag_config()
    embedder = embedder or get_embedder(cfg)

    lex = store.lexical(query, cfg.candidate_k, namespace)
    vec = store.vector(embedder.embed_one(query), cfg.candidate_k, namespace)

    if not lex and not vec:
        return RetrievalResult(chunks=[], confidence=0.0, method="empty")

    fused = _rrf_merge([lex, vec], cfg.rrf_k)
    ordered = sorted(fused.values(), key=lambda t: t[1], reverse=True)

    reranked = _maybe_rerank(query, ordered[: cfg.candidate_k], cfg)
    method = "hybrid-rrf"
    if reranked is not None:
        ordered = reranked
        method = "hybrid-rrf+rerank"

    top = ordered[: cfg.top_k]
    chunks = [
        RetrievedChunk(
            ref=sc.chunk.ref,
            heading=sc.chunk.heading,
            text=sc.chunk.text,
            score=score,
            doc_id=sc.chunk.doc_id,
        )
        for sc, score in top
    ]

    confidence = _confidence(lex, vec, cfg) if reranked is None else _rerank_conf(ordered)
    return RetrievalResult(chunks=chunks, confidence=confidence, method=method)


def _confidence(lex: list[Scored], vec: list[Scored], cfg: RagConfig) -> float:
    """RRF-style confidence in [0,1]: how strongly, and how in-agreement, the two
    retrievers rank their top clause. 1.0 ≈ same clause ranked #1 by both.
    """
    lists = [lst for lst in (lex, vec) if lst]
    if not lists:
        return 0.0
    fused = _rrf_merge(lists, cfg.rrf_k)
    if not fused:
        return 0.0
    best = max(score for _, score in fused.values())
    # Theoretical max: ranked #1 in every non-empty list.
    ceil = len(lists) * (1.0 / (cfg.rrf_k + 1))
    return max(0.0, min(1.0, best / ceil)) if ceil else 0.0


def _rerank_conf(ordered: list[tuple[Scored, float]]) -> float:
    """Squash the top cross-encoder logit to [0,1] via a logistic."""
    if not ordered:
        return 0.0
    import math

    return 1.0 / (1.0 + math.exp(-ordered[0][1]))
