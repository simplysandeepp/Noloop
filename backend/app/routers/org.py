"""Port of src/org — org-admin self-service for the org's employees."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from ..common import iso, log_activity, to_compact, unique_email
from ..db import get_db
from ..deps import require_roles
from ..security import hash_password

router = APIRouter(prefix="/org", tags=["org"])

OrgAdmin = Depends(require_roles(m.Role.HOSPITAL_ADMIN, m.Role.INSURER_ADMIN))


class CreateEmployeeIn(BaseModel):
    name: str = Field(min_length=2)
    password: str = Field(min_length=8)


def _staff_role_for(t: m.TenantType) -> m.Role:
    return (
        m.Role.HOSPITAL_STAFF
        if t == m.TenantType.HOSPITAL
        else m.Role.INSURER_ADJUDICATOR
    )


async def _tenant_of(db: AsyncSession, tenant_id: str | None) -> m.Tenant:
    if not tenant_id:
        raise HTTPException(400, "No organization on token")
    tenant = await db.get(m.Tenant, tenant_id)
    if not tenant:
        raise HTTPException(404, "Organization not found")
    return tenant


def _employee(u: m.User) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "role": u.role.value,
        "createdAt": iso(u.createdAt),
    }


@router.get("/overview")
async def overview(user: dict = OrgAdmin, db: AsyncSession = Depends(get_db)):
    """Org header + counts for the portal."""
    tenant = await _tenant_of(db, user.get("tenantId"))
    employee_count = (
        await db.execute(
            select(func.count()).select_from(m.User).where(m.User.tenantId == tenant.id)
        )
    ).scalar()
    # The admin's own login email = the org email.
    admin_email = (
        await db.execute(
            select(m.User.email)
            .where(
                m.User.tenantId == tenant.id,
                m.User.role.in_([m.Role.HOSPITAL_ADMIN, m.Role.INSURER_ADMIN]),
            )
            .order_by(m.User.createdAt.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "type": tenant.type.value,
        "createdAt": iso(tenant.createdAt),
        "orgEmail": admin_email,
        "employeeCount": employee_count,
    }


@router.get("/employees")
async def employees(user: dict = OrgAdmin, db: AsyncSession = Depends(get_db)):
    """All users in the org (admin + staff)."""
    tenant = await _tenant_of(db, user.get("tenantId"))
    rows = (
        (
            await db.execute(
                select(m.User)
                .where(m.User.tenantId == tenant.id)
                .order_by(m.User.createdAt.asc())
            )
        )
        .scalars()
        .all()
    )
    return [_employee(u) for u in rows]


@router.post("/employees")
async def create_employee(
    dto: CreateEmployeeIn, user: dict = OrgAdmin, db: AsyncSession = Depends(get_db)
):
    """Create a staff account under the admin's org. Email is generated:
    "Sachin" under "Acme Hospital" -> sachin.acmehospital@noloop.in."""
    tenant = await _tenant_of(db, user.get("tenantId"))
    local_base = f"{to_compact(dto.name)}.{to_compact(tenant.name)}"
    email = await unique_email(db, local_base)

    row = m.User(
        email=email,
        name=dto.name,
        passwordHash=hash_password(dto.password),
        role=_staff_role_for(tenant.type),
        tenantId=tenant.id,
    )
    db.add(row)
    await db.flush()
    log_activity(
        db,
        tenant_id=tenant.id,
        actor_id=None,
        action="EMPLOYEE_CREATED",
        detail=f"{row.name} <{row.email}>",
    )
    await db.commit()
    return _employee(row)
