#!/usr/bin/env bash
# NoLoop core backend (FastAPI) — primary backend on :4000.
cd "$(dirname "$0")"
[ -d .venv ] || { python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt; }
exec .venv/bin/uvicorn app.main:app --port "${API_PORT:-4000}" "$@"
