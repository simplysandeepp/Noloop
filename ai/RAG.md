# RAG service — policy retrieval + citation-grounded coverage

The centerpiece from issue #15: scalable, low-hallucination retrieval over policy
documents that feeds the adjudication pipeline's **coverage** stage with real
clause citations.

## Design goals

- **Grounded, not guessed.** Coverage is decided only from retrieved clauses,
  always with citations, and refuses (`NOT_FOUND` → human review) when retrieval
  confidence is below a floor.
- **Runs anywhere with zero setup.** Default = deterministic hashing embedder +
  in-process BM25/vector store. No model download, no DB, no Groq key. This is
  what CI and the live fallback use.
- **Production-upgradable by env only.** Point it at a local semantic model
  (`sentence-transformers`) and pgvector in Supabase without code changes.

## Pipeline

```
document ──parse──▶ structure-aware chunk ──embed──▶ store (memory | pgvector)
                     (clause-tagged)                       │
query (procedure) ──────────────────────────────────────┐ │
                                                         ▼ ▼
                       hybrid retrieval:  BM25 ⊕ vector ──RRF──▶ [rerank] ──▶ top-k
                                                         │
                              confidence < floor? ──yes──▶ NOT_FOUND (route to review)
                                                         │no
                              grounded coverage decision (COVERED / EXCLUDED)
                              with real citedClauseRefs
```

## Modules (`app/rag/`)

| file | role |
|------|------|
| `chunk.py` | structure-aware chunking; each chunk carries a **clause ref** for citation |
| `embeddings.py` | pluggable embedders: `hash` (default, offline) / `sentence-transformers` |
| `store.py` | `InMemoryStore` — BM25 + brute-force cosine; the two search primitives |
| `pgstore.py` | `PgVectorStore` — Postgres FTS + pgvector HNSW (production, optional deps) |
| `retrieve.py` | hybrid **RRF** fusion + optional cross-encoder rerank + confidence |
| `coverage.py` | citation-grounded coverage decision + anti-hallucination floor |
| `policy_doc.py` | synthesize a wording doc from structured policy fields (always-available corpus) |
| `service.py` | resolves the corpus (ingested doc → synthesized) and answers per policy |
| `schema.sql` | pgvector DDL: extension, table, HNSW + GIN indexes |

## Retrieval details

- **Hybrid**: lexical BM25 (Okapi, k1=1.5, b=0.75) + vector cosine, fused with
  **Reciprocal Rank Fusion** (rank-based, so the two very differently-scaled
  signals combine without hand-tuned weights).
- **Confidence** is derived from *ranking agreement* between the two retrievers —
  high when both put the same clause on top — which is the right signal for the
  anti-hallucination gate (`NOLOOP_RAG_MIN_CONFIDENCE`, default 0.12).
- **Reranker** (optional): cross-encoder over the fused candidates when
  `NOLOOP_RAG_RERANK=1` and `sentence-transformers` is installed.

## Coverage grounding

Default path is a deterministic heuristic over retrieved clause text: a clause
counts only if it **names the procedure** (all significant tokens present) *and*
carries an exclusion/coverage signal. Exclusions win over coverage (safer). If no
retrieved clause names the procedure, it's `NOT_FOUND` → review, never a guess.
With `GROQ_API_KEY` set, an LLM can read the same retrieved clauses; any answer
citing a clause we didn't retrieve is rejected (no ungrounded citations).

## Ingestion

```bash
cd ai && source .venv/bin/activate
# Dry run — just chunk + embed, persist nothing:
python -m scripts.ingest --namespace POL-431162 --dry-run path/to/policy.md
# Production — upsert into pgvector (needs schema.sql applied):
NOLOOP_RAG_STORE=pgvector DATABASE_URL=postgres://... \
  python -m scripts.ingest --namespace POL-431162 path/to/policy.pdf
```

`.txt`/`.md` need no extra deps; PDF/DOCX use `docling`/`unstructured` if installed.

## Eval (run on every change)

```bash
cd ai && python -m scripts.eval_rag
#   Recall@k, MRR, and grounded-coverage accuracy over tests/rag_fixtures/
```

The same thresholds are a CI gate in `tests/test_rag_eval.py` (Recall@k ≥ 0.9,
MRR ≥ 0.75, coverage accuracy ≥ 0.9). Current fixture set: 100% / 0.92 / 100%.

## Production upgrade path

1. `pip install -r requirements-rag.txt`
2. `psql "$DATABASE_URL" -f app/rag/schema.sql` (set the `VECTOR(dim)` to match
   your model — all-MiniLM-L6-v2 = 384).
3. Set `NOLOOP_EMBEDDING_BACKEND=sentence-transformers`, `NOLOOP_RAG_STORE=pgvector`.
4. Ingest real policy PDFs (`scripts.ingest`), namespaced by policy number.
5. Optionally `NOLOOP_RAG_RERANK=1`.

No pipeline code changes — coverage automatically uses the ingested corpus when
one exists for the claim's policy.
