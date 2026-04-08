from __future__ import annotations

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from langchain_openai import ChatOpenAI

from takehome.agent import build_graph
from takehome.agent.prompts import TITLE_PROMPT
from takehome.config import settings
from takehome.db.models import Conversation

logger = structlog.get_logger()

DEFAULT_CONVERSATION_TITLE = "New Conversation"


async def create_conversation(session: AsyncSession) -> Conversation:

    conversation = Conversation()
    session.add(conversation)
    await session.commit()
    await session.refresh(conversation)
    return conversation


async def initialize_graph_thread_state(
    conversation_id: str, checkpointer: object | None
) -> None:

    if checkpointer is None:
        return
    try:
        graph = build_graph(checkpointer)
        config = {"configurable": {"thread_id": conversation_id}}
        initial_state = {
            "query": "",
            "conversation_id": conversation_id,
            "task": "",
            "query_type": "",
            "steps": [],
            "results": {},
            "current_step_index": 0,
            "last_tool_error": None,
            "iteration": 0,
            "result": "",
            "chat_history": [],
            "summarized_history": "",
        }
        await graph.aupdate_state(config, initial_state)
    except Exception:
        logger.exception(
            "Failed to initialize LangGraph thread state (non-fatal)",
            conversation_id=conversation_id,
        )


async def list_conversations(session: AsyncSession) -> list[Conversation]:

    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.documents))
        .order_by(Conversation.updated_at.desc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_conversation(session: AsyncSession, conversation_id: str) -> Conversation | None:

    stmt = (
        select(Conversation)
        .options(selectinload(Conversation.documents))
        .where(Conversation.id == conversation_id)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none()

async def maybe_generate_conversation_title(
    session: AsyncSession,
    conversation_id: str,
    user_message: str,
    assistant_reply: str,
) -> str | None:

    stmt = select(Conversation).where(Conversation.id == conversation_id)
    result = await session.execute(stmt)
    conversation = result.scalar_one_or_none()
    if conversation is None or conversation.title != DEFAULT_CONVERSATION_TITLE:
        return None

    excerpt = (assistant_reply or "").strip()
    if len(excerpt) > 600:
        excerpt = excerpt[:600] + "…"
    context = f"User question:\n{user_message.strip()}\n\nAssistant answer (excerpt):\n{excerpt or '(empty)'}"

    try:
        llm = ChatOpenAI(model=settings.llm_model, temperature=0)
        prompt = TITLE_PROMPT.format(message=context)
        response = await llm.ainvoke(prompt)
        raw = str(response.content).strip()
        title = raw.splitlines()[0].strip() if raw else ""
        title = title.strip("\"'")
        if not title:
            return None
        if len(title) > 120:
            title = title[:117] + "…"
        conversation.title = title
        await session.commit()
        await session.refresh(conversation)
        return title
    except Exception:
        logger.exception(
            "Failed to generate conversation title (non-fatal)",
            conversation_id=conversation_id,
        )
        return None


async def update_conversation(
    session: AsyncSession, conversation_id: str, title: str
) -> Conversation | None:

    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        return None
    conversation.title = title
    await session.commit()
    await session.refresh(conversation)
    return conversation


async def delete_conversation(session: AsyncSession, conversation_id: str) -> bool:

    stmt = select(Conversation).where(Conversation.id == conversation_id)
    result = await session.execute(stmt)
    conversation = result.scalar_one_or_none()
    if conversation is None:
        return False
    await session.delete(conversation)
    await session.commit()
    return True
