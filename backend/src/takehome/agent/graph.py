from __future__ import annotations

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph

from takehome.agent.nodes import (
    assemble_task_node,
    build_citations_node,
    classify_query_node,
    direct_llm_node,
    fallback_node,
    planner_node,
    replanner_node,
    solver_node,
    summarize_history_node,
    tool_executor_node,
    update_history_node,
)

from takehome.agent.state import REWOOState


def _route_after_classify(state: REWOOState) -> str:
    return "direct_llm" if state["query_type"] == "simple" else "planner"


def _route_after_tool(state: REWOOState) -> str:
    if state.get("last_tool_error"):
        if state.get("iteration", 0) < 2:
            return "replan"
        return "build_citations"
    if state["current_step_index"] >= len(state["steps"]):
        return "build_citations"
    return "tool"


def _route_after_citations(state: REWOOState) -> str:
    if state.get("last_tool_error"):
        return "fallback"
    return "solve"


def build_graph(checkpointer: AsyncPostgresSaver) -> StateGraph:
    graph = StateGraph(REWOOState)

    graph.add_node("summarize_history", summarize_history_node)
    graph.add_node("assemble_task", assemble_task_node)
    graph.add_node("classify_query", classify_query_node)
    graph.add_node("direct_llm", direct_llm_node)

    graph.add_node("planner", planner_node)
    graph.add_node("tool", tool_executor_node)
    graph.add_node("replan", replanner_node)
    graph.add_node("build_citations", build_citations_node)
    graph.add_node("solve", solver_node)
    graph.add_node("fallback", fallback_node)

    graph.add_node("update_history", update_history_node)

    graph.add_edge(START, "summarize_history")
    graph.add_edge("summarize_history", "assemble_task")
    graph.add_edge("assemble_task", "classify_query")
    graph.add_conditional_edges("classify_query", _route_after_classify, {
        "direct_llm": "direct_llm",
        "planner": "planner",
    })
    graph.add_edge("direct_llm", "update_history")

    graph.add_edge("planner", "tool")
    graph.add_conditional_edges("tool", _route_after_tool, {
        "tool": "tool",
        "replan": "replan",
        "build_citations": "build_citations",
    })
    graph.add_edge("replan", "tool")
    graph.add_conditional_edges("build_citations", _route_after_citations, {
        "solve": "solve",
        "fallback": "fallback",
    })
    graph.add_edge("solve", "update_history")
    graph.add_edge("fallback", "update_history")
    graph.add_edge("update_history", END)

    return graph.compile(checkpointer=checkpointer)
