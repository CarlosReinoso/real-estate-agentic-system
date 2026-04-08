from __future__ import annotations

import time
from datetime import datetime
from typing import Literal

import structlog
from langchain_openai import ChatOpenAI
from langgraph.config import get_config, get_stream_writer
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from takehome.agent.prompts import (
    CLASSIFIER_PROMPT,
    FALLBACK_PROMPT,
    LEGAL_ASSISTANT_SYSTEM_PROMPT,
    PLANNER_PROMPT,
    REPLANNER_PROMPT,
    SOLVER_PROMPT,
    SUMMARIZER_PROMPT,
)

from takehome.agent.state import CitationRef, PlanStep, REWOOState, ToolError
from takehome.agent.tools import history_search, llm_reasoning, vector_search, web_search
from takehome.agent.utils import (
    count_tokens,
    embed_chat_text,
    format_agent_elapsed,
    history_to_text,
    human_tool_phase,
    short_tool_result,
)
from takehome.config import settings
from takehome.db.models import Citation, Document, Message

logger = structlog.get_logger()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class QueryClassification(BaseModel):
    query_type: Literal["simple", "complex"]


class PlannerStepOutput(BaseModel):
    description: str
    tool: Literal["VectorSearch", "WebSearch", "HistorySearch", "LLM"]
    tool_input: str


class PlannerOutput(BaseModel):
    steps: list[PlannerStepOutput] = Field(default_factory=list)


def _truncate_for_replan(text: object, max_len: int = 200) -> str:
    s = str(text).replace("\n", " ").strip()
    if len(s) <= max_len:
        return s
    return s[: max_len - 1] + "…"


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _citation_dedup_key(cref: CitationRef) -> tuple[str, str]:

    ctype = cref["type"]
    if ctype == "document":
        ck = cref.get("chunk_id")
        if ck:
            return ("document", str(ck))
        path = cref.get("path") or ""
        page = cref.get("page_num")
        snip = (cref.get("snippet") or "")[:160]
        return ("document", f"{path}|p={page}|{snip}")
    return (ctype, cref.get("path") or "")

def _steps_from_structured(
    *,
    raw_steps: list[PlannerStepOutput],
    plan_number: int,
) -> list[PlanStep]:

    out: list[PlanStep] = []
    for i, s in enumerate(raw_steps, start=1):
        out.append(
            {
                "description": s.description.strip(),
                "variable": f"#{plan_number}-{i}",
                "tool": s.tool.strip(),
                "tool_input": s.tool_input.strip(),
                "status": "pending",
            }
        )
    return out


def _fallback_single_llm_step(*, plan_number: int, query: str) -> list[PlanStep]:

    return [
        {
            "description": "Answer using available context",
            "variable": f"#{plan_number}-1",
            "tool": "LLM",
            "tool_input": query,
            "status": "pending",
        }
    ]


def _get_session_factory() -> async_sessionmaker[AsyncSession]:

    config = get_config()
    return config["configurable"]["session_factory"]


def _rag_context_from_state(state: REWOOState) -> str:

    parts: list[str] = []
    task = (state.get("task") or "").strip()
    if task:
        parts.append(f"Task:\n{task}")
    summary = (state.get("summarized_history") or "").strip()
    if summary:
        parts.append(f"Conversation summary:\n{summary}")
    return "\n\n".join(parts)


async def _persist_message(
    session_factory: async_sessionmaker[AsyncSession],
    conversation_id: str,
    content: str,
    msg_type: str,
    embedding: list[float] | None = None,
) -> tuple[str, datetime]:

    async with session_factory() as session:
        msg = Message(
            conversation_id=conversation_id,
            role="assistant",
            content=content,
            type=msg_type,
            embedding=embedding,
        )
        session.add(msg)
        await session.commit()
        await session.refresh(msg)
        return msg.id, msg.created_at


