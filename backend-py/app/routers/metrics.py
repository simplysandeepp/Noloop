"""Port of src/metrics — the role-scoped analytics summary."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import models as m
from ..common import iso, js_round
from ..db import get_db
from ..deps import require_roles

router = APIRouter(prefix="/metrics", tags=["metrics"])

AnyRole = Depends(
    require_roles(
        m.Role.HOSPITAL_ADMIN,
        m.Role.HOSPITAL_STAFF,
        m.Role.INSURER_ADMIN,
        m.Role.INSURER_ADJUDICATOR,
        m.Role.PLATFORM_ADMIN,
    )
)


def _pct(n: int, d: int) -> int:
    return js_round(n / d * 100) if d else 0


@router.get("")
async def summary(user: dict = AnyRole, db: AsyncSession = Depends(get_db)):
    role, tenant_id = user.get("role"), user.get("tenantId")
    if role in ("HOSPITAL_ADMIN", "HOSPITAL_STAFF"):
        where = [m.Claim.hospitalTenantId == (tenant_id or "__none__")]
        label, hospital_id = "HOSPITAL", tenant_id
    elif role in ("INSURER_ADMIN", "INSURER_ADJUDICATOR"):
        where = [m.Claim.insurerTenantId == (tenant_id or "__none__")]
        label, hospital_id = "INSURER", None
    else:
        where, label, hospital_id = [], "PLATFORM", None

    claims = (
        (
            await db.execute(
                select(m.Claim)
                .where(*where)
                .order_by(m.Claim.submittedAt.desc())
                .options(selectinload(m.Claim.fraudFlags))
            )
        )
        .scalars()
        .all()
    )

    total = len(claims)
    decided = [c for c in claims if c.verdict is not None]

    def count(s: m.ClaimStatus) -> int:
        return sum(1 for c in claims if c.status == s)

    approved = sum(1 for c in claims if c.verdict == m.Verdict.APPROVE)
    denied = sum(1 for c in claims if c.verdict == m.Verdict.DENY)
    queried = sum(1 for c in claims if c.verdict == m.Verdict.QUERY)
    flagged = sum(1 for c in claims if c.fraudFlags)
    auto = sum(1 for c in decided if not c.overriddenById)

    tats = [c.tatSeconds for c in decided if isinstance(c.tatSeconds, int)]
    avg_tat = js_round(sum(tats) / len(tats)) if tats else 0

    billed_paise = sum(c.billedPaise for c in claims)
    approved_paise = sum(
        c.approvedAmountPaise or 0
        for c in claims
        if c.status in (m.ClaimStatus.APPROVED, m.ClaimStatus.SETTLED)
    )
    # Money the engine protected: billed minus approved on every decided claim.
    saved_paise = sum(
        max(0, c.billedPaise - (c.approvedAmountPaise or 0)) for c in decided
    )

    signal_counts: dict[str, int] = {}
    for c in claims:
        for f in c.fraudFlags:
            signal_counts[f.signal] = signal_counts.get(f.signal, 0) + 1
    top_signals = sorted(
        ({"signal": s, "count": n} for s, n in signal_counts.items()),
        key=lambda x: -x["count"],
    )

    # 7-day trend (oldest → newest), UTC days like JS toISOString().
    today = datetime.now(timezone.utc)
    trend = []
    for i in range(6, -1, -1):
        key = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        day = [c for c in claims if c.submittedAt.strftime("%Y-%m-%d") == key]
        trend.append(
            {
                "date": key,
                "count": len(day),
                "approvedPaise": sum(c.approvedAmountPaise or 0 for c in day),
            }
        )

    result: dict = {
        "scope": label,
        "totals": {
            "claims": total,
            "decided": len(decided),
            "processing": count(m.ClaimStatus.PROCESSING),
            "approved": count(m.ClaimStatus.APPROVED),
            "denied": count(m.ClaimStatus.DENIED),
            "queried": count(m.ClaimStatus.QUERIED),
            "underReview": count(m.ClaimStatus.UNDER_REVIEW),
            "settled": count(m.ClaimStatus.SETTLED),
        },
        "rates": {
            "approvalPct": _pct(approved, len(decided)),
            "denialPct": _pct(denied, len(decided)),
            "queryPct": _pct(queried, len(decided)),
            "autoDecisionPct": _pct(auto, len(decided)),
            "fraudPct": _pct(flagged, total),
        },
        "tat": {
            "avgSeconds": avg_tat,
            "fastestSeconds": min(tats) if tats else 0,
            "slowestSeconds": max(tats) if tats else 0,
        },
        "money": {
            "billedPaise": billed_paise,
            "approvedPaise": approved_paise,
            "savedPaise": saved_paise,
        },
        "fraud": {
            "totalFlags": sum(signal_counts.values()),
            "flaggedClaims": flagged,
            "topSignals": top_signals,
        },
        "trend": trend,
        "recent": [
            {
                "claimNumber": c.claimNumber,
                "patientName": c.patientName,
                "procedure": c.procedure,
                "status": c.status.value,
                "verdict": c.verdict.value if c.verdict else None,
                "billedPaise": c.billedPaise,
                "approvedAmountPaise": c.approvedAmountPaise,
                "tatSeconds": c.tatSeconds,
                "flagCount": len(c.fraudFlags),
                "submittedAt": iso(c.submittedAt),
            }
            for c in claims[:8]
        ],
    }

    if label == "HOSPITAL" and hospital_id:
        async def bed_count(*extra) -> int:
            q = (
                select(func.count())
                .select_from(m.Bed)
                .where(m.Bed.hospitalTenantId == hospital_id, *extra)
            )
            return (await db.execute(q)).scalar()

        total_beds = await bed_count()
        occupied = await bed_count(m.Bed.status == m.BedStatus.OCCUPIED)
        maintenance = await bed_count(m.Bed.status == m.BedStatus.MAINTENANCE)
        result["beds"] = {
            "totalBeds": total_beds,
            "occupied": occupied,
            "available": total_beds - occupied - maintenance,
            "occupancyRate": js_round(occupied / total_beds * 100) if total_beds else 0,
        }

    return result
