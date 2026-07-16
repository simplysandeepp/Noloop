# Database scaling runbook (issue #21)

Data-layer growth plan for ~50k patient records/day (~18M rows/year). Postgres
handles this comfortably **if** indexed, pooled, and (eventually) partitioned
deliberately. This documents those decisions.

## Indexing

Migration `0002_perf_indexes` adds the indexes that cover the hot query paths:

| Index | Query it serves |
|-------|-----------------|
| `Claim(hospitalTenantId, status)` | hospital claim list, optional status filter |
| `Claim(insurerTenantId, status)` | insurer claim list, optional status filter |
| `Claim(submittedAt DESC)` | default listing order (`ORDER BY submittedAt DESC LIMIT 200`) |
| `ClaimEvent(claimId, createdAt)` | claim timeline (events per claim, chronological) |
| `ActivityLog(createdAt DESC)` | admin activity feed (newest first) |

Apply: `cd backend && alembic upgrade head` (uses `DIRECT_URL`, not the pooler).

**Verify impact** with `EXPLAIN (ANALYZE, BUFFERS)` before/after on the real
query, and turn on `pg_stat_statements` to find the actual top-cost queries after
the swap — add composite indexes only where the audit shows seq-scans.

**Large tables**: for a table already holding millions of rows, build the index
with `CREATE INDEX CONCURRENTLY` (no write lock) run **outside** a transaction —
Alembic wraps migrations in a transaction, so run those by hand or in a migration
marked non-transactional.

## Partitioning (defer until it's needed)

The two highest-churn tables are `ClaimEvent` and `Claim`. When they get big,
range-partition by time:

- `ClaimEvent` → monthly `RANGE (createdAt)`
- `Claim` → monthly `RANGE (submittedAt)`

**Trigger point** (don't partition prematurely): > ~10M rows in the table **or**
p95 of the list query > 200ms despite indexes. Runbook when triggered:
1. Create the partitioned parent + monthly partitions ahead of time (a cron
   creates next month's partition).
2. Backfill historical rows into partitions during a low-traffic window.
3. Swap the table in via rename; validate with the parity/contract tests.

Partition pruning then keeps each query touching only the relevant month(s).

**Retention**: archive/cold-store `ClaimEvent` older than N years (N set by
healthcare compliance) by detaching old partitions to cheap storage.

## Connection management

Production topology (already configured in `app/db.py`):

```
app (Render)  ──►  Supabase pooler (pgbouncer, transaction mode)  ──►  Postgres
                    NullPool + statement_cache_size=0 + unique prepared-stmt names
Alembic       ──►  DIRECT_URL (direct connection, no pooler)
```

pgbouncer transaction mode requires `statement_cache_size=0` and unique
prepared-statement names (asyncpg's default counter collides across pgbouncer's
shared server connections) — both set in `db.py`.

**Right-sizing**: with NullPool, each app worker opens a connection per in-flight
request. Keep `instances × uvicorn_workers × concurrency` **below the pooler's
client limit**. Example: pooler default ~200 client conns → e.g. 4 instances ×
1 worker × ~40 concurrent ≈ 160, leaving headroom. Measure real concurrency from
the p95 latency × RPS (Little's law) once load tests (#22) run.

## Backups & disaster recovery

- **Confirm** Supabase automated backup schedule + retention on the current plan
  (dashboard → Database → Backups).
- **Run a real restore drill** into a scratch Supabase project and measure:
  - **RPO** (data-loss window) = backup frequency.
  - **RTO** (time to restore) = measured restore duration end-to-end.
  An untested backup is not a backup.
- **Belt-and-braces**: nightly `pg_dump` to external storage via a GitHub Actions
  cron (compressed custom format `-Fc`), retained N days.

### "DB is gone at 9am" runbook
1. Declare incident; put the API in maintenance (503 with a status page).
2. Restore latest Supabase backup into a fresh project (or PITR to just before
   the incident).
3. Point `DATABASE_URL`/`DIRECT_URL` at the restored instance; run
   `alembic upgrade head` to confirm schema head.
4. Smoke-test `/health`, auth, a claim submit + `/track`.
5. Re-open traffic; write the post-mortem (RTO/RPO actuals vs targets).
