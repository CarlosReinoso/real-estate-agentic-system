from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.responses import StreamingResponse

from takehome.agent import build_graph
from takehome.agent.ragas_eval import extract_contexts_from_graph_results, run_ragas_evaluation_task
from takehome.agent.utils import embed_chat_text
from takehome.config import settings
from takehome.db.models import Citation, Document, Message
from takehome.db.session import async_session, get_session
from takehome.services.conversation import get_conversation, maybe_generate_conversation_title

router = APIRouter(tags=["messages"])


class CitationOut(BaseModel):
    citation_id: str
    citation_index: int
    chunk_id: str | None = None
    filename: str | None = None
    path: str
    content: str
    page_num: int | None = None
    type: str
    score: float | None = None


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    type: str
    sources_cited: int
    created_at: datetime
    citations: list[CitationOut] | None = None
    ragas_metrics: dict[str, object] | None = None


class MessageCreate(BaseModel):
    content: str


@router.get("/api/messages/{message_id}/ragas", response_model=dict[str, object] | None)
async def get_message_ragas_metrics(
    message_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, object] | None:
    m = await session.get(Message, message_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Message not found")
    if m.ragas_metrics is None:
        return None
    return dict(m.ragas_metrics) if isinstance(m.ragas_metrics, dict) else None


@router.get("/api/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[MessageOut]:

    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    docs_stmt = select(Document.filename, Document.file_path).where(
        Document.conversation_id == conversation_id
    )
    docs_rows = (await session.execute(docs_stmt)).all()

    def resolve_filename(path: str) -> str | None:
        for filename, file_path in docs_rows:
            if file_path and file_path == path:
                return filename
            if filename and filename in path:
                return filename
        return None

    stmt = (
        select(Message)
        .options(selectinload(Message.citations))
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    result = await session.execute(stmt)
    messages = list(result.scalars().all())

    out: list[MessageOut] = []
    for m in messages:
        citations_out = None
        if m.role == "assistant" and m.type == "chat" and m.citations:
            citations_out = [
                CitationOut(
                    citation_id=c.citation_id,
                    citation_index=c.citation_index,
                    chunk_id=c.chunk_id,
                    filename=resolve_filename(c.path),
                    path=c.path,
                    content=c.content,
                    page_num=c.page_num,
                    type=c.type,
                    score=c.score,
                )
                for c in sorted(m.citations, key=lambda x: x.citation_index)
            ]

        ragas_out = dict(m.ragas_metrics) if isinstance(m.ragas_metrics, dict) else None
        out.append(
            MessageOut(
                id=m.id,
                conversation_id=m.conversation_id,
                role=m.role,
                content=m.content,
                type=m.type,
                sources_cited=m.sources_cited,
                created_at=m.created_at,
                citations=citations_out,
                ragas_metrics=ragas_out,
            )
        )

    return out


@router.get(
    "/api/conversations/{conversation_id}/messages/{message_id}/citations",
    response_model=list[CitationOut],
)
async def get_message_citations(
    conversation_id: str,
    message_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[CitationOut]:

    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    stmt = (
        select(Message)
        .options(selectinload(Message.citations))
        .where(Message.id == message_id, Message.conversation_id == conversation_id)
    )
    result = await session.execute(stmt)
    m = result.scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail="Message not found")

    if not m.citations:
        return []

    docs_stmt = select(Document.filename, Document.file_path).where(
        Document.conversation_id == conversation_id
    )
    docs_rows = (await session.execute(docs_stmt)).all()

    def resolve_filename(path: str) -> str | None:
        for filename, file_path in docs_rows:
            if file_path and file_path == path:
                return filename
            if filename and filename in path:
                return filename
        return None

    return [
        CitationOut(
            citation_id=c.citation_id,
            citation_index=c.citation_index,
            chunk_id=c.chunk_id,
            filename=resolve_filename(c.path),
            path=c.path,
            content=c.content,
            page_num=c.page_num,
            type=c.type,
            score=c.score,
        )
        for c in sorted(m.citations, key=lambda x: x.citation_index)
    ]


@router.get("/api/citations/{citation_id}", response_model=CitationOut)
async def get_citation(
    citation_id: str,
    session: AsyncSession = Depends(get_session),
) -> CitationOut:
    c = await session.get(Citation, citation_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Citation not found")

    conversation_id: str | None = None
    if c.message_id:
        msg = await session.get(Message, c.message_id)
        if msg is not None:
            conversation_id = msg.conversation_id

    filename: str | None = None
    if conversation_id:
        docs_stmt = select(Document.filename, Document.file_path).where(
            Document.conversation_id == conversation_id
        )
        docs_rows = (await session.execute(docs_stmt)).all()

        for fn, fp in docs_rows:
            if fp and fp == c.path:
                filename = fn
                break
            if fn and fn in c.path:
                filename = fn
                break

    return CitationOut(
        citation_id=c.citation_id,
        citation_index=c.citation_index,
        chunk_id=c.chunk_id,
        filename=filename,
        path=c.path,
        content=c.content,
        page_num=c.page_num,
        type=c.type,
        score=c.score,
    )


@router.post("/api/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: MessageCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:

    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"message_id": "", "status": "use_stream_endpoint"}


@router.post("/api/conversations/{conversation_id}/messages/stream")
async def send_message_stream(
    request: Request,
    conversation_id: str,
    body: MessageCreate,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:

    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    user_embedding = await embed_chat_text(body.content)
    user_msg = Message(
        conversation_id=conversation_id,
        role="user",
        content=body.content,
        type="chat",
        embedding=user_embedding,
    )
    session.add(user_msg)
    await session.commit()

    prior_stmt = (
        select(Message.role, Message.content)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    prior_rows = (await session.execute(prior_stmt)).all()
    prior_chat_history = [{"role": r, "content": c} for r, c in prior_rows if r in ("user", "assistant")]

    checkpointer = getattr(request.app.state, "checkpointer", None)
    graph = build_graph(checkpointer)
    config = {"configurable": {"thread_id": conversation_id, "session_factory": async_session}}

    async def event_generator() -> AsyncIterator[str]:
        initial_state = {
            "query": body.content,
            "conversation_id": conversation_id,
            "task": "",
            "query_type": "",
            "steps": [],
            "results": {},
            "current_step_index": 0,
            "last_tool_error": None,
            "iteration": 0,
            "result": "",
            "chat_history": prior_chat_history,
            "agent_started_perf": time.perf_counter(),
        }

        event_id = 0
        final_state: dict | None = None
        try:
            async for chunk in graph.astream(initial_state, config, stream_mode=["custom", "values"]):
                if await request.is_disconnected():
                    return
                if chunk[0] == "custom":
                    event_id += 1
                    yield f"id: {event_id}\\ndata: {json.dumps(chunk[1], default=str)}\\n\\n"
                elif chunk[0] == "values":
                    final_state = chunk[1]

            if final_state is None:
                raise RuntimeError("Graph produced no final state")

            final_result = str(final_state.get("result") or "")
            query_type = str(final_state.get("query_type") or "")
            results_payload = final_state.get("results") or {}
            qt_norm = query_type.strip().lower()
            results_ok = isinstance(results_payload, dict) and len(results_payload) > 0
            
            should_run_ragas = settings.ragas_evaluation_enabled and (
                qt_norm == "complex" or (qt_norm != "simple" and results_ok)
            )
            rag_contexts = extract_contexts_from_graph_results(
                results_payload if isinstance(results_payload, dict) else {}
            )

            citation_ids: list[str] = []
            for result_data in results_payload.values() if isinstance(results_payload, dict) else []:
                for cref in result_data.get("citations", []):
                    cid = cref.get("citation_id")
                    if cid:
                        citation_ids.append(cid)
            sources_cited = len(set(citation_ids))

            ragas_eval_queued = False
            initial_ragas: dict[str, object] | None = None
            if should_run_ragas:
                if rag_contexts:
                    initial_ragas = {"status": "pending"}
                    ragas_eval_queued = True
                else:
                    initial_ragas = {"status": "skipped", "reason": "no_retrieved_contexts"}

            async with async_session() as persist_session:
                assistant_embedding = await embed_chat_text(final_result)
                assistant_msg = Message(
                    conversation_id=conversation_id,
                    role="assistant",
                    content=final_result,
                    type="chat",
                    embedding=assistant_embedding,
                    sources_cited=sources_cited,
                    ragas_metrics=initial_ragas,
                )
                persist_session.add(assistant_msg)
                await persist_session.commit()
                await persist_session.refresh(assistant_msg)

                if ragas_eval_queued:
                    run_ragas_evaluation_task.delay(
                        assistant_msg.id,
                        body.content,
                        final_result,
                        rag_contexts,
                    )

                if citation_ids:
                    await persist_session.execute(
                        update(Citation)
                        .where(Citation.message_id.is_(None))
                        .where(Citation.citation_id.in_(citation_ids))
                        .values(message_id=assistant_msg.id)
                    )
                    await persist_session.commit()

                new_title = await maybe_generate_conversation_title(
                    persist_session,
                    conversation_id,
                    body.content,
                    final_result,
                )
                
                if new_title:
                    event_id += 1
                    title_payload = {
                        "type": "conversation_title",
                        "conversation_id": conversation_id,
                        "title": new_title,
                    }
                    yield f"id: {event_id}\ndata: {json.dumps(title_payload, default=str)}\n\n"
               

                # Yield assistant message
                event_id += 1
                assistant_msg_payload = {
                    "type": "message",
                    "message": {
                        "id": assistant_msg.id,
                        "conversation_id": conversation_id,
                        "role": "assistant",
                        "content": final_result,
                        "type": "chat",
                        "sources_cited": sources_cited,
                        "created_at": assistant_msg.created_at.isoformat(),
                        "ragas_metrics": assistant_msg.ragas_metrics,
                    },
                }
                yield f"id: {event_id}\ndata: {json.dumps(assistant_msg_payload, default=str)}\n\n"

                # Yield done event
                event_id += 1
                done_payload = {
                    "type": "done",
                    "message_id": assistant_msg.id,
                    "ragas_eval_queued": ragas_eval_queued,
                }
                yield f"id: {event_id}\ndata: {json.dumps(done_payload)}\n\n"
     
        except Exception as e:
            event_id += 1
            yield f"id: {event_id}\\ndata: {json.dumps({'type': 'error', 'error': str(e)})}\\n\\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
