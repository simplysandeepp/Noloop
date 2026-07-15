# Run everything

- cd Noloop/backend-py && ./start.sh       # API (FastAPI, primary)  :4000
- cd Noloop/ai && ./start.sh               # AI engine               :8000
- cd Noloop && bun run dev                 # web                     :3000
- cd Noloop-adminpanel && bun run dev      # admin                   :3001

Legacy (kept until backend-py has run clean for a while — see issue #17):

- cd Noloop/backend && API_PORT=4002 bun run dev   # old NestJS API  :4002

DB GUI: Supabase Studio (dashboard) — Prisma Studio still works from
`backend/` while the legacy backend exists.
