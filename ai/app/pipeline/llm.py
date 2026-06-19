"""Optional LLM layer (Claude).

The engine is fully deterministic without an API key — every verdict, amount,
and fraud flag comes from rules. When ANTHROPIC_API_KEY is set, we additionally
ask Claude to rewrite the rationale into clear, patient-friendly language and to
sanity-check the decision. Failures are swallowed: the rule-based rationale is
always a safe fallback, so the demo never breaks.
"""

from __future__ import annotations

import os

from ..schemas import ClaimPacket, CoverageResult, Decision, FraudFlag

MODEL = os.environ.get("NOLOOP_LLM_MODEL", "claude-haiku-4-5-20251001")


def llm_enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def enrich_rationale(
    packet: ClaimPacket,
    coverage: CoverageResult,
    flags: list[FraudFlag],
    decision: Decision,
) -> Decision:
    """Rewrite the rationale with Claude if available; otherwise no-op."""
    if not llm_enabled():
        return decision

    try:
        from anthropic import Anthropic  # imported lazily — optional dependency

        client = Anthropic()
        flag_lines = "\n".join(f"- {f.signal.value} ({f.severity.value}): {f.detail}" for f in flags) or "- none"
        prompt = (
            "You are a health-insurance claims adjudicator writing the rationale a "
            "hospital and patient will read. Be precise, neutral, and concise (2-3 sentences). "
            "Do NOT change the verdict or the approved amount — only explain them clearly.\n\n"
            f"Verdict: {decision.verdict.value}\n"
            f"Approved amount (paise): {decision.approvedAmountPaise}\n"
            f"Procedure: {packet.admission.procedure}\n"
            f"Coverage: {coverage.reason}\n"
            f"Fraud/anomaly signals:\n{flag_lines}\n\n"
            "Write only the rationale text."
        )
        resp = client.messages.create(
            model=MODEL,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(block.text for block in resp.content if block.type == "text").strip()
        if text:
            decision.rationale = text
            decision.model = MODEL
    except Exception:
        # Any failure (no network, bad key, rate limit) → keep the rule rationale.
        pass

    return decision
