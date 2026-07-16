"""RAG eval harness — retrieval quality + coverage decision accuracy.

Runs the eval set (question → ground-truth clause ref / coverage decision)
against the in-memory hybrid retriever over a policy document and reports
Recall@k, MRR, and grounded-coverage accuracy. Run it on every RAG change:

    python -m scripts.eval_rag
    python -m scripts.eval_rag /path/to/eval.json

The same thresholds are enforced as a CI gate in tests/test_rag_eval.py.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.rag.chunk import chunk_document  # noqa: E402
from app.rag.config import get_rag_config  # noqa: E402
from app.rag.coverage import assess_coverage  # noqa: E402
from app.rag.embeddings import get_embedder  # noqa: E402
from app.rag.retrieve import retrieve  # noqa: E402
from app.rag.store import InMemoryStore  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "rag_fixtures"


def build_store(doc_path: Path) -> tuple[InMemoryStore, str]:
    cfg = get_rag_config()
    store = InMemoryStore()
    text = doc_path.read_text(encoding="utf-8")
    chunks = chunk_document(text, doc_id=doc_path.stem,
                            max_chunk_chars=cfg.max_chunk_chars,
                            overlap=cfg.chunk_overlap_chars)
    store.add(chunks, get_embedder(cfg), namespace="eval")
    return store, doc_path.stem


def evaluate(eval_path: Path) -> dict:
    spec = json.loads(eval_path.read_text())
    doc_path = FIXTURES / spec["doc"]
    store, _ = build_store(doc_path)

    n_ret = n_hit = 0
    rr_sum = 0.0
    n_dec = n_dec_ok = 0
    misses: list[str] = []

    for case in spec["cases"]:
        q = case["q"]
        if case.get("ref"):
            n_ret += 1
            result = retrieve(q, store, namespace="eval")
            refs = [c.ref for c in result.chunks]
            if case["ref"] in refs:
                n_hit += 1
                rr_sum += 1.0 / (refs.index(case["ref"]) + 1)
            else:
                misses.append(f"[retrieval] {q!r}: want {case['ref']}, got {refs[:3]}")

        if case.get("decision"):
            n_dec += 1
            cov = assess_coverage(q, store, namespace="eval")
            if cov.decision == case["decision"]:
                n_dec_ok += 1
            else:
                misses.append(
                    f"[coverage] {q!r}: want {case['decision']}, got {cov.decision}"
                )

    return {
        "recall_at_k": n_hit / n_ret if n_ret else 1.0,
        "mrr": rr_sum / n_ret if n_ret else 1.0,
        "coverage_accuracy": n_dec_ok / n_dec if n_dec else 1.0,
        "n_retrieval": n_ret,
        "n_coverage": n_dec,
        "misses": misses,
    }


def main() -> None:
    eval_path = Path(sys.argv[1]) if len(sys.argv) > 1 else FIXTURES / "eval.json"
    m = evaluate(eval_path)
    print(f"\nRAG eval — {eval_path.name}")
    print(f"  Recall@k         : {m['recall_at_k']:.0%}  ({m['n_retrieval']} queries)")
    print(f"  MRR              : {m['mrr']:.3f}")
    print(f"  Coverage accuracy: {m['coverage_accuracy']:.0%}  ({m['n_coverage']} queries)")
    if m["misses"]:
        print("\n  Misses:")
        for miss in m["misses"]:
            print(f"    {miss}")


if __name__ == "__main__":
    main()
