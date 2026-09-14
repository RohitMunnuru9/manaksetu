"""Initial ManakSetu schema.

Revision ID: 20260914_0001
"""
from alembic import op
import sqlalchemy as sa

revision = "20260914_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Models are the canonical schema during the MVP. This creates the same
    # metadata for SQLite development and PostgreSQL/pgvector deployments.
    from app.database import Base
    from app import models  # noqa: F401
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    from app.database import Base
    from app import models  # noqa: F401
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
