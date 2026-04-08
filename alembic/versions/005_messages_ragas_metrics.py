# Add JSONB ragas_metrics to messages for async RAGAS evaluation.

from __future__ import annotations
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "005_messages_ragas_metrics"
down_revision = "004_document_file_size"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("ragas_metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "ragas_metrics")
