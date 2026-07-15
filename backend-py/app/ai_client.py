"""Bridge to the NoLoop AI adjudication engine (Noloop/ai, FastAPI :8000).

Port of src/ai/ai.service.ts. Primary path: POST the claim packet to the
engine's /adjudicate. Resilience: if the engine is unreachable we fall back
to an in-process rule engine that mirrors the Python pipeline, so the
platform keeps working in a live demo. `model` records which path ran.
"""

import time

import httpx

from .config import get_settings


def inr(paise_over_100: float) -> str:
    """(x).toLocaleString('en-IN') for the amounts we print: Indian digit
    grouping (12,34,567), fraction kept without trailing zeros."""
    n = paise_over_100
    neg = n < 0
    n = abs(n)
    whole = int(n)
    s = str(whole)
    if len(s) > 3:
        head, last3 = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [last3])
    frac = round(n - whole, 3)
    if frac:
        s += ("%.3f" % frac)[1:].rstrip("0").rstrip(".")
    return ("-" if neg else "") + s


async def adjudicate(packet: dict) -> tuple[dict, int]:
    """Adjudicate a packet, returning (decision, latencyMs)."""
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.post(
                f"{get_settings().ai_engine_url}/adjudicate", json=packet
            )
            res.raise_for_status()
            decision = res.json()
    except Exception:
        decision = _fallback(packet)
    return decision, int((time.monotonic() - started) * 1000)


