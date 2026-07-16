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

## Skipped / needs-you

- **#13 (stale admin password in `docs/creds.md`)** — `docs/` is gitignored
  (local-only, and must never hold committed creds), and the fix needs either the
  real password or a live DB + running server to reset it. Can't do safely/blindly
  here. See the dedicated note lower in this file when I reach it.
