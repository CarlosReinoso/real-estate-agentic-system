"""LangGraph node callables: retrieve, grade_documents, transform_query."""

from __future__ import annotations

from typing import Any

import structlog
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from takehome.agent.state import CitationRef
from takehome.agent.tools import document_chunks_vector_search
from takehome.config import settings

from .prompts import GRADE_DOCUMENT_HUMAN, GRADE_DOCUMENT_SYSTEM
from .prompts import RETRY_SECTION, TRANSFORM_QUERY
from .state import CRAGState, GradeDocuments, QueryRewrite

logger = structlog.get_logger()

MAX_RETRIEVAL_ROUNDS = 3
EXCERPT_CHARS = 3200
FALLBACK_QUERY_MAX_CHARS = 320
FALLBACK_QUERY_DEFAULT = "document content"
DEFAULT_SEARCH_QUERY = "document"

crag_llm = ChatOpenAI(model=settings.llm_model, temperature=0)
transform_query_llm = crag_llm.with_structured_output(QueryRewrite)
grade_document_llm = crag_llm.with_structured_output(GradeDocuments)

def question_for_grading(state: CRAGState) -> str:
    query = state["original_query"].strip()
    context = (state.get("context") or "").strip()
    return f"Context:\n{context}\n\nQuestion:\n{query}" if context else query


def effective_search_query(state: CRAGState) -> str:
    rewritten = (state.get("search_query") or "").strip()
    return rewritten or state["original_query"].strip() or DEFAULT_SEARCH_QUERY


def format_transform_prompt(state: CRAGState) -> str:
    grade_notes = (state.get("grade_notes") or "").strip()
    
    retry = (
        RETRY_SECTION.format(grade_notes=grade_notes)
        if state.get("retrieval_count", 0) > 0 and grade_notes
        else ""
    )

    return TRANSFORM_QUERY.format(
        context=state.get("context") or "(none)",
        question=state["original_query"],
        retry_section=retry,
    )


def fallback_search_query(original: str) -> str:
    query = original.strip()

    if not query:
        return FALLBACK_QUERY_DEFAULT

    if len(query) <= FALLBACK_QUERY_MAX_CHARS:
        return query

    return query[: FALLBACK_QUERY_MAX_CHARS - 3] + "..."


def create_retrieve_node(session_factory: async_sessionmaker[AsyncSession]):
    async def retrieve(state: CRAGState) -> dict[str, Any]:
        nxt = state.get("retrieval_count", 0) + 1
        q = effective_search_query(state)
        cites = await document_chunks_vector_search(
            q,
            state["conversation_id"],
            session_factory,
            doc_ids=state["doc_ids"],
        )
        logger.info("crag_retrieve", round=nxt, query_preview=q[:120], hits=len(cites))
        
        return {
            "retrieval_count": nxt,
            "citations": cites,
        }

    return retrieve


def create_grade_documents_node():
    async def grade_documents(state: CRAGState) -> dict[str, Any]:
        question = question_for_grading(state)
        raw = state.get("citations", [])
        filtered: list[CitationRef] = []
        for c in raw:
            doc_txt = (c.get("snippet") or "").strip()
            if not doc_txt:
                continue
            if len(doc_txt) > EXCERPT_CHARS:
                doc_txt = doc_txt[: EXCERPT_CHARS - 1] + "…"
            human = GRADE_DOCUMENT_HUMAN.format(question=question, document=doc_txt)
            try:
                msg = await grade_document_llm.ainvoke(
                    [
                        SystemMessage(content=GRADE_DOCUMENT_SYSTEM),
                        HumanMessage(content=human),
                    ],
                )
                if msg.binary_score == "yes":
                    filtered.append(c)
            except Exception:
                logger.warning("crag_grade_chunk_failed", exc_info=True)
                filtered.append(c)

        total = len(raw)
        kept = len(filtered)
        notes = (
            f"Kept {kept}/{total} chunk(s) as relevant."
            if kept
            else f"No relevant chunks (0/{total})."
        )
        logger.info("crag_grade_documents", kept=kept, total=total)
        return {"citations": filtered, "grade_notes": notes}

    return grade_documents


def create_transform_query_node():
    async def transform_query(state: CRAGState) -> dict[str, Any]:
        prompt = format_transform_prompt(state)
        try:
            out = await transform_query_llm.ainvoke(prompt)
            q = (out.search_query or "").strip()
            if not q:
                q = fallback_search_query(state["original_query"])
        except Exception:
            logger.warning("crag_transform_query_failed", exc_info=True)
            q = fallback_search_query(state["original_query"])
        logger.info(
            "crag_transform_query",
            round=state.get("retrieval_count", 0),
            query_preview=q[:120],
        )
        return {"search_query": q}

    return transform_query