async def _persist_and_stream_agent_summary(
    writer,
    session_factory: async_sessionmaker[AsyncSession],
    conversation_id: str,
    agent_started_perf: float | None,
    source_count: int,
) -> None:

    started = agent_started_perf
    if started is not None:
        elapsed = time.perf_counter() - started
        dur = format_agent_elapsed(elapsed)
        if source_count == 0:
            summary = f"No materials retrieved in {dur}"
        else:
            summary = (
                f"Retrieved {source_count} material{'s' if source_count != 1 else ''} in {dur}"
            )
    elif source_count == 0:
        summary = "No materials retrieved"
    else:
        summary = f"Retrieved {source_count} material{'s' if source_count != 1 else ''}"

    summary_embedding = await embed_chat_text(summary)
    msg_id, created_at = await _persist_message(
        session_factory,
        conversation_id,
        summary,
        "agent_summary",
        embedding=summary_embedding,
    )

    writer({
        "type": "message",
        "message": {
            "id": msg_id,
            "conversation_id": conversation_id,
            "role": "assistant",
            "content": summary,
            "type": "agent_summary",
            "sources_cited": 0,
            "created_at": created_at.isoformat(),
        },
    })


# ---------------------------------------------------------------------------
# Pre-processing nodes
# ---------------------------------------------------------------------------


async def summarize_history_node(state: REWOOState) -> dict:

    chat_history = state.get("chat_history", [])
    summarized = state.get("summarized_history", "")

    if not chat_history:
        return {}

    history_text = history_to_text(chat_history)
    total_tokens = count_tokens(history_text)

    if total_tokens <= settings.summarization_token_threshold:
        return {}

    target_tokens = settings.summarization_token_threshold // 2
    kept: list[dict[str, str]] = []
    kept_tokens = 0
    
    for msg in reversed(chat_history):
        msg_tokens = count_tokens(f"{msg['role']}: {msg['content']}")
        if kept_tokens + msg_tokens > target_tokens:
            break
        kept.insert(0, msg)
        kept_tokens += msg_tokens

    older = chat_history[: len(chat_history) - len(kept)]
    
    if not older:
        return {}

    older_text = history_to_text(older)
    prompt = SUMMARIZER_PROMPT.format(
        existing_summary=summarized or "(none)",
        messages=older_text,
    )

    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    response = await llm.ainvoke(prompt)
    new_summary = str(response.content)

    writer = get_stream_writer()
    writer({"type": "status", "node": "summarize_history", "status": "summarized"})

    return {"chat_history": kept, "summarized_history": new_summary}


async def assemble_task_node(state: REWOOState) -> dict:

    writer = get_stream_writer()
    writer({"type": "status", "node": "assemble_task", "status": "assembling"})

    session_factory = _get_session_factory()
    conversation_id = state["conversation_id"]

    async with session_factory() as session:
        stmt = select(Document).where(
            Document.conversation_id == conversation_id,
            Document.status == "ready",
        )
        result = await session.execute(stmt)
        docs = list(result.scalars().all())

    doc_info = ", ".join(
        f"{d.filename} ({d.total_pages or d.page_count} pages, {d.status})" for d in docs
    )
    if not doc_info:
        doc_info = "(no documents uploaded)"

    parts = []
    summarized = state.get("summarized_history", "")
    if summarized:
        parts.append(f"Conversation summary: {summarized}")

    chat_history = state.get("chat_history", [])
    if chat_history:
        parts.append(f"Recent messages:\n{history_to_text(chat_history)}")

    parts.append(f"Available documents: {doc_info}")
    parts.append(f"Current question: {state['query']}")

    task = "\n\n".join(parts)
    return {"task": task}


async def classify_query_node(state: REWOOState) -> dict:

    writer = get_stream_writer()
    writer({"type": "status", "node": "classify_query", "status": "classifying"})

    prompt = CLASSIFIER_PROMPT.format(task=state["task"])
    llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    structured_llm = llm.with_structured_output(QueryClassification)
    try:
        response = await structured_llm.ainvoke(prompt)
        query_type = response.query_type
    except Exception:
        logger.warning("classifier_failed_defaulting_complex", exc_info=True)

        query_type = "complex"

    return {"query_type": query_type}


async def direct_llm_node(state: REWOOState) -> dict:

    writer = get_stream_writer()
    llm = ChatOpenAI(model=settings.llm_model, temperature=0)

    full = ""
    async for chunk in llm.astream(
        [
            ("system", LEGAL_ASSISTANT_SYSTEM_PROMPT),
            ("human", state["task"]),
        ]
    ):
        token = str(chunk.content)
        if token:
            writer({"type": "content", "content": token})
            full += token

    return {"result": full}


