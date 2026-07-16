"""NoLoop core backend — FastAPI port of backend/ (NestJS).

Same routes, same response shapes, same JWT contract — the frontends
must not notice the swap. Runs on :4001 during the migration; takes over
:4000 once parity is verified (docs/todo.md PR 7).
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .errors import install_error_handlers
from .hardening import cors_origins, install_hardening
from .observability import setup_observability
from .routers import admin, auth, beds, catalog, claims, health, metrics, org

app = FastAPI(title="NoLoop API", docs_url="/docs", redoc_url=None)
install_error_handlers(app)
setup_observability(app, service="noloop-api")
install_hardening(app)  # security headers + request body-size limit

# CORS: prefer an explicit allowlist (CORS_ORIGINS env) in production; fall back
# to the permissive dev default when unset (see NOTES — lock this down on deploy).
_origins = cors_origins()
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=".*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(org.router)
app.include_router(admin.router)
app.include_router(claims.router)
app.include_router(claims.track_router)
app.include_router(beds.router)
app.include_router(catalog.router)
app.include_router(metrics.router)
