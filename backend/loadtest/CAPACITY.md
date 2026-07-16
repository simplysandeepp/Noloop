# Load testing & capacity planning (issue #22)

Target load: 1,000–1,500 employee logins/day, ~50k patient records/day,
burst-heavy (hospital mornings). This proves the numbers instead of assuming them.

## Scenarios (k6, in this folder)

| Script | Models | Notes |
|--------|--------|-------|
| `read-mix.js` | steady read traffic (list, detail, stats, track) | validates the read SLO |
| `login-storm.js` | 200 logins / 5 min (shift start) | bcrypt cost 10 is the CPU hot spot; also exercises the login rate limiter |
| `claim-burst.js` | 500 submissions / 10 min | run with queue OFF (sync) and ON (worker absorbs) to compare |

Still to add (templates — same shape): **OCR burst** on `/claims/extract`
(verifies rate-limit + queue shielding of Groq's free tier) and a **2h soak** at
2× average to find connection/memory leaks.

## Initial SLOs (tune after the first run)

- p95 **< 500ms** on reads, **< 2s** on claim submit (sync path).
- Error rate **< 0.5%** (5xx only; 401/429 are expected outcomes).
- **Zero dropped/duplicated claims** under burst (idempotency proof — the queue
  uses `claimNumber` as the job id, #14).
- DB connections stay **under the pooler limit**; no 5xx from pool exhaustion.

## How to run

```bash
# Install k6: https://k6.io/docs/get-started/installation/
BASE_URL=https://<staging-api> TOKEN=<jwt> \
  k6 run backend/loadtest/read-mix.js
```

**Rules**: run against a **staging** env only — NEVER prod, and never the shared
dev DB without a cleanup plan (`claim-burst.js` inserts rows). The GitHub Actions
workflow (`.github/workflows/loadtest.yml`) is manual-trigger only and takes the
target URL as an input.

## Capacity math (fill in from measured runs)

1. Measure **max sustained RPS per Render instance** at the SLO (ramp until p95
   crosses 500ms / errors cross 0.5%).
2. Expected steady RPS ≈ daily reads / peak-hour concentration. Peak concurrency
   ≈ RPS × p95_latency (Little's law).
3. Instances needed at 2× / 5× / 10× growth = ceil(peak RPS × N / per-instance max).
4. Cross-check: `instances × workers × concurrency` **<** Supabase pooler client
   limit (see `backend/DB_SCALING.md`).

| Growth | Peak RPS | Instances | Pooler conns | Est. cost |
|--------|----------|-----------|--------------|-----------|
| 1×     | _TBD_    | _TBD_     | _TBD_        | _TBD_     |
| 2×     | _TBD_    | _TBD_     | _TBD_        | _TBD_     |
| 5×     | _TBD_    | _TBD_     | _TBD_        | _TBD_     |
| 10×    | _TBD_    | _TBD_     | _TBD_        | _TBD_     |

Feed the measured SLOs back into the observability alert thresholds (#18):
alert when p95 or error rate exceeds the numbers you measured here.

## Method notes
- **Open vs closed model**: these use k6 arrival-rate executors (open model) so a
  slow server doesn't artificially throttle the offered load — avoids the
  coordinated-omission trap that closed (VU-looping) models fall into.
