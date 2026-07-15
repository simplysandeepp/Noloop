"""Port of src/auth — same routes, same {token, user} response shape."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from ..common import log_activity, to_dotted, unique_email
from ..db import get_db
from ..deps import CurrentUser
from ..security import hash_password, sign_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupIn(BaseModel):
    orgName: str = Field(min_length=2)
    orgType: m.TenantType
    adminName: str = Field(min_length=2)
    password: str = Field(min_length=8)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


def _issue(user: m.User) -> dict:
    """JWT + the safe (no password hash) user payload."""
    return {
        "token": sign_token(user.id, user.role.value, user.tenantId),
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role.value,
            "tenantId": user.tenantId,
        },
    }


@router.post("/signup")
async def signup(dto: SignupIn, db: AsyncSession = Depends(get_db)):
    """Create an org (tenant) + its first admin, atomically. The admin's
    email is generated from the org name: "Acme Hospital" ->
    acme.hospital@noloop.in (numeric suffix on collision)."""
    email = await unique_email(db, to_dotted(dto.orgName))
    role = (
        m.Role.HOSPITAL_ADMIN
        if dto.orgType == m.TenantType.HOSPITAL
        else m.Role.INSURER_ADMIN
    )

    tenant = m.Tenant(name=dto.orgName, type=dto.orgType)
    db.add(tenant)
    await db.flush()

    user = m.User(
        email=email,
        name=dto.adminName,
        passwordHash=hash_password(dto.password),
        role=role,
        tenantId=tenant.id,
    )
    db.add(user)
    await db.flush()

    log_activity(
        db,
        tenant_id=tenant.id,
        actor_id=user.id,
        action="ORG_CREATED",
        detail=f'{dto.orgType.value} "{dto.orgName}" created',
    )
    await db.commit()
    return _issue(user)


@router.post("/login")
async def login(dto: LoginIn, db: AsyncSession = Depends(get_db)):
    user = (
        await db.execute(select(m.User).where(m.User.email == dto.email))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Invalid credentials")

    if not verify_password(dto.password, user.passwordHash):
        raise HTTPException(401, "Invalid credentials")

    if user.status == m.UserStatus.REVOKED:
        raise HTTPException(401, "Account access has been revoked")

    log_activity(db, tenant_id=user.tenantId, actor_id=user.id, action="LOGIN")
    await db.commit()
    return _issue(user)


@router.get("/me")
async def me(user: CurrentUser):
    """The current token's payload (sub, role, tenantId)."""
    return user
