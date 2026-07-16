"""Offline password reset — fixes a stale credential without a running server.

Issue #13: the documented password for a platform admin no longer verifies, and
you can't reset it via the admin API because logging in as that admin is exactly
what's broken. This talks straight to the DB instead.

Usage (from backend/, venv active, DATABASE_URL set):
    python -m scripts.reset_password admin@noloop.in            # random temp pw
    python -m scripts.reset_password admin@noloop.in --password 'NewPass@123'

Prints the new password ONCE. Update your local (gitignored) docs/creds.md by
hand — never commit real credentials.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app import models as m  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.security import gen_password, hash_password  # noqa: E402


async def _reset(email: str, password: str | None) -> int:
    new_password = password or gen_password()
    async with SessionLocal() as db:
        user = (
            await db.execute(select(m.User).where(m.User.email == email))
        ).scalar_one_or_none()
        if user is None:
            print(f"No user with email {email!r}.", file=sys.stderr)
            return 1
        user.passwordHash = hash_password(new_password)
        await db.commit()
        print(f"Password reset for {email} (role={user.role.value}).")
        print(f"New password: {new_password}")
        print("Store it in your local docs/creds.md — do not commit it.")
        return 0


def main() -> None:
    ap = argparse.ArgumentParser(description="Reset a NoLoop user's password (offline).")
    ap.add_argument("email")
    ap.add_argument("--password", help="explicit password; omit for a random temp one")
    args = ap.parse_args()
    raise SystemExit(asyncio.run(_reset(args.email, args.password)))


if __name__ == "__main__":
    main()
