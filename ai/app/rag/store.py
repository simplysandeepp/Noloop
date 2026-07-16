"""Vector + lexical stores behind one interface.

Both stores expose two primitive searches — ``lexical`` (BM25 / Postgres FTS)
and ``vector`` (cosine / pgvector) — and the hybrid fusion lives one layer up in
retrieve.py. This split maps cleanly onto both an in-process store (default,
used in tests/CI and as a live fallback) and pgvector in Supabase (production).
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass

from .chunk import Chunk
from .embeddings import Embedder, cosine, tokenize


@dataclass
class Scored:
    chunk: Chunk
    score: float


class VectorStore:
    """Interface. ``namespace`` scopes a corpus (e.g. one policyId)."""

    def add(self, chunks: list[Chunk], embedder: Embedder, namespace: str = "default") -> None:
        raise NotImplementedError

    def lexical(self, query: str, k: int, namespace: str = "default") -> list[Scored]:
        raise NotImplementedError

    def vector(self, query_vec: list[float], k: int, namespace: str = "default") -> list[Scored]:
        raise NotImplementedError

    def count(self, namespace: str = "default") -> int:
        raise NotImplementedError


class InMemoryStore(VectorStore):
    """BM25 + brute-force cosine over an in-process corpus.

    Fine for hundreds–thousands of clauses (a handful of policy documents),
    which is the realistic per-query working set. Deterministic, no I/O.
    """

    # BM25 hyperparameters (Robertson/Sparck-Jones defaults).
    K1 = 1.5
    B = 0.75

    def __init__(self) -> None:
        self._chunks: dict[str, list[Chunk]] = defaultdict(list)
        self._vecs: dict[str, list[list[float]]] = defaultdict(list)
        self._toks: dict[str, list[list[str]]] = defaultdict(list)

    def add(self, chunks: list[Chunk], embedder: Embedder, namespace: str = "default") -> None:
        if not chunks:
            return
        vecs = embedder.embed([c.text for c in chunks])
        for c, v in zip(chunks, vecs, strict=True):
            self._chunks[namespace].append(c)
            self._vecs[namespace].append(v)
            self._toks[namespace].append(tokenize(c.text))

    def count(self, namespace: str = "default") -> int:
        return len(self._chunks.get(namespace, []))

    def vector(self, query_vec: list[float], k: int, namespace: str = "default") -> list[Scored]:
        chunks = self._chunks.get(namespace, [])
        vecs = self._vecs.get(namespace, [])
        scored = [Scored(c, cosine(query_vec, v)) for c, v in zip(chunks, vecs, strict=True)]
        scored.sort(key=lambda s: s.score, reverse=True)
        return scored[:k]

    def lexical(self, query: str, k: int, namespace: str = "default") -> list[Scored]:
        chunks = self._chunks.get(namespace, [])
        toks = self._toks.get(namespace, [])
        n = len(chunks)
        if n == 0:
            return []
        q_terms = set(tokenize(query))
        if not q_terms:
            return []

        # Document frequencies over this namespace.
        df: dict[str, int] = defaultdict(int)
        for doc in toks:
            for term in set(doc):
                if term in q_terms:
                    df[term] += 1
        avgdl = sum(len(d) for d in toks) / n

        scored: list[Scored] = []
        for c, doc in zip(chunks, toks, strict=True):
            if not doc:
                continue
            tf: dict[str, int] = defaultdict(int)
            for t in doc:
                if t in q_terms:
                    tf[t] += 1
            if not tf:
                continue
            dl = len(doc)
            s = 0.0
            for term, f in tf.items():
                idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
                denom = f + self.K1 * (1 - self.B + self.B * dl / avgdl)
                s += idf * (f * (self.K1 + 1)) / denom
            scored.append(Scored(c, s))
        scored.sort(key=lambda s: s.score, reverse=True)
        return scored[:k]
