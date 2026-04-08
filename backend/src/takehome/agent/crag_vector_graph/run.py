from __future__ import annotations

from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .graph import build_crag_vector_graph
from .state import CRAGState


async def run_corrective_rag_vector_search(
    *,
    original_query: str,
    conversation_id: str,
    session_factory: async_sessionmaker[AsyncSession],
    rag_context: str,
    doc_ids: list[str],
) -> dict[str, Any]:
    graph = build_crag_vector_graph(session_factory)
    
    initial: CRAGState = {
        "conversation_id": conversation_id,
        "doc_ids": doc_ids,
        "context": rag_context,
        "original_query": original_query,
        "search_query": "",
        "retrieval_count": 0,
        "grade_notes": "",
        "citations": [],
    }
    final = await graph.ainvoke(initial)

    citations = final.get("citations") or []

    if citations:
        output = f"{len(citations)} relevant materials retrieved (adaptive RAG)."
    else:
        output = "No relevant results found after retrieval attempts."

    return {"output": output, "citations": citations}
