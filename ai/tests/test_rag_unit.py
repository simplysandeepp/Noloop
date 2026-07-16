"""Unit tests for the RAG building blocks: chunking, embeddings, BM25/vector
store primitives, hybrid retrieval + RRF, and the anti-hallucination gate.
"""

from app.rag.chunk import chunk_document
from app.rag.coverage import assess_coverage
from app.rag.embeddings import HashingEmbedder, cosine, tokenize
from app.rag.retrieve import retrieve
from app.rag.store import InMemoryStore

DOC = """# Policy

## 2. Covered Procedures
The following procedures are covered: Appendectomy, Cataract Surgery.

## 7. Exclusions
The following are permanently excluded and not payable: Cosmetic Rhinoplasty,
LASIK Eye Surgery.

## 4. Room Rent Limit
Room rent is capped at two thousand rupees per day.
"""


def _store() -> InMemoryStore:
    store = InMemoryStore()
    store.add(chunk_document(DOC, "d1"), HashingEmbedder(256), namespace="ns")
    return store


# ── chunking ──
def test_chunk_assigns_clause_refs():
    chunks = chunk_document(DOC, "d1")
    refs = {c.ref for c in chunks}
    assert "2_COVERED_PROCEDURES" in refs
    assert "7_EXCLUSIONS" in refs


def test_chunk_keeps_heading_in_text():
    chunks = chunk_document(DOC, "d1")
    excl = next(c for c in chunks if c.ref == "7_EXCLUSIONS")
    assert "Exclusions" in excl.text
    assert "excluded" in excl.text.lower()


# ── embeddings ──
def test_hashing_embedder_deterministic_and_normalised():
    e = HashingEmbedder(256)
    v1 = e.embed_one("room rent limit")
    v2 = e.embed_one("room rent limit")
    assert v1 == v2  # deterministic
    assert abs(cosine(v1, v1) - 1.0) < 1e-9  # L2-normalised
    assert len(v1) == 256


def test_similar_text_scores_higher():
    e = HashingEmbedder(256)
    q = e.embed_one("room rent cap per day")
    near = e.embed_one("room rent is capped per day")
    far = e.embed_one("cosmetic surgery exclusion")
    assert cosine(q, near) > cosine(q, far)


def test_tokenize():
    assert tokenize("Room-Rent, ₹2000/day!") == ["room", "rent", "2000", "day"]


# ── store primitives ──
def test_lexical_bm25_ranks_relevant_first():
    store = _store()
    hits = store.lexical("room rent per day", k=3, namespace="ns")
    assert hits
    assert hits[0].chunk.ref == "4_ROOM_RENT_LIMIT"


def test_vector_search_returns_scored():
    store = _store()
    hits = store.vector(HashingEmbedder(256).embed_one("exclusions not payable"),
                        k=3, namespace="ns")
    assert hits
    assert all(-1.0001 <= h.score <= 1.0001 for h in hits)


def test_namespace_isolation():
    store = _store()
    assert store.count("ns") > 0
    assert store.count("other") == 0
    assert store.vector(HashingEmbedder(256).embed_one("x"), 3, "other") == []


# ── hybrid retrieval ──
def test_hybrid_retrieve_fuses_and_scores_confidence():
    store = _store()
    r = retrieve("room rent cap per day", store, namespace="ns")
    assert r.method == "hybrid-rrf"
    assert r.chunks
    assert r.chunks[0].ref == "4_ROOM_RENT_LIMIT"
    assert 0.0 < r.confidence <= 1.0


def test_retrieve_empty_store_zero_confidence():
    r = retrieve("anything", InMemoryStore(), namespace="empty")
    assert r.chunks == []
    assert r.confidence == 0.0


# ── coverage / anti-hallucination ──
def test_coverage_excluded_grounded_citation():
    cov = assess_coverage("Cosmetic Rhinoplasty", _store(), namespace="ns")
    assert cov.decision == "EXCLUDED"
    assert cov.covered is False
    assert cov.grounded
    assert cov.cited_refs == ["7_EXCLUSIONS"]


def test_coverage_covered_grounded_citation():
    cov = assess_coverage("Appendectomy", _store(), namespace="ns")
    assert cov.decision == "COVERED"
    assert cov.covered is True
    assert cov.cited_refs == ["2_COVERED_PROCEDURES"]


def test_coverage_refuses_on_empty_store():
    cov = assess_coverage("Appendectomy", InMemoryStore(), namespace="empty")
    assert cov.decision == "NOT_FOUND"
    assert cov.covered is False
    assert cov.grounded is False


def test_coverage_not_found_for_unlisted_procedure():
    cov = assess_coverage("Liver Transplant", _store(), namespace="ns")
    assert cov.decision == "NOT_FOUND"
    assert cov.covered is False
