"""Password hashing + JWT — same contract as the NestJS backend.

- bcrypt cost 10 (bcryptjs default there); passlib verifies old $2a$/$2b$
  hashes unchanged, so existing users keep logging in.
- JWT: HS256, payload {sub, role, tenantId} + iat/exp, secret JWT_SECRET,
  lifetime JWT_EXPIRES_IN ('7d' style).
"""

import secrets
import time

import jwt
from passlib.context import CryptContext

from .config import get_settings

_pwd = CryptContext(schemes=["bcrypt"], bcrypt__rounds=10)

ALGORITHM = "HS256"


def hash_password(raw: str) -> str:
    return _pwd.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    return _pwd.verify(raw, hashed)


def gen_password() -> str:
    """Readable temp password, e.g. "Noloop-7F3K9Q" (no ambiguous chars).
    Returned in plain text ONCE to the admin who created/reset the account."""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "Noloop-" + "".join(secrets.choice(chars) for _ in range(6))


def sign_token(sub: str, role: str, tenant_id: str | None) -> str:
    s = get_settings()
    now = int(time.time())
    payload = {
        "sub": sub,
        "role": role,
        "tenantId": tenant_id,
        "iat": now,
        "exp": now + s.jwt_expires_seconds,
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Raises jwt.PyJWTError on bad/expired tokens."""
    return jwt.decode(token, get_settings().jwt_secret, algorithms=[ALGORITHM])
