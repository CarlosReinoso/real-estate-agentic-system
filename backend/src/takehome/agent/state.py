from __future__ import annotations

from typing import NotRequired, TypedDict


class PlanStep(TypedDict):
    description: str
    variable: str  # "#P-S" format, e.g. "#1-1", "#1-2", "#2-1"
    tool: str
    tool_input: str
    status: str  # "pending" | "done" | "error" | "skipped"


class ToolError(TypedDict):
    step_index: int
    step_name: str
    tool_name: str
    error_message: str


class CitationRef(TypedDict):
    
    citation_id: str
    chunk_id: str | None
    path: str
    snippet: str
    page_num: int | None
    type: str  # "document" | "web"
    score: float
    citation_index: int | None 


class REWOOState(TypedDict):
    
    conversation_id: str

    summarized_history: str
    chat_history: list[dict[str, str]]
    query: str
    query_type: str

    task: str
    steps: list[PlanStep]
    results: dict[str, dict]
    current_step_index: int
    
    last_tool_error: ToolError | None
    iteration: int

    agent_started_perf: NotRequired[float | None]

    result: str
