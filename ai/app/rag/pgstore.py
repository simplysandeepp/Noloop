"""Production store: pgvector + Postgres FTS in Supabase.

Implements the same two primitives as InMemoryStore — ``lexical`` (ts_rank over
a GIN tsvector) and ``vector`` (cosine distance over an HNSW index) — so the
hybrid RRF fusion in retrieve.py works unchanged.

Optional: needs ``psycopg[binary]`` and a reachable ``DATABASE_URL`` with the
schema in schema.sql applied (pgvector extension + HNSW index). Everything is
lazy so the base engine install and CI never require it; service.py falls back
to the in-memory store if this can't be constructed.
"""

from __future__ import annotations

import os

from .chunk import Chunk
from .embeddings import Embedder
from .store import Scored, VectorStore


def _vec_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


class PgVectorStore(VectorStore):
    def __init__(self, dsn: str | None = None):
        import psycopg  # lazy, optional

        self._psycopg = psycopg
        self._dsn = dsn or os.environ["DATABASE_URL"]
        # Fail fast if unreachable so service.py can fall back.
        with self._connect() as conn:
            conn.execute("SELECT 1")

    def _connect(self):
        # Strip async/driver query params a plain psycopg connection rejects.
        dsn = self._dsn.replace("+asyncpg", "").split("?", 1)[0]
        return self._psycopg.connect(dsn, autocommit=True)

    def add(self, chunks: list[Chunk], embedder: Embedder, namespace: str = "default") -> None:
        if not chunks:
            return
        vecs = embedder.embed([c.text for c in chunks])
        rows = [
            (c.id, namespace, c.doc_id, c.ref, c.heading, c.text, _vec_literal(v))
            for c, v in zip(chunks, vecs, strict=True)
        ]
        with self._connect() as conn:
            conn.cursor().executemany(
                """
                INSERT INTO rag_chunks
                    (id, namespace, doc_id, ref, heading, content, embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    content = EXCLUDED.content,
                    embedding = EXCLUDED.embedding,
                    ref = EXCLUDED.ref,
                    heading = EXCLUDED.heading
                """,
                rows,
            )

    def count(self, namespace: str = "default") -> int:
        with self._connect() as conn:
            cur = conn.execute(
                "SELECT count(*) FROM rag_chunks WHERE namespace = %s", (namespace,)
            )
            return int(cur.fetchone()[0])

    def vector(self, query_vec: list[float], k: int, namespace: str = "default") -> list[Scored]:
        lit = _vec_literal(query_vec)
        with self._connect() as conn:
            cur = conn.execute(
                """
                SELECT doc_id, ref, heading, content, 1 - (embedding <=> %s) AS sim
                FROM rag_chunks
                WHERE namespace = %s AND embedding IS NOT NULL
                ORDER BY embedding <=> %s
                LIMIT %s
                """,
                (lit, namespace, lit, k),
            )
            return [self._row(r) for r in cur.fetchall()]

    def lexical(self, query: str, k: int, namespace: str = "default") -> list[Scored]:
        with self._connect() as conn:
            cur = conn.execute(
                """
                SELECT doc_id, ref, heading, content,
                       ts_rank(tsv, websearch_to_tsquery('english', %s)) AS rank
                FROM rag_chunks
                WHERE namespace = %s
                  AND tsv @@ websearch_to_tsquery('english', %s)
                ORDER BY rank DESC
                LIMIT %s
                """,
                (query, namespace, query, k),
            )
            return [self._row(r) for r in cur.fetchall()]

    @staticmethod
    def _row(r) -> Scored:
        doc_id, ref, heading, content, score = r
        # Derive a stable ordinal from the content so the SAME row gets the SAME
        # chunk.id in both the lexical and vector result sets — RRF fuses on id.
        ordinal = abs(hash((doc_id, ref, content))) % 10_000_000
        chunk = Chunk(doc_id=doc_id, ref=ref, heading=heading, text=content, ordinal=ordinal)
        return Scored(chunk, float(score))
