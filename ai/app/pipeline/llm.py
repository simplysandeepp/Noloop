"""Optional LLM layer — powered by Groq (free tier, very fast).

The engine is fully deterministic without an API key: every verdict, amount and
fraud flag comes from rules (see coverage/validate/adjudicate). When GROQ_API_KEY
is set, we additionally ask a Groq-hosted model to rewrite the rationale into
clear, patient-friendly language. Failures are swallowed — the rule-based
rationale is always a safe fallback, so the demo never breaks.

Groq exposes an OpenAI-compatible chat API; we use the official `groq` SDK.
Default model: llama-3.3-70b-versatile (fast + capable on the free tier).
"""

from __future__ import annotations

import os

from ..schemas import ClaimPacket, CoverageResult, Decision, FraudFlag

MODEL = os.environ.get("NOLOOP_LLM_MODEL", "llama-3.3-70b-versatile")


def llm_enabled() -> bool:
    return bool(os.environ.get("GROQ_API_KEY"))


def enrich_rationale(
    packet: ClaimPacket,
    coverage: CoverageResult,
    flags: list[FraudFlag],
    decision: Decision,
) -> Decision:
    """Rewrite the rationale with Groq if available; otherwise no-op."""
    if not llm_enabled():
        return decision

    try:
        from groq import Groq  # imported lazily — optional dependency

        client = Groq()  # reads GROQ_API_KEY from the environment
        flag_lines = (
            "\n".join(
                f"- {f.signal.value} ({f.severity.value}): {f.detail}" for f in flags
            )
            or "- none"
        )
        prompt = (
            "You are a health-insurance claims adjudicator writing the rationale a "
            "hospital and patient will read. Be precise, neutral, and concise (2-3 "
            "sentences). Do NOT change the verdict or the approved amount — only "
            "explain them clearly.\n\n"
            f"Verdict: {decision.verdict.value}\n"
            f"Approved amount (paise): {decision.approvedAmountPaise}\n"
            f"Procedure: {packet.admission.procedure}\n"
            f"Coverage: {coverage.reason}\n"
            f"Fraud/anomaly signals:\n{flag_lines}\n\n"
            "Write only the rationale text."
        )
        resp = client.chat.completions.create(
            model=MODEL,
            max_tokens=300,
            temperature=0.2,
            messages=[{"role": "user", "content": prompt}],
        )
        text = (resp.choices[0].message.content or "").strip()
        if text:
            decision.rationale = text
            decision.model = f"groq:{MODEL}"
    except Exception:
        # Any failure (no network, bad key, rate limit) → keep the rule rationale.
        pass

    return decision