# ---------------------------------------------------------------------------
# REWOO core nodes
# ---------------------------------------------------------------------------


async def planner_node(state: REWOOState) -> dict:

    writer = get_stream_writer()
    session_factory = _get_session_factory()

    plan_number = state.get("iteration", 0) + 1

    # Build document context
    async with session_factory() as session:
        stmt = select(Document).where(
            Document.conversation_id == state["conversation_id"],
            Document.status == "ready",
        )
        result = await session.execute(stmt)
        docs = list(result.scalars().all())

    doc_names = [d.filename for d in docs]
    if doc_names:
        doc_context = f"Available documents for VectorSearch: {', '.join(doc_names)}"
    else:
        doc_context = "No documents uploaded. Do not use VectorSearch."

    prompt = PLANNER_PROMPT.format(
        plan_number=plan_number,
        document_context=doc_context,
        task=state["task"],
    )

    llm = ChatOpenAI(model=settings.llm_model, temperature=0)
    structured_llm = llm.with_structured_output(PlannerOutput)
    try:
        response = await structured_llm.ainvoke(prompt)
        new_steps = _steps_from_structured(raw_steps=response.steps, plan_number=plan_number)
    except Exception:
        logger.exception("Structured planning failed; using regex parser fallback")
        new_steps = []

    if not new_steps:
        new_steps = _fallback_single_llm_step(plan_number=plan_number, query=state["query"])

    all_steps = list(state.get("steps", [])) + new_steps

    t0 = state.get("agent_started_perf")
    started = t0 if t0 is not None else time.perf_counter()

    writer({
        "type": "plan",
        "steps": new_steps,
        "step_count": len(new_steps),
    })

    return {
        "steps": all_steps,
        "current_step_index": len(state.get("steps", [])),
        "iteration": state.get("iteration", 0),
        "agent_started_perf": started,
    }


async def tool_executor_node(state: REWOOState) -> dict:

    writer = get_stream_writer()
    session_factory = _get_session_factory()

    idx = state["current_step_index"]
    steps = list(state["steps"])
    results = dict(state.get("results", {}))
    step = steps[idx]

    writer({
        "type": "tool_start",
        "step_id": step["variable"],
        "tool": step["tool"],
        "phase": human_tool_phase(step["tool"]),
    })

    tool_input = step["tool_input"]
    for var, res_data in results.items():
        if var in tool_input:
            tool_input = tool_input.replace(var, str(res_data.get("output", "")))

    try:
        tool_name = step["tool"]
        if tool_name == "VectorSearch":
            result = await vector_search(
                tool_input,
                state["conversation_id"],
                session_factory,
                rag_context=_rag_context_from_state(state),
            )
        elif tool_name == "WebSearch":
            result = await web_search(tool_input)
        elif tool_name == "HistorySearch":
            result = await history_search(tool_input, state["conversation_id"], session_factory)
        elif tool_name == "LLM":
            result = await llm_reasoning(tool_input)
        else:
            raise ValueError(f"Unknown tool: {tool_name}")

        steps[idx] = {**step, "status": "done"}
        results[step["variable"]] = result

        citation_count = len(result.get("citations", []))
        writer({
            "type": "tool_done",
            "step_id": step["variable"],
            "short_result": short_tool_result(tool_name, citation_count),
        })

        return {
            "steps": steps,
            "results": results,
            "current_step_index": idx + 1,
            "last_tool_error": None,
        }

    except Exception as e:
        logger.exception("Tool execution failed", tool=step["tool"], step=step["variable"])
        steps[idx] = {**step, "status": "error"}

        error: ToolError = {
            "step_index": idx,
            "step_name": step["variable"],
            "tool_name": step["tool"],
            "error_message": str(e),
        }

        err_short = str(e).replace("\n", " ").strip()
        if len(err_short) > 48:
            err_short = err_short[:45] + "…"
        writer({
            "type": "tool_error",
            "step_id": step["variable"],
            "short_result": f"Error: {err_short}" if err_short else "Error",
        })

        return {
            "steps": steps,
            "results": results,
            "current_step_index": idx + 1,
            "last_tool_error": error,
        }


