# Autonomous work log — for Sandeep to review

Session started 2026-07-16. Working through open issues #13–#23 and hardening the
RAG / AI pipeline. One branch → PR → squash-merge per task. Personal repo only.

> **Groq key:** everything reads `GROQ_API_KEY` from env and degrades gracefully
> when it is absent. Add the key last; nothing here blocks on it.

---

## ✅ #20 — Test / lint / CI foundation  (branch `feat/test-lint-ci-foundation`)

The repo had **no Python tests, lint, or CI**. Established all three so every
later PR has a real gate to pass.

**Added**
- `backend/pyproject.toml`, `ai/pyproject.toml` — ruff (lint + import sort),
  pytest, mypy config. Targeted ignores documented inline (UP042 str+Enum parity,
  UP031 en-IN money %-format, E402 in `ai/app/main.py` for the intentional
  `load_dotenv()`-before-imports ordering).
- `backend/requirements-dev.txt`, `ai/requirements-dev.txt` — ruff/pytest/mypy.
- **Backend unit tests** (`backend/tests/`): `common.py` (js_round half-up,
  iso Z-millis, slug helpers), `security.py` (JWT round-trip, tamper rejection,
  bcrypt incl. a **real `$2a$` bcryptjs hash** so NestJS-era users still verify),
  `ai_client.py` fallback engine (verdicts + en-IN ₹ grouping).
- **AI engine tests** (`ai/tests/`): committed fixture packets (APPROVE / DENY ×3 /
  QUERY ×2) run through the pipeline as a **verdict regression gate**, deduction
  math (sum-insured cap, room-rent cap, co-pay), extract graceful-degrade.
  Fixtures are committed because `backend/data/` (the synthetic set) is gitignored,
  so CI needs its own.
- `.github/workflows/ci.yml` — 3 jobs: backend (ruff + pytest), ai (ruff + pytest),
  web (bun build). Runs on PR + main + manual.

**Verified locally:** backend 17 passed, ai 16 passed, `ruff check` clean on both.

**Notes / follow-ups**
- CI does **not** yet run `ruff format --check` — the existing code isn't
  ruff-format-clean (10 files would reflow) and reformatting was out of scope for
  a foundation PR. Enable it after a dedicated format pass.
- mypy is configured but not yet a CI gate (would need a typing pass first).
- The `web` CI job assumes `bun install --frozen-lockfile` + `bun run build`
  succeed on CI; if the lockfile drifts, that job will flag it.

---

## ✅ #15 — RAG service (capstone centerpiece)  (branch `feat/rag-service`)

Built a full RAG layer in `ai/app/rag/` that powers the pipeline's **coverage**
stage with citation-grounded, low-hallucination answers. **Runs fully offline
with zero setup** (hashing embedder + in-memory BM25/vector store) and upgrades
to real semantic embeddings + pgvector **by env only**, no code changes.

**Added (`ai/app/rag/`)**
- `chunk.py` — structure-aware chunking; every chunk carries a **clause ref** so
  citations are real (`citedClauseRefs = ["7_EXCLUSIONS"]`, not a literal).
- `embeddings.py` — pluggable embedders: deterministic `hash` (default, offline,
  dependency-free) and optional `sentence-transformers` (bge-small/all-MiniLM).
- `store.py` — `InMemoryStore`: Okapi BM25 + brute-force cosine, namespaced.
- `pgstore.py` — `PgVectorStore`: Postgres FTS + pgvector HNSW (prod, optional deps).
- `retrieve.py` — **hybrid BM25+vector fused with RRF**, optional cross-encoder
  rerank, and a ranking-agreement **confidence** for the anti-hallucination gate.
- `coverage.py` — grounded coverage decision; **refuses (NOT_FOUND → review) below
  a confidence floor**; exclusions beat coverage; only cites retrieved clauses.
- `policy_doc.py` — synthesizes a wording doc from structured policy fields so
  there's always a real, citable corpus even without uploaded PDFs.
- `service.py` — resolves corpus (ingested pgvector doc → synthesized) per policy,
  caches the in-memory store by content hash.
- `schema.sql` — pgvector DDL (extension, table, HNSW + GIN indexes).

**Wiring**: `pipeline/coverage.py` now uses RAG by default (`NOLOOP_RAG_COVERAGE=1`)
and **falls back to the old exact-list check** if disabled or on any error, so
adjudication can never break. New `POST /rag/coverage` demo endpoint on the AI engine.

**Eval + tests**: `scripts/eval_rag.py` + `tests/rag_fixtures/` (a realistic policy
+ 15-case eval set). CI gate `test_rag_eval.py` enforces Recall@k ≥ 0.9, MRR ≥ 0.75,
coverage accuracy ≥ 0.9. **Current: Recall@k 100%, MRR 0.923, coverage 100%.**
Plus 15 RAG unit tests (chunking, embeddings, BM25, vector, RRF, refusal path).
`scripts/ingest.py` CLI for ingesting policy docs (`--dry-run` or pgvector upsert).

