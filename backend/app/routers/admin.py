"""Port of src/admin — every route requires a logged-in PLATFORM_ADMIN."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .. import cache
from .. import models as m
from ..common import iso, log_activity, to_compact, to_dotted, unique_email
from ..db import get_db
from ..deps import require_roles
from ..security import gen_password, hash_password

router = APIRouter(prefix="/admin", tags=["admin"])

PlatformAdmin = Depends(require_roles(m.Role.PLATFORM_ADMIN))

OrgRole = Literal[
    "HOSPITAL_ADMIN", "INSURER_ADMIN", "HOSPITAL_STAFF", "INSURER_ADJUDICATOR"
]


class CreateOrgIn(BaseModel):
    type: Literal["HOSPITAL", "INSURER"]
    name: str = Field(min_length=2)
    adminName: str = Field(min_length=2)
    password: str | None = Field(default=None, min_length=8)


class AdminCreateUserIn(BaseModel):
    tenantId: str
    name: str = Field(min_length=2)
    role: OrgRole | None = None
    password: str | None = Field(default=None, min_length=8)


class UpdateUserIn(BaseModel):
    name: str | None = Field(default=None, min_length=2)
    role: OrgRole | None = None


class ResetPasswordIn(BaseModel):
    password: str | None = Field(default=None, min_length=8)


def _admin_role_for(t: m.TenantType) -> m.Role:
    return m.Role.HOSPITAL_ADMIN if t == m.TenantType.HOSPITAL else m.Role.INSURER_ADMIN


def _staff_role_for(t: m.TenantType) -> m.Role:
    return (
        m.Role.HOSPITAL_STAFF
        if t == m.TenantType.HOSPITAL
        else m.Role.INSURER_ADJUDICATOR
    )


def _user_row(u: m.User) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "role": u.role.value,
        "status": u.status.value,
    }


async def _must_exist(db: AsyncSession, user_id: str) -> m.User:
    user = await db.get(m.User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return user


async def _count(db: AsyncSession, model, *where) -> int:
    q = select(func.count()).select_from(model)
    if where:
        q = q.where(*where)
    return (await db.execute(q)).scalar()


# ── dashboard reads ──────────────────────────────────────


@router.get("/stats")
async def stats(user: dict = PlatformAdmin, db: AsyncSession = Depends(get_db)):
    # TTL-only cache (30s): 6 COUNT()s per hit; being a few seconds stale on a
    # dashboard is fine, so no explicit invalidation. Stampede-protected.
    async def _load():
        return {
            "orgs": await _count(db, m.Tenant),
            "hospitals": await _count(db, m.Tenant, m.Tenant.type == m.TenantType.HOSPITAL),
            "insurers": await _count(db, m.Tenant, m.Tenant.type == m.TenantType.INSURER),
            "users": await _count(db, m.User),
            "claims": await _count(db, m.Claim),
            "logs": await _count(db, m.ActivityLog),
        }

    return await cache.cached_json(cache.key("admin", "stats"), 30, _load)


@router.get("/orgs")
async def orgs(user: dict = PlatformAdmin, db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(m.Tenant, func.count(m.User.id))
            .outerjoin(m.User, m.User.tenantId == m.Tenant.id)
            .group_by(m.Tenant.id)
            .order_by(m.Tenant.createdAt.desc())
        )
    ).all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "type": t.type.value,
            "createdAt": iso(t.createdAt),
            "employeeCount": n,
        }
        for t, n in rows
    ]


@router.get("/orgs/{org_id}")
async def org(
    org_id: str, user: dict = PlatformAdmin, db: AsyncSession = Depends(get_db)
):
    tenant = (
        await db.execute(
            select(m.Tenant)
            .where(m.Tenant.id == org_id)
            .options(selectinload(m.Tenant.users))
        )
    ).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404, "Organization not found")
    users = sorted(tenant.users, key=lambda u: u.createdAt, reverse=True)
    return {
        "id": tenant.id,
        "type": tenant.type.value,
        "name": tenant.name,
        "createdAt": iso(tenant.createdAt),
        "users": [
            {**_user_row(u), "createdAt": iso(u.createdAt)} for u in users
        ],
    }


@router.get("/users")
async def users(user: dict = PlatformAdmin, db: AsyncSession = Depends(get_db)):
    """Every user across the platform — the god-mode roster."""
    rows = (
        (
            await db.execute(
                select(m.User)
                .options(selectinload(m.User.tenant))
                .order_by(m.User.createdAt.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            **_user_row(u),
            "createdAt": iso(u.createdAt),
            "tenant": (
                {"id": u.tenant.id, "name": u.tenant.name, "type": u.tenant.type.value}
                if u.tenant
                else None
            ),
        }
        for u in rows
    ]


@router.get("/logs")
async def logs(
    limit: int = Query(default=100),
    user: dict = PlatformAdmin,
    db: AsyncSession = Depends(get_db),
):
    take = min(max(limit, 1), 500)
    rows = (
        (
            await db.execute(
                select(m.ActivityLog)
                .options(
                    selectinload(m.ActivityLog.tenant),
                    selectinload(m.ActivityLog.actor),
                )
                .order_by(m.ActivityLog.createdAt.desc())
                .limit(take)
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": r.id,
            "tenantId": r.tenantId,
            "actorId": r.actorId,
            "action": r.action,
            "detail": r.detail,
            "metadata": r.metadata_,
            "createdAt": iso(r.createdAt),
            "tenant": (
                {"name": r.tenant.name, "type": r.tenant.type.value}
                if r.tenant
                else None
            ),
            "actor": (
                {"name": r.actor.name, "email": r.actor.email} if r.actor else None
            ),
        }
        for r in rows
    ]


# ── org mutations ────────────────────────────────────────


@router.post("/orgs")
async def create_org(
    dto: CreateOrgIn, user: dict = PlatformAdmin, db: AsyncSession = Depends(get_db)
):
    """Create an org + its first admin. Returns the login credentials once."""
    org_type = m.TenantType(dto.type)
    email = await unique_email(db, to_dotted(dto.name))
    temp_password = dto.password or gen_password()

    tenant = m.Tenant(name=dto.name, type=org_type)
    db.add(tenant)
    await db.flush()
    admin = m.User(
        email=email,
        name=dto.adminName,
        passwordHash=hash_password(temp_password),
        role=_admin_role_for(org_type),
        tenantId=tenant.id,
    )
    db.add(admin)
    await db.flush()
    log_activity(
        db,
        tenant_id=tenant.id,
        actor_id=user["sub"],
        action="ORG_CREATED",
        detail=f'{org_type.value} "{dto.name}" created by platform admin',
    )
    await db.commit()
    return {
        "tenant": {"id": tenant.id, "name": tenant.name, "type": tenant.type.value},
        "credentials": {
            "email": admin.email,
            "password": temp_password,
            "role": admin.role.value,
        },
    }


@router.delete("/orgs/{org_id}")
async def delete_org(
    org_id: str, user: dict = PlatformAdmin, db: AsyncSession = Depends(get_db)
):
    """Delete an org and everything that belongs to it."""
    tenant = await db.get(m.Tenant, org_id)
    if not tenant:
        raise HTTPException(404, "Organization not found")
    name = tenant.name

    user_ids = (
        (await db.execute(select(m.User.id).where(m.User.tenantId == org_id)))
        .scalars()
        .all()
    )

    await db.execute(
        delete(m.Claim).where(
            or_(m.Claim.hospitalTenantId == org_id, m.Claim.insurerTenantId == org_id)
        )
    )
    if user_ids:
        await db.execute(
            update(m.ClaimEvent)
            .where(m.ClaimEvent.actorId.in_(user_ids))
            .values(actorId=None)
        )
    await db.execute(delete(m.Admission).where(m.Admission.hospitalTenantId == org_id))
    await db.execute(delete(m.Bed).where(m.Bed.hospitalTenantId == org_id))
    await db.execute(delete(m.Ward).where(m.Ward.hospitalTenantId == org_id))
    await db.execute(delete(m.Patient).where(m.Patient.insurerTenantId == org_id))
    await db.execute(delete(m.Policy).where(m.Policy.insurerTenantId == org_id))
    log_filter = [m.ActivityLog.tenantId == org_id]
    if user_ids:
        log_filter.append(m.ActivityLog.actorId.in_(user_ids))
    await db.execute(delete(m.ActivityLog).where(or_(*log_filter)))
    await db.execute(delete(m.User).where(m.User.tenantId == org_id))
    await db.execute(delete(m.Tenant).where(m.Tenant.id == org_id))
    await db.commit()
    return {"deleted": True, "id": org_id, "name": name}


# ── user mutations ───────────────────────────────────────


@router.post("/users")
async def create_user(
    dto: AdminCreateUserIn,
    user: dict = PlatformAdmin,
    db: AsyncSession = Depends(get_db),
):
    """Create an employee in any org. Returns credentials once."""
    tenant = await db.get(m.Tenant, dto.tenantId)
    if not tenant:
        raise HTTPException(400, "Organization not found")

    role = m.Role(dto.role) if dto.role else _staff_role_for(tenant.type)
    local_base = f"{to_compact(dto.name)}.{to_compact(tenant.name)}"
    email = await unique_email(db, local_base)
    temp_password = dto.password or gen_password()

    row = m.User(
        email=email,
        name=dto.name,
        passwordHash=hash_password(temp_password),
        role=role,
        tenantId=tenant.id,
    )
    db.add(row)
    await db.flush()
    log_activity(
        db,
        tenant_id=tenant.id,
        actor_id=user["sub"],
        action="EMPLOYEE_CREATED",
        detail=f"{row.name} <{row.email}> ({role.value}) created by platform admin",
    )
    await db.commit()
    return {
        "user": {"id": row.id, "name": row.name, "role": row.role.value},
        "credentials": {
            "email": row.email,
            "password": temp_password,
            "role": row.role.value,
        },
    }


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    dto: UpdateUserIn,
    user: dict = PlatformAdmin,
    db: AsyncSession = Depends(get_db),
):
    row = await _must_exist(db, user_id)
    if dto.name:
        row.name = dto.name
    if dto.role:
        row.role = m.Role(dto.role)
    await db.commit()
    return _user_row(row)


@router.post("/users/{user_id}/reset-password")
async def reset_password(
    user_id: str,
    dto: ResetPasswordIn,
    user: dict = PlatformAdmin,
    db: AsyncSession = Depends(get_db),
):
    row = await _must_exist(db, user_id)
    temp_password = dto.password or gen_password()
    row.passwordHash = hash_password(temp_password)
    await db.commit()
    return {"credentials": {"email": row.email, "password": temp_password}}


@router.post("/users/{user_id}/revoke")
async def revoke(
    user_id: str, user: dict = PlatformAdmin, db: AsyncSession = Depends(get_db)
):
    row = await _must_exist(db, user_id)
    row.status = m.UserStatus.REVOKED
    await db.commit()
    return _user_row(row)


@router.post("/users/{user_id}/restore")
async def restore(
    user_id: str, user: dict = PlatformAdmin, db: AsyncSession = Depends(get_db)
):
    row = await _must_exist(db, user_id)
    row.status = m.UserStatus.ACTIVE
    await db.commit()
    return _user_row(row)


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str, user: dict = PlatformAdmin, db: AsyncSession = Depends(get_db)
):
    row = await _must_exist(db, user_id)
    email = row.email
    await db.execute(
        update(m.ClaimEvent).where(m.ClaimEvent.actorId == user_id).values(actorId=None)
    )
    await db.execute(
        update(m.Claim)
        .where(m.Claim.submittedById == user_id)
        .values(submittedById=None)
    )
    await db.execute(
        update(m.Claim)
        .where(m.Claim.overriddenById == user_id)
        .values(overriddenById=None)
    )
    await db.execute(
        update(m.ActivityLog)
        .where(m.ActivityLog.actorId == user_id)
        .values(actorId=None)
    )
    await db.delete(row)
    await db.commit()
    return {"deleted": True, "id": user_id, "email": email}
