# NoLoop backend (FastAPI)

Python port of `../backend` (NestJS) — see [docs/todo.md](../docs/todo.md) for the migration tracker and [docs/techstack.md](../docs/techstack.md) for the stack.

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --port 4001 --reload
```
