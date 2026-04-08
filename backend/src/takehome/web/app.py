from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import redis.asyncio as aioredis
import structlog
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from takehome.config import settings
from takehome.web.routers import conversations, documents, messages

logger = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Running database migrations...")
    alembic_cfg = Config("alembic.ini")
    await asyncio.to_thread(command.upgrade, alembic_cfg, "head")
    logger.info("Migrations complete")

    app.state.redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    logger.info("Redis connection pool initialized")

    # LangChain PGVectorStore for document chunks
    try:
        from langchain_openai import OpenAIEmbeddings
        from langchain_postgres import Column, PGEngine, PGVectorStore

        pg_engine = PGEngine.from_connection_string(settings.database_url)
        # Avoid duplicate CREATE TABLE attempts during startup.
        sa_engine = create_async_engine(settings.database_url, echo=False)
        try:
            async with sa_engine.connect() as conn:
                exists = bool(
                    await conn.scalar(
                        text(
                            """
                            SELECT EXISTS (
                                SELECT 1
                                FROM information_schema.tables
                                WHERE table_schema = 'public'
                                  AND table_name = 'document_chunks'
                            )
                            """
                        )
                    )
                )
            if not exists:
                await pg_engine.ainit_vectorstore_table(
                    table_name="document_chunks",
                    vector_size=1536,
                    metadata_columns=[
                        Column("chunk_id", "VARCHAR", nullable=False),
                        Column("document_id", "VARCHAR", nullable=False),
                        Column("page_number", "INTEGER", nullable=True),
                        Column("bbox", "JSONB", nullable=True),
                        Column("source_path", "VARCHAR", nullable=True),
                    ],
                    overwrite_existing=False,
                )
            else:
                logger.info("PGVector table already exists; skipping creation")
        except Exception as e:

            if "already exists" in str(e).lower() and "document_chunks" in str(e):
                logger.info("PGVector table already exists; skipping creation")
            else:
                raise
        finally:
            await sa_engine.dispose()
        embedding_service = OpenAIEmbeddings(model=settings.embedding_model)
        app.state.vectorstore = await PGVectorStore.create(
            engine=pg_engine,
            table_name="document_chunks",
            embedding_service=embedding_service,
            metadata_columns=[
                "chunk_id",
                "document_id",
                "page_number",
                "bbox",
                "source_path",
            ],
        )
        app.state.pg_engine = pg_engine
        logger.info("PGVectorStore initialized")
    except Exception:
        logger.exception("Failed to initialize PGVectorStore (non-fatal)")

    # LangGraph checkpointer
    try:
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

        checkpointer_cm = AsyncPostgresSaver.from_conn_string(
            settings.database_url_psycopg
        )
        checkpointer = await checkpointer_cm.__aenter__()
        await checkpointer.setup()
        app.state.checkpointer = checkpointer
        app.state.checkpointer_cm = checkpointer_cm
        logger.info("LangGraph checkpointer initialized")
    except Exception:
        logger.exception("Failed to initialize LangGraph checkpointer (non-fatal)")

    yield

    await app.state.redis.aclose()
    logger.info("Redis connection pool closed")
    checkpointer_cm = getattr(app.state, "checkpointer_cm", None)
    if checkpointer_cm is not None:
        await checkpointer_cm.__aexit__(None, None, None)


app = FastAPI(title="Orbital Document Q&A", lifespan=lifespan)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    
    return {"status": "ok"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(conversations.router)
app.include_router(messages.router)
app.include_router(documents.router)
