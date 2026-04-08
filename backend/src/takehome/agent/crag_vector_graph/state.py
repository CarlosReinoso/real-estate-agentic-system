from __future__ import annotations

from typing import Literal, TypedDict
from pydantic import BaseModel, Field
from takehome.agent.state import CitationRef


class CRAGState(TypedDict):

    conversation_id: str
    doc_ids: list[str]
    context: str
    original_query: str
    search_query: str
    retrieval_count: int
    grade_notes: str
    citations: list[CitationRef]


class QueryRewrite(BaseModel):
    """Structured output for the query-transform step."""

    search_query: str = Field(
        description="Improved question for vector retrieval (single line)",
        max_length=400,
    )


class GradeDocuments(BaseModel):
    """Binary relevance check per retrieved passage (matches LangGraph adaptive RAG notebook)."""

    binary_score: Literal["yes", "no"] = Field(
        description="'yes' if the passage is relevant to the user question, else 'no'",
    )
