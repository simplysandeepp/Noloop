# Deployment (issue #16)

Topology: **Render** runs the two FastAPI services + the async worker; **Vercel**
runs the two Next.js frontends. **Supabase** is Postgres; **Upstash** is Redis.

```
Vercel: noloop-web ─┐
Vercel: admin panel ─┼─► Render: noloop-api (FastAPI) ─► Supabase Postgres (pooler)
                     │            │  └─► Upstash Redis (rate limit + queue)
                     │            └─► Render: noloop-ai (FastAPI, RAG + Groq)
                     └────────────► Render: noloop-worker (arq) ─► same DB + Redis
```

## Backend on Render (blueprint)

`render.yaml` at the repo root defines three services: `noloop-api`, `noloop-ai`,
`noloop-worker`.

1. Render → **New → Blueprint** → select this repo. It creates all three.
2. Fill the `sync:false` secrets in each service's **Environment**:
   - `noloop-api`: `DATABASE_URL` (Supabase **pooler**), `DIRECT_URL` (Supabase
     direct), `JWT_SECRET`, `REDIS_URL` (Upstash), `CORS_ORIGINS` (your Vercel
     domains, comma-separated), `AI_ENGINE_URL` (the `noloop-ai` service URL).
   - `noloop-ai`: `GROQ_API_KEY` (optional — engine + RAG work without it).
   - `noloop-worker`: `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `AI_ENGINE_URL`.
3. **Run migrations once** (from a shell with `DIRECT_URL` set):
   `cd backend && alembic upgrade head` — includes the perf indexes (#21).
4. Health checks: both web services expose `/health` (already wired as
   `healthCheckPath`). Prometheus scrape at `/internal/metrics` (#18).

### Notes
- `AI_ENGINE_URL` is left `sync:false` so you paste `noloop-ai`'s full `https://…`
  URL (Render env vars can't concatenate a scheme onto a `fromService` host).
- Queue is on (`NOLOOP_USE_QUEUE=1`): `noloop-api` enqueues, `noloop-worker`
  adjudicates. Set it to `0` to fall back to synchronous adjudication.
- Right-size instance count against the Supabase pooler client limit — see
  `backend/DB_SCALING.md`.

## Frontends on Vercel

Two projects (repo root `noloop-web`, and the separate admin-panel repo). Each has
`vercel.json` (`framework: nextjs`, `bun install` / `bun run build`).

1. Vercel → **Add New Project** → import the repo. Framework auto-detects Next.js.
2. Set the API base URL env the frontend reads to the `noloop-api` Render URL.
3. Add the deployed Vercel domains to `noloop-api`'s `CORS_ORIGINS`.
4. Vercel auto-deploys on push to `main`; preview deploys per PR.

## Observability & alerting (follow-up, ties into #18)
- Uptime checks on `noloop-api` + `noloop-ai` `/health` (Render health checks or
  UptimeRobot free).
- Point a Prometheus/Grafana Cloud (free tier) agent at `/internal/metrics`;
  alert on error rate > 2% / 5 min, p95 > 1s, queue depth growing.