**Verified**: ai 31 passed, ruff clean; the 6 pipeline verdict fixtures still pass
*through* the RAG coverage path (no verdict regressions). Groq not required.

**Docs**: `ai/RAG.md` (architecture, config, ingestion, eval, prod upgrade path).
Optional prod deps in `ai/requirements-rag.txt`.

**Notes / follow-ups**
- `PgVectorStore` and the `sentence-transformers`/reranker paths are implemented
  but **not exercised in CI** (no DB / heavy models in CI). Validate against a real
  Supabase pgvector instance before relying on them in prod; the DDL is in
  `ai/app/rag/schema.sql` (set `VECTOR(dim)` to your model, e.g. 384 for MiniLM).
- The offline default embedder is lexical-ish; real semantic recall arrives when
  you flip `NOLOOP_EMBEDDING_BACKEND=sentence-transformers`.
- `ai/docs/` is gitignored (root `.gitignore` ignores any `docs/`), so RAG docs
  live at `ai/RAG.md`.

---

## ✅ #18 — Observability  (branch `feat/observability`)

Structured logging + request tracing + Prometheus metrics on **both** FastAPI
services.

**Added**: `backend/app/observability.py` + `ai/app/observability.py`
- **structlog JSON logs** — one access line per request: method, route (template,
  not raw path → bounded cardinality), status, latency_ms, request_id, and (core
  API) tenant_id + user_id from the JWT. **PHI-safe: ids only**, never patient
  names/diagnoses/tokens.
- **Request-ID middleware** — reads/generates `X-Request-ID`, stores it in a
  contextvar, echoes it on the response. `ai_client` now **forwards** it to the
  AI engine, so one claim submission is traceable web → core API → AI engine.
- **Prometheus** at `GET /internal/metrics` on both services (the analytics
  router already owns `/metrics`, hence the `/internal` path). Golden signals
  (RED: request count + latency histogram per route/status) + **business metrics**:
  claims submitted, AI verdict distribution, fraud-flag counts, engine fallback
  rate, login failures (core); adjudications/verdict, engine model, RAG coverage
  outcomes, pipeline latency (AI engine).

**Impl note**: used `prometheus_client` directly instead of
`prometheus-fastapi-instrumentator` — the instrumentator's `.expose()` broke on
the pinned FastAPI/Starlette combo. Direct usage is version-robust and gives full
control over metric names/labels.

**Verified**: backend 21 passed, ai 34 passed, ruff clean on both.

