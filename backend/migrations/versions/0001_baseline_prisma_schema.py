"""Baseline — adopt the existing Prisma-created schema as-is.

The 12 tables + 11 enums were created by Prisma migrations
(backend/prisma/). This empty revision marks that state so every future
schema change is an Alembic revision on top of it.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-15
"""

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass  # schema already exists (Prisma-created)


def downgrade() -> None:
    pass
