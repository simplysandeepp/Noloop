"""Eval harness — run the engine over the synthetic claims and score it
against each packet's `groundTruth.verdict`.

Usage (from Noloop/ai, venv active):
    python -m scripts.eval
    python -m scripts.eval /path/to/synthetic/dir
"""

import json
import sys
from collections import Counter
from pathlib import Path

# Allow running as `python -m scripts.eval` from the ai/ root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import ClaimPacket  # noqa: E402
from app.pipeline.engine import run_pipeline  # noqa: E402

DEFAULT_DIR = (
    Path(__file__).resolve().parents[2] / "backend" / "data" / "synthetic"
)


def main() -> None:
    data_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DIR
    files = sorted(data_dir.glob("NLP-*.json"))
    if not files:
        print(f"No synthetic claims in {data_dir}. Run: bun run gen:claims")
        return

    total = correct = 0
    confusion: Counter = Counter()
    misses = []

    for f in files:
        raw = json.loads(f.read_text())
        truth = raw.get("groundTruth", {}).get("verdict")
        decision = run_pipeline(ClaimPacket(**raw))
        pred = decision.verdict.value
        total += 1
        if pred == truth:
            correct += 1
        else:
            misses.append((raw["ref"], truth, pred))
        confusion[f"{truth}->{pred}"] += 1

    print(f"\nEvaluated {total} synthetic claims")
    print(f"Accuracy: {correct}/{total} = {correct/total:.0%}\n")
    print("truth -> predicted:")
    for k, v in sorted(confusion.items()):
        mark = "✅" if k.split("->")[0] == k.split("->")[1] else "❌"
        print(f"  {mark} {k:24} {v}")
    if misses:
        print("\nMisses:")
        for ref, t, p in misses:
            print(f"  {ref}: expected {t}, got {p}")


if __name__ == "__main__":
    main()
