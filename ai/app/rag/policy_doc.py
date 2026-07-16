"""Synthesize a policy-wording *document* from the structured policy fields.

Real deployments ingest the actual policy PDF (see ingest.py). But even with
only the structured policy (covered list, exclusions, caps) we render a
clause-tagged wording document so retrieval always has genuine text to cite —
``citedClauseRefs`` become real clause references instead of the crude
["EXCLUSIONS"] literal the rule engine emitted. When a real document has been
ingested for the policy it takes precedence; this is the always-available floor.
"""

from __future__ import annotations


def synthesize_policy_document(policy: dict) -> str:
    """policy: dict with sumInsuredPaise, roomRentCapPerDayPaise, copayPct,
    coveredProcedures, exclusions. Returns a Markdown wording document.
    """
    si = policy.get("sumInsuredPaise")
    room = policy.get("roomRentCapPerDayPaise")
    copay = policy.get("copayPct") or 0
    covered = policy.get("coveredProcedures") or []
    exclusions = policy.get("exclusions") or []

    lines: list[str] = ["# Policy Wording", ""]

    lines += ["## Covered Procedures", ""]
    if covered:
        lines.append(
            "The following procedures are covered under this policy and are "
            "eligible for reimbursement subject to the terms below:"
        )
        lines += [f"- {p}" for p in covered]
    else:
        lines.append("No specific procedures are enumerated as covered.")
    lines.append("")

    lines += ["## Exclusions", ""]
    if exclusions:
        lines.append(
            "The following procedures are permanently excluded and are not "
            "covered or payable under any circumstances:"
        )
        lines += [f"- {p}" for p in exclusions]
    else:
        lines.append("No specific procedures are excluded.")
    lines.append("")

    if si is not None:
        lines += [
            "## Sum Insured",
            "",
            f"The maximum aggregate amount payable under this policy is "
            f"₹{si / 100:,.0f}. Amounts billed above the sum insured are the "
            f"insured's liability.",
            "",
        ]
    if room:
        lines += [
            "## Room Rent Limit",
            "",
            f"Room rent is capped at ₹{room / 100:,.0f} per day. Charges above "
            f"this per-day ceiling are borne by the insured.",
            "",
        ]
    if copay:
        lines += [
            "## Co Payment",
            "",
            f"A mandatory co-payment of {copay}% of the admissible amount "
            f"applies to every claim under this policy.",
            "",
        ]
    return "\n".join(lines)
