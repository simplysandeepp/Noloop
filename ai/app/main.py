"""NoLoop AI adjudication engine — FastAPI service.

POST /adjudicate    → run a claim packet through the pipeline, return a Decision.
POST /extract       → OCR a claim document (Groq vision) into structured fields.
POST /rag/coverage  → citation-grounded coverage answer for a procedure+policy.
GET  /health        → liveness.
"""

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .extract import extract_document
from .pipeline.engine import run_pipeline
from .rag import coverage_for_policy
from .schemas import (
    ClaimPacket,
    CoverageAnswer,
    CoverageQuery,
    Decision,
    ExtractRequest,
    ExtractResult,
)

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


@app.post("/rag/coverage", response_model=CoverageAnswer)
def rag_coverage(query: CoverageQuery) -> CoverageAnswer:
    """Retrieve policy clauses and answer coverage strictly from them, with
    citations and a low-confidence refusal path. Handy for demos and debugging
    the RAG layer that the adjudication pipeline uses internally."""
    rc = coverage_for_policy(query.procedure, query.policy.model_dump())
    return CoverageAnswer(
        decision=rc.decision,
        covered=rc.covered,
        reason=rc.reason,
        citedClauseRefs=rc.cited_refs,
        confidence=rc.confidence,
        grounded=rc.grounded,
        method=rc.method,
        evidence=[
            {"ref": e.ref, "heading": e.heading, "snippet": e.snippet, "score": e.score}
            for e in rc.evidence
        ],
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
