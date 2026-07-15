"""NoLoop core backend — FastAPI port of backend/ (NestJS).

Same routes, same response shapes, same JWT contract — the frontends
must not notice the swap. Runs on :4001 during the migration; takes over
:4000 once parity is verified (docs/todo.md PR 7).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import health

app = FastAPI(title="NoLoop API", docs_url="/docs", redoc_url=None)

# Allow the frontend + admin (different subdomains) to call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
