from __future__ import annotations

import uuid

import structlog
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_postgres import PGEngine, PGVectorStore
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tavily import AsyncTavilyClient

from takehome.agent.state import CitationRef
from takehome.config import settings

logger = structlog.get_logger()

MAX_TOOL_OUTPUT_CHARS = 8000
SCORE_THRESHOLD = 0.3


async def document_chunks_vector_search(
    query: str,
    conversation_id: str,
    session_factory: async_sessionmaker[AsyncSession],
    *,
    doc_ids: list[str] | None = None,
) -> list[CitationRef]:
    """Single-shot similarity search over ready documents (used by CRAG retrieve node)."""
    from takehome.db.models import Document

    if doc_ids is None:
        async with session_factory() as session:
            stmt = select(Document.id).where(
                Document.conversation_id == conversation_id,
                Document.status == "ready",
            )
            result = await session.execute(stmt)
            doc_ids = [row[0] for row in result.fetchall()]

    if not doc_ids:
        return []

    pg_engine = PGEngine.from_connection_string(settings.database_url)
    embedding_service = OpenAIEmbeddings(model=settings.embedding_model)
    store = await PGVectorStore.create(
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

    results = await store.asimilarity_search_with_score(
        query, k=15, filter={"document_id": {"$in": doc_ids}}
    )

    logger.info("document_vector_search", query_preview=query[:120], conversation_id=conversation_id)

    citations: list[CitationRef] = []
    for doc, score in results:
        if score < SCORE_THRESHOLD:
            continue

        chunk_id = doc.metadata.get("chunk_id", "")
        source_path = doc.metadata.get("source_path", "")
        page_number = doc.metadata.get("page_number")

        cref: CitationRef = {
            "citation_id": uuid.uuid4().hex,
            "chunk_id": chunk_id,
            "path": source_path,
            "snippet": doc.page_content,
            "page_num": page_number,
            "type": "document",
            "score": float(score),
            "citation_index": None,
        }

        citations.append(cref)

    return citations


async def vector_search(
    query: str,
    conversation_id: str,
    session_factory: async_sessionmaker[AsyncSession],
    *,
    rag_context: str = "",
) -> dict:
    """
    Adaptive RAG over uploads (LangGraph subgraph): retrieve → per-chunk relevance grade →
    optional query transform and re-retrieve, up to 3 retrieval rounds. See
    `crag_vector_graph` and the LangGraph adaptive RAG notebook.
    """
    from takehome.db.models import Document

    async with session_factory() as session:
        stmt = select(Document.id).where(
            Document.conversation_id == conversation_id,
            Document.status == "ready",
        )
        result = await session.execute(stmt)
        doc_ids = [row[0] for row in result.fetchall()]

    if not doc_ids:
        return {"output": "No documents available for search.", "citations": []}

    from takehome.agent.crag_vector_graph import run_corrective_rag_vector_search

    return await run_corrective_rag_vector_search(
        original_query=query,
        conversation_id=conversation_id,
        session_factory=session_factory,
        rag_context=rag_context,
        doc_ids=doc_ids,
    )


async def web_search(query: str) -> dict:
    client = AsyncTavilyClient(api_key=settings.tavily_api_key)
    response = await client.search(query, max_results=10)

    citations: list[CitationRef] = []
    output_parts: list[str] = []

    for r in response.get("results", []):
        cref: CitationRef = {
            "citation_id": uuid.uuid4().hex,
            "chunk_id": None,
            "path": r.get("url", ""),
            "snippet": r.get("content", ""),
            "page_num": None,
            "type": "web",
            "score": float(r.get("score", 0.0)),
            "citation_index": None,
        }
        citations.append(cref)

    output = f"{len(citations)} web results retrieved." if len(citations) > 0 else "No web results found."

    return {"output": output, "citations": citations}


async def history_search(
    query: str,
    conversation_id: str,
    session_factory: async_sessionmaker[AsyncSession],
) -> dict:
    embedding_service = OpenAIEmbeddings(model=settings.embedding_model)
    query_embedding = await embedding_service.aembed_query(query)

    async with session_factory() as session:
        emb_literal = "[" + ",".join(str(float(x)) for x in query_embedding) + "]"
        stmt = text("""
            SELECT id, role, content, 1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
            FROM messages
            WHERE conversation_id = :cid
              AND embedding IS NOT NULL
              AND type = 'chat'
            ORDER BY embedding <=> CAST(:embedding AS vector)
            LIMIT 5
        """)
        result = await session.execute(
            stmt,
            {"embedding": emb_literal, "cid": conversation_id},
        )
        rows = result.fetchall()

    if not rows:
        return {"output": "No relevant past messages found.", "citations": []}

    output_parts = []
    for row in rows:
        role, content, sim = row[1], row[2], row[3]
        output_parts.append(f"[{role}, similarity={sim:.2f}]: {content}")

    output = "\n\n".join(output_parts)

    return {"output": output, "citations": []}


async def llm_reasoning(query: str) -> dict:
    llm = ChatOpenAI(model=settings.llm_model, temperature=0)
    response = await llm.ainvoke(query)
    output = str(response.content)

    return {"output": output, "citations": []}


TOOL_MAP = {
    "VectorSearch": "vector_search",
    "WebSearch": "web_search",
    "HistorySearch": "history_search",
    "LLM": "llm_reasoning",
}
