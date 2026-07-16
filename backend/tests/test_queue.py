"""Async task queue — the graceful-fallback contract and packet rebuilding.
No Redis/DB needed: we test the disabled path, the enqueue fallback, and that
the worker + shared adjudication modules import cleanly.
"""

from types import SimpleNamespace

import pytest

from app import adjudication, queue


def test_queue_disabled_by_default(monkeypatch):
    monkeypatch.delenv("NOLOOP_USE_QUEUE", raising=False)
    assert queue.queue_enabled() is False


def test_queue_enabled_flag(monkeypatch):
    monkeypatch.setenv("NOLOOP_USE_QUEUE", "1")
    assert queue.queue_enabled() is True
    monkeypatch.setenv("NOLOOP_USE_QUEUE", "false")
    assert queue.queue_enabled() is False


@pytest.mark.asyncio
async def test_enqueue_returns_false_when_disabled(monkeypatch):
    monkeypatch.delenv("NOLOOP_USE_QUEUE", raising=False)
    # Disabled → caller should adjudicate inline.
    assert await queue.enqueue_adjudication("claim-1", "CLM-100001") is False


@pytest.mark.asyncio
async def test_enqueue_falls_back_when_no_redis(monkeypatch):
    monkeypatch.setenv("NOLOOP_USE_QUEUE", "1")
    monkeypatch.delenv("REDIS_URL", raising=False)
    # Enabled but no reachable Redis → fail open to inline (False), never raise.
    assert await queue.enqueue_adjudication("claim-1", "CLM-100001") is False


def test_packet_from_claim_shape():
    from datetime import datetime

    claim = SimpleNamespace(
        claimNumber="CLM-100002",
        type=SimpleNamespace(value="CASHLESS"),
        admittedAt=datetime(2026, 3, 25),
        dischargedAt=datetime(2026, 3, 26),
        lengthOfStayDays=1,
        procedure="Appendectomy",
        diagnosis="Acute appendicitis",
        lineItems=[{"desc": "Appendectomy", "amountPaise": 2000000}],
        billedPaise=2000000,
        patientName="A B",
        patientAge=40,
    )
    policy = SimpleNamespace(
        planCode="POL-1",
        sumInsuredPaise=50000000,
        roomRentCapPerDayPaise=None,
        copayPct=0,
        coveredProcedures=["Appendectomy"],
        exclusions=[],
    )
    hospital = SimpleNamespace(name="Test Hospital")
    insurer = SimpleNamespace(name="Test Insurer")

    packet = adjudication.packet_from_claim(claim, policy, hospital, insurer)
    assert packet["ref"] == "CLM-100002"
    assert packet["admission"]["admittedAt"] == "2026-03-25"
    assert packet["policy"]["coveredProcedures"] == ["Appendectomy"]
    assert packet["bill"]["totalPaise"] == 2000000


def test_worker_imports_without_redis(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    from app import worker

    assert worker.WorkerSettings.functions
    assert worker.WorkerSettings.max_tries == 4
