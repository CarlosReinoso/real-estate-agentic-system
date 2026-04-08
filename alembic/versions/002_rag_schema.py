# Add pgvector, citations table, document status, message type/embedding

from __future__ import annotations
from collections.abc import Sequence
import sqlalchemy as sa
from   alembic import op

revision: str = "002_rag_schema"
down_revision: str | None = "001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # --- documents: add status tracking columns ---
    op.add_column("documents", sa.Column("ocr_done", sa.Boolean(), server_default="false"))
    op.add_column("documents", sa.Column("status", sa.String(), server_default="uploading", nullable=False))
    op.add_column("documents", sa.Column("total_pages", sa.Integer(), nullable=True))

    # --- messages: add type column ---
    op.add_column("messages", sa.Column("type", sa.String(), server_default="chat", nullable=False))

    # pgvector VECTOR column via raw SQL (Alembic has no native vector type)
    op.execute("ALTER TABLE messages ADD COLUMN embedding vector(1536)")

    # --- citations table ---
    op.create_table(
        "citations",
        sa.Column("citation_id", sa.String(), nullable=False),
        sa.Column("message_id", sa.String(), nullable=True),
        sa.Column("chunk_id", sa.String(), nullable=True),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("page_num", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("citation_index", sa.Integer(), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("citation_id"),
        sa.ForeignKeyConstraint(
            ["message_id"],
            ["messages.id"],
            ondelete="CASCADE",
        ),
    )

    # HNSW index on messages.embedding for cosine distance
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_messages_embedding "
        "ON messages USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_messages_embedding")
    op.drop_table("citations")
    op.execute("ALTER TABLE messages DROP COLUMN IF EXISTS embedding")
    op.drop_column("messages", "type")
    op.drop_column("documents", "total_pages")
    op.drop_column("documents", "status")
    op.drop_column("documents", "ocr_done")
