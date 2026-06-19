"""NoLoop AI adjudication engine — FastAPI service.

POST /adjudicate  → run a claim packet through the pipeline, return a Decision.
GET  /health      → liveness.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .schemas import ClaimPacket, Decision
from .pipeline.engine import run_pipeline

app = FastAPI(title="NoLoop AI Engine", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "ai-engine"}


@app.post("/adjudicate", response_model=Decision)
def adjudicate_claim(packet: ClaimPacket) -> Decision:
    return run_pipeline(packet)
