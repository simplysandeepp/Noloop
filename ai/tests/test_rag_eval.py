"""RAG eval as a CI gate — retrieval quality + grounded coverage accuracy over
the fixture policy document. Thresholds are intentionally strict for the
hashing-embedder + BM25 default so a regression in chunking, fusion, or the
coverage heuristic fails the build.
"""

from pathlib import Path

from scripts.eval_rag import evaluate

EVAL = Path(__file__).parent / "rag_fixtures" / "eval.json"


def test_rag_eval_thresholds():
    m = evaluate(EVAL)
    assert m["recall_at_k"] >= 0.9, m
    assert m["mrr"] >= 0.75, m
    assert m["coverage_accuracy"] >= 0.9, m
    assert not m["misses"] or m["coverage_accuracy"] >= 0.9
