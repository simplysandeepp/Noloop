# NoLoop backend (FastAPI)

**The primary NoLoop API** (port 4000) — full Python port of `../backend`
(NestJS), verified endpoint-by-endpoint against it (28/28 responses
deep-equal on the same DB + JWTs). See [docs/techstack.md](../docs/techstack.md).

```bash
./start.sh                 # venv bootstrap + uvicorn on :4000
# or manually:
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 4000 --reload
```

Config comes from `../backend/.env` (shared during the transition) or a
local `.env`. Schema migrations are Alembic-owned from baseline
`0001_baseline` (the schema itself was created by Prisma):

```bash
PYTHONPATH=$PWD .venv/bin/alembic revision -m "..."   # new migration
PYTHONPATH=$PWD .venv/bin/alembic upgrade head
```