async def extract_document(image_base64: str, mime_type: str) -> dict:
    """OCR a claim document via the engine's Groq-vision /extract endpoint."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{get_settings().ai_engine_url}/extract",
                json={"imageBase64": image_base64, "mimeType": mime_type},
            )
            res.raise_for_status()
            return res.json()
    except Exception:
        return {
            "enabled": False,
            "note": "The AI engine is unreachable — fill the form manually.",
        }


# ──────────────────────────────────────────────────────────
# In-process fallback — faithful to ai/app/pipeline/*.
# ──────────────────────────────────────────────────────────

_TYPICAL_LOS = {
    "appendectomy": 2,
    "cataract surgery": 1,
    "angioplasty": 3,
    "cesarean delivery": 3,
    "knee replacement": 4,
    "dialysis session": 1,
}
_LOS_TOLERANCE = 5
_DEFAULT_LOS = 3


def _fallback(packet: dict) -> dict:
    policy = packet["policy"]
    admission = packet["admission"]
    bill = packet["bill"]
    proc = admission["procedure"].strip().lower()
    excluded = [p.lower() for p in policy["exclusions"]]
    covered = [p.lower() for p in policy["coveredProcedures"]]

    # Coverage
    cited: list[str] = []
    if proc in excluded:
        coverage_covered = False
        coverage_reason = (
            f"'{admission['procedure']}' is listed under policy exclusions."
        )
        cited.append("EXCLUSIONS")
    elif proc in covered:
        coverage_covered = True
        coverage_reason = (
            f"'{admission['procedure']}' is a covered procedure under the policy."
        )
        cited.append("COVERED_PROCEDURES")
    else:
        coverage_covered = False
        coverage_reason = (
            f"'{admission['procedure']}' is not explicitly listed; needs manual review."
        )

    # Validate / fraud flags
    flags: list[dict] = []
    line_sum = sum(li["amountPaise"] for li in bill["lineItems"])
    total = bill["totalPaise"]
    sum_insured = policy["sumInsuredPaise"]
    over_cap_overage = (
        total > sum_insured
        and line_sum <= sum_insured
        and total - line_sum > sum_insured * 0.5
    )
    if line_sum != total and not over_cap_overage:
        flags.append(
            {
                "signal": "BILL_MATH_MISMATCH",
                "severity": "HIGH",
                "detail": f"Line items sum to ₹{inr(line_sum / 100)} but the bill total is ₹{inr(total / 100)}.",
            }
        )
    benchmark = _TYPICAL_LOS.get(proc, _DEFAULT_LOS)
    los = admission["lengthOfStayDays"]
    if los > benchmark + _LOS_TOLERANCE:
        flags.append(
            {
                "signal": "LENGTH_OF_STAY_ANOMALY",
                "severity": "MEDIUM",
                "detail": f"Stay of {los} days far exceeds the ~{benchmark}-day benchmark for {admission['procedure']}.",
            }
        )
    if total > sum_insured and line_sum <= sum_insured:
        flags.append(
            {
                "signal": "AMOUNT_OUTLIER",
                "severity": "MEDIUM",
                "detail": f"Claimed ₹{inr(total / 100)} exceeds the sum insured ₹{inr(sum_insured / 100)}.",
            }
        )
    if (
        admission.get("admittedAt")
        and admission.get("dischargedAt")
        and admission["dischargedAt"] < admission["admittedAt"]
    ):
        flags.append(
            {
                "signal": "DATE_INCONSISTENCY",
                "severity": "HIGH",
                "detail": f"Discharge date {admission['dischargedAt']} is before admission date {admission['admittedAt']}.",
            }
        )
    if not coverage_covered and "EXCLUSIONS" in cited:
        flags.append(
            {"signal": "POLICY_EXCLUSION", "severity": "HIGH", "detail": coverage_reason}
        )

    # Adjudicate
    signals = {f["signal"] for f in flags}
    deny_signals = ["BILL_MATH_MISMATCH", "POLICY_EXCLUSION", "DATE_INCONSISTENCY"]
    query_signals = ["LENGTH_OF_STAY_ANOMALY", "AMOUNT_OUTLIER"]
    reasons = [f["detail"] for f in flags]

    deductions: list[dict] = []
    if any(s in signals for s in deny_signals):
        verdict = "DENY"
        approved: int | None = 0
    elif not coverage_covered:
        verdict = "QUERY"
        approved = None
        reasons.append(coverage_reason)
    elif any(s in signals for s in query_signals):
        verdict = "QUERY"
        approved = None
    else:
        verdict = "APPROVE"
        approved, deductions = _payable(packet)
        if deductions:
            reasons.append(
                "Payable after deductions: "
                + ", ".join(
                    f"{d['label']} (−₹{inr(d['amountPaise'] / 100)})"
                    for d in deductions
                )
                + "."
            )
        reasons.append("Procedure covered, amounts consistent, and stay within norms.")

    head = (
        f"Claim approved for ₹{inr((approved or 0) / 100)}."
        if verdict == "APPROVE"
        else "Claim denied."
        if verdict == "DENY"
        else "Claim held for review."
    )
    rationale = f"{head} {' '.join(reasons) or 'No issues detected.'}"

    return {
        "ref": packet["ref"],
        "verdict": verdict,
        "rationale": rationale,
        "citedClauseRefs": cited,
        "fraudFlags": flags,
        "approvedAmountPaise": approved,
        "deductions": deductions,
        "confidence": 0.6 if verdict == "QUERY" else 0.92,
        "model": "rule-engine-py-fallback",
    }


def _payable(packet: dict) -> tuple[int, list[dict]]:
    deductions: list[dict] = []
    billed = packet["bill"]["totalPaise"]
    sum_insured = packet["policy"]["sumInsuredPaise"]
    gross = billed
    if billed > sum_insured:
        deductions.append(
            {"label": "Exceeds sum insured", "amountPaise": billed - sum_insured}
        )
        gross = sum_insured
    cap = packet["policy"].get("roomRentCapPerDayPaise")
    if cap:
        los = max(1, packet["admission"]["lengthOfStayDays"])
        room_billed = sum(
            li["amountPaise"]
            for li in packet["bill"]["lineItems"]
            if "room" in li["desc"].lower()
        )
        allowed = cap * los
        if room_billed > allowed:
            excess = room_billed - allowed
            deductions.append(
                {
                    "label": f"Room rent above ₹{inr(cap / 100)}/day cap",
                    "amountPaise": excess,
                }
            )
            gross -= excess
    copay = packet["policy"].get("copayPct") or 0
    if copay > 0:
        amt = round(gross * copay / 100)
        deductions.append({"label": f"{copay}% co-pay", "amountPaise": amt})
        gross -= amt
    return max(0, gross), deductions
