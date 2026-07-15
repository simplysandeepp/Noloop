# Run everything

- cd Noloop/backend && ./start.sh          # API (FastAPI)  :4000
- cd Noloop/ai && ./start.sh               # AI engine      :8000
- cd Noloop && bun run dev                 # web            :3000
- cd Noloop-adminpanel && bun run dev      # admin          :3001

DB GUI: Supabase Studio (dashboard).
Synthetic claims: cd Noloop/backend && bun scripts/generate-synthetic-claims.ts 20 42
Eval harness:     cd Noloop/ai && .venv/bin/python -m scripts.eval

(The old NestJS backend was retired 2026-07-15 — it lives in git history.)
