"""Port of src/catalog — insurer picker + insurer-owned policies/patients."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import models as m
from ..common import iso
from ..db import get_db
from ..deps import require_roles

router = APIRouter(tags=["catalog"])

AnyRole = Depends(
    require_roles(
        m.Role.HOSPITAL_ADMIN,
        m.Role.HOSPITAL_STAFF,
        m.Role.PLATFORM_ADMIN,
        m.Role.INSURER_ADMIN,
        m.Role.INSURER_ADJUDICATOR,
    )
)
InsurerRoles = Depends(require_roles(m.Role.INSURER_ADMIN, m.Role.INSURER_ADJUDICATOR))


@router.get("/catalog/insurers")
async def insurers(user: dict = AnyRole, db: AsyncSession = Depends(get_db)):
    """Insurers + their primary policy — drives the hospital's claim form."""
    rows = (
        (
            await db.execute(
                select(m.Tenant)
                .where(m.Tenant.type == m.TenantType.INSURER)
                .order_by(m.Tenant.name.asc())
            )
        )
        .scalars()
        .all()
    )
    out = []
    for i in rows:
        p = (
            await db.execute(
                select(m.Policy)
                .where(m.Policy.insurerTenantId == i.id)
                .order_by(m.Policy.createdAt.asc())
                .limit(1)
            )
        ).scalar_one_or_none()
        out.append(
            {
                "id": i.id,
                "name": i.name,
                "policy": (
                    {
                        "name": p.name,
                        "planCode": p.planCode,
                        "sumInsuredPaise": p.sumInsuredPaise,
                        "roomRentCapPerDayPaise": p.roomRentCapPerDayPaise,
                        "copayPct": p.copayPct,
                        "coveredProcedures": p.coveredProcedures,
                        "exclusions": p.exclusions,
                    }
                    if p
                    else None
                ),
            }
        )
    return out


@router.get("/insurer/policies")
async def policies(user: dict = InsurerRoles, db: AsyncSession = Depends(get_db)):
    """An insurer's own policies (full rows + patient/claim counts)."""
    tenant_id = user.get("tenantId")
    if not tenant_id:
        raise HTTPException(400, "No insurer on token")
    rows = (
        await db.execute(
            select(
                m.Policy,
                select(func.count())
                .select_from(m.Patient)
                .where(m.Patient.policyId == m.Policy.id)
                .scalar_subquery(),
                select(func.count())
                .select_from(m.Claim)
                .where(m.Claim.policyId == m.Policy.id)
                .scalar_subquery(),
            )
            .where(m.Policy.insurerTenantId == tenant_id)
            .order_by(m.Policy.createdAt.asc())
        )
    ).all()
    return [
        {
            "id": p.id,
            "insurerTenantId": p.insurerTenantId,
            "name": p.name,
            "planCode": p.planCode,
            "sumInsuredPaise": p.sumInsuredPaise,
            "roomRentCapPerDayPaise": p.roomRentCapPerDayPaise,
            "copayPct": p.copayPct,
            "waitingPeriodDays": p.waitingPeriodDays,
            "coveredProcedures": p.coveredProcedures,
            "exclusions": p.exclusions,
            "createdAt": iso(p.createdAt),
            "_count": {"patients": n_pat, "claims": n_clm},
        }
        for p, n_pat, n_clm in rows
    ]


@router.get("/insurer/patients")
async def patients(user: dict = InsurerRoles, db: AsyncSession = Depends(get_db)):
    """An insurer's own policyholders (full rows + policy name + claim count)."""
    tenant_id = user.get("tenantId")
    if not tenant_id:
        raise HTTPException(400, "No insurer on token")
    rows = (
        await db.execute(
            select(
                m.Patient,
                select(func.count())
                .select_from(m.Claim)
                .where(m.Claim.patientId == m.Patient.id)
                .scalar_subquery(),
            )
            .where(m.Patient.insurerTenantId == tenant_id)
            .order_by(m.Patient.createdAt.desc())
            .options(selectinload(m.Patient.policy))
        )
    ).all()
    return [
        {
            "id": p.id,
            "insurerTenantId": p.insurerTenantId,
            "policyId": p.policyId,
            "memberId": p.memberId,
            "name": p.name,
            "age": p.age,
            "gender": p.gender,
            "phone": p.phone,
            "createdAt": iso(p.createdAt),
            "policy": {"name": p.policy.name} if p.policy else None,
            "_count": {"claims": n},
        }
        for p, n in rows
    ]
