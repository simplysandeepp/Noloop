"""NoLoop AI adjudication engine — FastAPI service.

POST /adjudicate  → run a claim packet through the pipeline, return a Decision.
GET  /health      → liveness.
"""

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .schemas import ClaimPacket, Decision, ExtractRequest, ExtractResult
from .pipeline.engine import run_pipeline
from .extract import extract_document

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


@app.post("/extract", response_model=ExtractResult)
def extract_claim_document(req: ExtractRequest) -> ExtractResult:
    return extract_document(req)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