async def replanner_node(state: REWOOState) -> dict:

    results = dict(state.get("results", {}))
    writer = get_stream_writer()
    session_factory = _get_session_factory()

    steps = list(state["steps"])
    error = state["last_tool_error"]
    iteration = state.get("iteration", 0) + 1
    next_plan = iteration + 1

    # Mark remaining pending steps as skipped
    for i, s in enumerate(steps):
        if s["status"] == "pending":
            steps[i] = {**s, "status": "skipped"}

    # Build execution history
    history_parts = []
    for s in steps:
        result_data = results.get(s["variable"])
        if result_data:
            out_preview = _truncate_for_replan(result_data.get("output", ""))
            history_parts.append(
                f"Plan {s['variable']} ({s['tool']}): {s['description']}\n"
                f"Result {s['variable']}: {out_preview} (status: {s['status']})"
            )
        else:
            history_parts.append(
                f"Plan {s['variable']} ({s['tool']}): {s['description']}\n"
                f"Result {s['variable']}: (status: {s['status']})"
            )

    available_vars = ", ".join(v for v in results.keys())

    prompt = REPLANNER_PROMPT.format(
        task=state["task"],
        execution_history="\n\n".join(history_parts),
        failed_step=error["step_name"] if error else "unknown",
        failed_tool=error["tool_name"] if error else "unknown",
        error_message=error["error_message"] if error else "unknown",
        available_vars=available_vars or "(none)",
        next_plan=next_plan,
    )

    llm = ChatOpenAI(model=settings.llm_model, temperature=0)
    structured_llm = llm.with_structured_output(PlannerOutput)
    try:
        response = await structured_llm.ainvoke(prompt)
        new_steps = _steps_from_structured(raw_steps=response.steps, plan_number=next_plan)
    except Exception:
        logger.exception("Structured replanning failed; using regex parser fallback")
        new_steps = []

    if not new_steps:
        new_steps = _fallback_single_llm_step(plan_number=next_plan, query=state["query"])

    all_steps = steps + new_steps

    writer({
        "type": "replan",
        "steps": new_steps,
        "step_count": len(new_steps),
    })

    return {
        "steps": all_steps,
        "current_step_index": len(steps),
        "iteration": iteration,
        "last_tool_error": None,
    }


async def build_citations_node(state: REWOOState) -> dict:

    writer = get_stream_writer()
    session_factory = _get_session_factory()
    results = dict(state.get("results", {}))

    has_any = any((result_data.get("citations") or []) for result_data in results.values())
    if not has_any:
        await _persist_and_stream_agent_summary(
            writer,
            session_factory,
            state["conversation_id"],
            state.get("agent_started_perf"),
            0,
        )
        writer({"type": "citations", "citations": []})
        return {"results": results}

    seen: dict[tuple[str, str], CitationRef] = {}
    dedup_map: dict[str, str] = {}  # old_citation_id -> winning_citation_id

    for result_data in results.values():
        for cref in result_data.get("citations", []):
            key = _citation_dedup_key(cref)
            if key in seen:
                dedup_map[cref["citation_id"]] = seen[key]["citation_id"]
            else:
                seen[key] = cref

    # Rank by score descending
    unique_refs = sorted(seen.values(), key=lambda c: c.get("score", 0), reverse=True)

    # Assign citation_index (1-based)
    id_to_index: dict[str, int] = {}
    for i, cref in enumerate(unique_refs, 1):
        cref["citation_index"] = i
        id_to_index[cref["citation_id"]] = i

    # Persist to DB
    async with session_factory() as session:
        for cref in unique_refs:
            citation = Citation(
                citation_id=cref["citation_id"],
                message_id=None,
                chunk_id=cref.get("chunk_id"),
                path=cref["path"],
                content=cref["snippet"],
                page_num=cref.get("page_num"),
                type=cref["type"],
                citation_index=cref["citation_index"],
                score=cref.get("score"),
            )
            session.add(citation)
        await session.commit()

    # Update all CitationRefs in results with correct citation_id and citation_index
    for variable, result_data in list(results.items()):
        raw_citations = result_data.get("citations", []) or []
        updated_citations: list[CitationRef] = []
        for cref in raw_citations:
            cid = cref["citation_id"]
            winning_id = dedup_map.get(cid, cid)
            idx_val = id_to_index.get(winning_id)
            if winning_id != cid or idx_val is not None:
                cref = dict(cref)
                cref["citation_id"] = winning_id
                if idx_val is not None:
                    cref["citation_index"] = idx_val
            updated_citations.append(cref)

        if updated_citations is not raw_citations:
            new_result_data = dict(result_data)
            new_result_data["citations"] = updated_citations
            results[variable] = new_result_data

    await _persist_and_stream_agent_summary(
        writer,
        session_factory,
        state["conversation_id"],
        state.get("agent_started_perf"),
        len(unique_refs),
    )
    writer({"type": "citations", "citations": unique_refs})

    return {"results": results}


