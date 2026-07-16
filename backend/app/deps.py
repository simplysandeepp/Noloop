"""Auth dependencies — ports of JwtAuthGuard + RolesGuard.

current_user yields the decoded JWT payload dict ({sub, role, tenantId,
iat, exp}) exactly as Nest attached it to req.user.
"""

from typing import Annotated

import jwt as pyjwt
from fastapi import Depends, HTTPException, Request

from . import models as m
from .security import decode_token


def current_user(request: Request) -> dict:
    header = request.headers.get("authorization")
    if not header or not header.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    try:
        return decode_token(header[7:])
    except pyjwt.PyJWTError as e:
        raise HTTPException(401, "Invalid or expired token") from e


CurrentUser = Annotated[dict, Depends(current_user)]


def require_roles(*roles: m.Role):
    """Restrict a route to specific roles, e.g. Depends(require_roles(Role.PLATFORM_ADMIN))."""
    allowed = {r.value for r in roles}

    def check(user: CurrentUser) -> dict:
        if user.get("role") not in allowed:
            raise HTTPException(403, "Insufficient role")
        return user

    return check
