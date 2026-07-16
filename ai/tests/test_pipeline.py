"""Engine verdict tests — run every committed fixture through the pipeline
and assert the verdict matches its groundTruth. This is the eval set as a
regression gate (issue #20 / #15): if a rule change flips a verdict, CI fails.
"""

import json
from pathlib import Path

import pytest

from app.pipeline.engine import run_pipeline
from app.schemas import ClaimPacket, Verdict

FIXTURES = sorted((Path(__file__).parent / "fixtures").glob("*.json"))


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_fixture_verdict(path: Path):
    raw = json.loads(path.read_text())
    expected = raw["groundTruth"]["verdict"]
    decision = run_pipeline(ClaimPacket(**raw))
    assert decision.verdict.value == expected, (
        f"{path.name}: expected {expected}, got {decision.verdict.value} "
        f"({decision.rationale})"
    )


def test_all_verdicts_covered():
    """The fixture set must exercise every verdict, else it is a weak gate."""
    verdicts = set()
    for path in FIXTURES:
        raw = json.loads(path.read_text())
        verdicts.add(raw["groundTruth"]["verdict"])
    assert {"APPROVE", "DENY", "QUERY"} <= verdicts


def _load(name: str) -> ClaimPacket:
    raw = json.loads((Path(__file__).parent / "fixtures" / name).read_text())
    return ClaimPacket(**raw)


def test_approve_has_payable_amount():
    d = run_pipeline(_load("clean-approve.json"))
    assert d.verdict is Verdict.APPROVE
    assert d.approvedAmountPaise is not None
    assert d.approvedAmountPaise > 0


def test_deny_pays_zero():
    d = run_pipeline(_load("exclusion-deny.json"))
    assert d.verdict is Verdict.DENY
    assert d.approvedAmountPaise == 0


def test_query_leaves_amount_unset():
    d = run_pipeline(_load("los-anomaly-query.json"))
    assert d.verdict is Verdict.QUERY
    assert d.approvedAmountPaise is None
