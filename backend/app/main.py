"""NoLoop core backend — FastAPI port of backend/ (NestJS).

Same routes, same response shapes, same JWT contract — the frontends
must not notice the swap. Runs on :4001 during the migration; takes over
:4000 once parity is verified (docs/todo.md PR 7).
"""

import os

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

# CORS. Any explicit allowlist (CORS_ORIGINS env) is honoured, but we ALSO always
# allow our own Vercel apps (production + preview deploys) and *.sandeepp.in plus
# localhost via a regex — so a new preview URL or the admin panel never breaks
# just because it wasn't added to the env var. Override the regex with
# CORS_ORIGIN_REGEX. Credentials work with a regex (the matched origin is echoed).
_origins = cors_origins()
_default_regex = r"https://([a-z0-9-]+\.)*(vercel\.app|sandeepp\.in)|http://localhost:\d+"
_origin_regex = os.environ.get("CORS_ORIGIN_REGEX", _default_regex)
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_origin_regex=_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=_origin_regex,
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