**Follow-ups (from the issue, not done here)**: OpenTelemetry/OTLP tracing export
(Grafana/Honeycomb), uptime checks + alert rules, and the Grafana dashboard are
infra/config to set up when deploying (#16). The metric + trace-id plumbing they
need is now in place.

---

## ✅ #19 — API security hardening  (branch `feat/security-hardening`)

**Added**: `backend/app/hardening.py` + wiring in `main.py`, `auth.py`, `claims.py`
- **Security headers** middleware: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS.
- **Body-size limit** middleware (10MB) — rejects oversized uploads at 413 before
  routing/DB, in the Nest error shape.
- **CORS allowlist** via `CORS_ORIGINS` env (comma-separated) — replaces the
  `.*` regex when set; keeps the permissive default when unset (dev).
- **Rate limiter**: per-IP fixed-window, two backends — in-process (default) and
  Redis (when `REDIS_URL` set, namespaced `noloop:v1:rl:…`). **Fails open** on
  backend errors (never locks a healthcare system out). 429 in Nest error shape.
  Applied: `/auth/login` (10/min), `/auth/signup` (5/min), `/track/{n}` (30/min).
- **Audit/metrics**: `/auth/login` now increments `noloop_login_failures_total`.

**Verified**: backend 26 passed, ruff clean, app imports clean.

**Follow-ups (from the issue, not done here)** — larger auth-lifecycle work best
done deliberately, noted for you:
- Refresh-token rotation + short-lived access tokens (currently single 7d JWT).
- Redis token-revocation list (immediate logout / REVOKED enforcement).
- Per-account exponential lockout on `/auth/login` (IP limit is in; per-account
  needs a keyed counter + a small schema/consideration).
- Extend `ActivityLog` to 403s / admin-destructive actions with actor + IP, and
  assert ActivityLog immutability. PHI-in-prompt masking review (data-flow doc).

---

## ✅ #14 — Async task queue (arq)  (branch `feat/async-task-queue`)

Moves claim adjudication off the request path, **opt-in** and fully
backward-compatible.

**Added**
- `backend/app/adjudication.py` — the run-engine-and-persist logic **extracted
  verbatim** from `claims.submit` so the inline path and the worker can never
  drift. Includes `packet_from_claim` (worker rebuilds the packet from the DB row).
- `backend/app/queue.py` — `enqueue_adjudication()`; enqueues to arq when
  `NOLOOP_USE_QUEUE=1` + Redis reachable, else **returns False → caller
  adjudicates inline**. Idempotency: arq `job_id = adj:<claimNumber>`.
- `backend/app/worker.py` — `arq app.worker.WorkerSettings`; loads the claim,
  runs the shared adjudication, **idempotent** (skips if already decided),
  retries with backoff (`max_tries=4`).
- `claims.submit` now enqueues when enabled, else runs inline — **default off, so
  today's synchronous behaviour and all tests are unchanged**.

**Run the worker**: `cd backend && arq app.worker.WorkerSettings` (needs
`REDIS_URL` + `NOLOOP_USE_QUEUE=1`).

**Verified**: backend 32 passed, ruff clean, all modules import without Redis.

**Follow-ups**: also queue `/claims/extract` (Groq shield) and add DLQ handling —
noted in the issue; the queue plumbing to do it is in place.

---

## ✅ #23 — Redis caching layer  (branch `feat/redis-caching`)

**Added**: `backend/app/cache.py` — cache-aside on Upstash Redis, namespaced
`noloop:v1:…` (version prefix → bulk-bust on deploy), per-process asyncio
single-flight to blunt stampedes, and a **graceful no-op** without `REDIS_URL`
(every helper falls back to calling the loader).

**Applied** (consistency choice documented per key):
- `/admin/stats` — **TTL-only 30s** (6 COUNTs/hit; eventual staleness is fine).
- `/track/{n}` — **TTL 15s + read-after-write invalidation**: override/settle/
  respond delete the key so patients see updates immediately; TTL covers the AI
  transition.

**Verified**: backend 36 passed, ruff clean, app imports clean.

**Follow-ups**: `/org/overview` + AI policy-packet caching and hit/miss metrics
are easy next steps on this module (noted in the issue).

---

## ✅ #21 — Database scaling  (branch `feat/db-scaling`)

- **Migration** `0002_perf_indexes` (additive, `CREATE INDEX IF NOT EXISTS` →
  idempotent): `Claim(hospitalTenantId,status)`, `Claim(insurerTenantId,status)`,
  `Claim(submittedAt DESC)`, `ClaimEvent(claimId,createdAt)`,
  `ActivityLog(createdAt DESC)` — the hot query paths.
- **Runbook** `backend/DB_SCALING.md`: indexing (with EXPLAIN/pg_stat_statements
  guidance + CONCURRENTLY note for big tables), monthly range-partitioning plan +
  trigger points, pgbouncer connection-math, and a backup/restore drill + "DB is
  gone at 9am" runbook (RTO/RPO).

**Verified**: migration compiles, ruff clean, backend 36 passed. (Applying the
migration needs the DB — run `alembic upgrade head` when you're on it.)

---

## ✅ #22 — Load testing & capacity planning  (branch `feat/load-testing`)

- **k6 scenarios** in `backend/loadtest/`: `read-mix` (steady reads, p95<500ms),
  `login-storm` (200/5min — bcrypt hot spot + rate limiter), `claim-burst`
  (500/10min — run queue on/off, idempotency proof). Open-model arrival-rate
  executors → avoids coordinated omission.
- **`CAPACITY.md`**: initial SLOs, run instructions, capacity-math template
  (RPS → instances at 2×/5×/10× vs pooler limit), method notes.
- **`.github/workflows/loadtest.yml`**: manual-trigger only, refuses non-staging
  URLs, installs k6, runs the chosen scenario.

**Verified**: workflow YAML valid; all 3 scripts pass `node --check`.
**Follow-ups**: OCR-burst + 2h soak templates noted in CAPACITY.md.

---

## ✅ #13 — Stale admin password  (branch `feat/creds-reset-helper`)

Root cause of the bind: the documented `admin@noloop.in` password no longer
verifies, and you **can't** use the admin reset API because logging in as that
admin is exactly what's broken (chicken-and-egg).

**Fix**: `backend/scripts/reset_password.py` — an **offline** reset that talks
straight to the DB (no server/login needed):
```
cd backend && python -m scripts.reset_password admin@noloop.in
# prints a fresh temp password once → put it in your local (gitignored) docs/creds.md
```
`docs/creds.md` stays gitignored/local — never committed. Nothing here contains
real credentials.

**Verified**: script compiles, `--help` works (no DB touched), ruff clean.
