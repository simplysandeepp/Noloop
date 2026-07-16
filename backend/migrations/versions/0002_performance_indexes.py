"""Performance indexes for the hot query paths (issue #21).

Covers the role-scoped claim lists, the submittedAt-ordered listing, the claim
timeline, and the activity-log feed. Idempotent (CREATE INDEX IF NOT EXISTS) so
it is safe even where the Prisma baseline already created an equivalent index.

For very large tables in production, prefer CREATE INDEX CONCURRENTLY (no table
lock) run outside a transaction — see backend/DB_SCALING.md. At current volume
the plain in-transaction create is fine.

Revision ID: 0002_perf_indexes
Revises: 0001_baseline
"""

from alembic import op

revision = "0002_perf_indexes"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None

_INDEXES = [
    # Role-scoped claim lists filter by tenant + (optionally) status.
    ('idx_claim_hospital_status', '"Claim" ("hospitalTenantId", "status")'),
    ('idx_claim_insurer_status', '"Claim" ("insurerTenantId", "status")'),
    # Listing is ordered by submittedAt DESC.
    ('idx_claim_submittedat_desc', '"Claim" ("submittedAt" DESC)'),
    # Claim timeline: events for a claim in chronological order.
    ('idx_claimevent_claim_created', '"ClaimEvent" ("claimId", "createdAt")'),
    # Admin activity feed: newest first.
    ('idx_activitylog_created_desc', '"ActivityLog" ("createdAt" DESC)'),
]


def upgrade() -> None:
    for name, target in _INDEXES:
        op.execute(f'CREATE INDEX IF NOT EXISTS {name} ON {target}')


def downgrade() -> None:
    for name, _ in _INDEXES:
        op.execute(f'DROP INDEX IF EXISTS {name}')