async def solver_node(state: REWOOState) -> dict:

    writer = get_stream_writer()
    results = dict(state.get("results", {}))

    history_parts = []
    completed_steps = [s for s in state["steps"] if s.get("status") == "done"]

    if not completed_steps:
        history_parts.append("No completed plan steps are available.")

    for step in completed_steps:
        result_data = results.get(step["variable"])
        if not result_data:
            continue

        citation_blocks = []
        for cref in result_data.get("citations", []):
            citation_blocks.append(
                (
                    "- "
                    f"index={cref.get('citation_index')}, "
                    f"citation_id={cref.get('citation_id')}, "
                    f"type={cref.get('type')}, "
                    f"path={cref.get('path')}, "
                    f"page_num={cref.get('page_num')}, "
                    f"chunk_id={cref.get('chunk_id')}, "
                    f"score={cref.get('score')}, "
                    f"snippet={cref.get('snippet')}"
                )
            )

        citation_text = (
            "\nCitations:\n" + "\n".join(citation_blocks)
            if citation_blocks
            else "\nCitations:\n- (none)"
        )

        history_parts.append(
            f"Plan {step['variable']} ({step['tool']}): {step['description']}\n"
            f"Result {step['variable']} output: {str(result_data.get('output', ''))[:1200]}"
            f"{citation_text}"
        )

    prompt = SOLVER_PROMPT.format(
        task=state["task"],
        execution_history="\n\n".join(history_parts),
    )

    llm = ChatOpenAI(model=settings.llm_model, temperature=0)
    full = ""
    async for chunk in llm.astream(
        [
            ("system", LEGAL_ASSISTANT_SYSTEM_PROMPT),
            ("human", prompt),
        ]
    ):
        token = str(chunk.content)
        if token:
            writer({"type": "content", "content": token})
            full += token

    return {"result": full}


async def fallback_node(state: REWOOState) -> dict:

    writer = get_stream_writer()
    writer({"type": "fallback", "reason": "3rd plan tool failure"})

    results = dict(state.get("results", {}))
    evidence_parts = []
    for variable, result_data in results.items():
        evidence_parts.append(f"{variable}: {str(result_data.get('output', ''))[:300]}")

    error = state.get("last_tool_error")
    failed_info = f"{error['step_name']} {error['tool_name']}: {error['error_message']}" if error else "unknown"

    prompt = FALLBACK_PROMPT.format(
        task=state["task"],
        evidence="\n\n".join(evidence_parts) if evidence_parts else "(no evidence)",
        failed_step=failed_info,
    )

    llm = ChatOpenAI(model=settings.llm_model, temperature=0)
    full = ""
    async for chunk in llm.astream(
        [
            ("system", LEGAL_ASSISTANT_SYSTEM_PROMPT),
            ("human", prompt),
        ]
    ):
        token = str(chunk.content)
        if token:
            writer({"type": "content", "content": token})
            full += token

    return {"result": full}


async def update_history_node(state: REWOOState) -> dict:
    
    chat_history = list(state.get("chat_history", []))
    chat_history.append({"role": "user", "content": state["query"]})
    chat_history.append({"role": "assistant", "content": state.get("result", "")})
    return {"chat_history": chat_history}
