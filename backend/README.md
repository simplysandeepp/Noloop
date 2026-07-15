# NoLoop backend (FastAPI)

**The NoLoop API** (port 4000) — Python/FastAPI. Full port of the original
NestJS backend (retired 2026-07-15; in git history), verified
endpoint-by-endpoint against it before the swap (28/28 responses deep-equal
on the same DB + JWTs). See [docs/techstack.md](../docs/techstack.md).

```bash
./start.sh                 # venv bootstrap + uvicorn on :4000
# or manually:
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 4000 --reload
```

Config: `.env` in this directory (see `.env.example`). Schema migrations
are Alembic-owned from baseline `0001_baseline`; the original schema was
created by Prisma (reference: `migrations/prisma-baseline.schema.prisma`).
Synthetic eval data: `bun scripts/generate-synthetic-claims.ts 20 42`
(writes `data/synthetic/`, gitignored):

```bash
PYTHONPATH=$PWD .venv/bin/alembic revision -m "..."   # new migration
PYTHONPATH=$PWD .venv/bin/alembic upgrade head
```
