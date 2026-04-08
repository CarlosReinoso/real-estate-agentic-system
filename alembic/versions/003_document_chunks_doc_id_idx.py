# Add index for document_chunks.document_id.

from __future__ import annotations
from collections.abc import Sequence
from alembic import op

revision: str = "003_document_chunks_doc_id_idx"
down_revision: str | None = "002_rag_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # document_chunks is created by langchain_postgres at app startup.
    # Guard this migration for fresh DBs where the table may not exist yet.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'public'
                  AND table_name = 'document_chunks'
            ) THEN
                CREATE INDEX IF NOT EXISTS ix_document_chunks_document_id
                    ON public.document_chunks (document_id);
            END IF;
        END$$;
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_document_chunks_document_id")
