"""Test bootstrap — provide the env the settings layer requires so the suite
runs in CI without a real .env or database. These values are only used for
unit tests (JWT round-trips, pure helpers); no connection is opened.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost:5432/test")
os.environ.setdefault("DIRECT_URL", "postgresql://user:pass@localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
os.environ.setdefault("JWT_EXPIRES_IN", "7d")
