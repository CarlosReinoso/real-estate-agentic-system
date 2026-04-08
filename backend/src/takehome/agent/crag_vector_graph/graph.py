"""Assemble the LangGraph workflow (nodes + edges)."""

from __future__ import annotations

from typing import Literal
from langgraph.graph import END, START, StateGraph
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .nodes import (
    MAX_RETRIEVAL_ROUNDS,
    create_grade_documents_node,
    create_retrieve_node,
    create_transform_query_node,
)

from .state import CRAGState


def decide_after_grade(state: CRAGState) -> Literal["done", "transform_query"]:
    if len(state.get("citations", [])) > 0:
        return "done"
    if state.get("retrieval_count", 0) >= MAX_RETRIEVAL_ROUNDS:
        return "done"
    return "transform_query"


def build_crag_vector_graph(
    session_factory: async_sessionmaker[AsyncSession],
):

    retrieve = create_retrieve_node(session_factory)
    grade_documents = create_grade_documents_node()
    transform_query = create_transform_query_node()

    graph = StateGraph(CRAGState)
    graph.add_node("retrieve", retrieve)
    graph.add_node("grade_documents", grade_documents)
    graph.add_node("transform_query", transform_query)

    graph.add_edge(START, "retrieve")
    graph.add_edge("retrieve", "grade_documents")
    graph.add_conditional_edges(
        "grade_documents",
        decide_after_grade,
        {"done": END, "transform_query": "transform_query"},
    )
    graph.add_edge("transform_query", "retrieve")

    return graph.compile()
