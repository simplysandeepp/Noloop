"""JWT round-trip + bcrypt verification, including a real bcryptjs-produced
hash so we prove existing NestJS-era users can still log in.
"""

import jwt as pyjwt
import pytest

from app.security import (
    decode_token,
    gen_password,
    hash_password,
    sign_token,
    verify_password,
)


def test_jwt_round_trip():
    token = sign_token("user-123", "PLATFORM_ADMIN", "tenant-9")
    payload = decode_token(token)
    assert payload["sub"] == "user-123"
    assert payload["role"] == "PLATFORM_ADMIN"
    assert payload["tenantId"] == "tenant-9"
    assert payload["exp"] > payload["iat"]


def test_jwt_rejects_tampered_token():
    token = sign_token("user-123", "HOSPITAL_STAFF", None)
    with pytest.raises(pyjwt.PyJWTError):
        decode_token(token + "tamper")


def test_bcrypt_hash_verify_round_trip():
    h = hash_password("Secret@123")
    assert h.startswith("$2")
    assert verify_password("Secret@123", h)
    assert not verify_password("wrong", h)


def test_verifies_bcryptjs_2a_hash():
    # Hash of "password" produced by bcryptjs ($2a$), the NestJS backend's format.
    legacy = "$2a$10$NGMMmKZApcBABMjuDzlkUuovTwclXHjTnE.sS5vlFiMnHzljqcvF2"
    assert verify_password("password", legacy)
    assert not verify_password("nope", legacy)


def test_gen_password_shape():
    pw = gen_password()
    assert pw.startswith("Noloop-")
    assert len(pw) == len("Noloop-") + 6
    # No ambiguous characters.
    assert not (set(pw[7:]) & set("O0I1"))
