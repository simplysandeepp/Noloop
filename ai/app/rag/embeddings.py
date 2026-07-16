"""Pluggable text embedders.

Default: a deterministic hashing embedder — no model download, no torch, fully
offline, stable across runs (so cached vectors stay valid). It is a lexical
signal, which is exactly why retrieval fuses it with BM25 and, in production,
swaps in a real semantic model (sentence-transformers bge-small / all-MiniLM)
by setting NOLOOP_EMBEDDING_BACKEND=sentence-transformers.

All embedders return plain ``list[float]`` L2-normalised vectors, so cosine
similarity is just a dot product and there is no numpy dependency in the
default path.
"""

from __future__ import annotations

import hashlib
import math
import re
from functools import lru_cache

from .config import RagConfig, get_rag_config

_WORD = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    """Lowercase word/number tokens — shared by the hashing embedder and BM25."""
    return _WORD.findall(text.lower())


def _l2_normalise(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec))
    if norm == 0:
        return vec
    return [v / norm for v in vec]


class Embedder:
    """Interface: dim + embed(texts) -> list of vectors."""

    dim: int
    name: str

    def embed(self, texts: list[str]) -> list[list[float]]:  # pragma: no cover
        raise NotImplementedError

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]


class HashingEmbedder(Embedder):
    """Signed feature-hashing of token bigrams+unigrams into a fixed dim.

    Deterministic and dependency-free. Bigrams add a little word-order signal
    over pure bag-of-words.
    """

    def __init__(self, dim: int = 256):
        self.dim = dim
        self.name = f"hash-{dim}"

    def _hash(self, token: str) -> tuple[int, float]:
        h = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        idx = int.from_bytes(h[:4], "big") % self.dim
        sign = 1.0 if (h[4] & 1) else -1.0
        return idx, sign

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for text in texts:
            vec = [0.0] * self.dim
            toks = tokenize(text)
            features = list(toks)
            features += [f"{a}_{b}" for a, b in zip(toks, toks[1:], strict=False)]
            for tok in features:
                idx, sign = self._hash(tok)
                vec[idx] += sign
            out.append(_l2_normalise(vec))
        return out


class SentenceTransformerEmbedder(Embedder):
    """Local semantic embeddings via sentence-transformers (optional extra).

    Lazy-imports the library so the base install stays light. Raises a clear
    error if the extra isn't installed — callers fall back to HashingEmbedder.
    """

    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer  # lazy

        self._model = SentenceTransformer(model_name)
        self.dim = self._model.get_sentence_embedding_dimension()
        self.name = f"st:{model_name}"

    def embed(self, texts: list[str]) -> list[list[float]]:
        vecs = self._model.encode(texts, normalize_embeddings=True)
        return [list(map(float, v)) for v in vecs]


def cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity of two L2-normalised vectors (== dot product)."""
    return sum(x * y for x, y in zip(a, b, strict=True))


@lru_cache(maxsize=4)
def _build(backend: str, model: str, dim: int) -> Embedder:
    if backend == "sentence-transformers":
        try:
            return SentenceTransformerEmbedder(model)
        except Exception:  # noqa: BLE001 — missing extra or download failure
            return HashingEmbedder(dim)
    return HashingEmbedder(dim)


def get_embedder(cfg: RagConfig | None = None) -> Embedder:
    cfg = cfg or get_rag_config()
    return _build(cfg.embedding_backend, cfg.embedding_model, cfg.embedding_dim)
