"""Shared helpers for the agent graph (formatting, token counts, embeddings, UI strings)."""

from __future__ import annotations

import tiktoken
import structlog
from langchain_openai import OpenAIEmbeddings

from takehome.config import settings

logger = structlog.get_logger()

_embed_service: OpenAIEmbeddings | None = None


def _openai_embeddings() -> OpenAIEmbeddings:
    global _embed_service
    if _embed_service is None:
        _embed_service = OpenAIEmbeddings(model=settings.embedding_model)
    return _embed_service


async def embed_chat_text(text: str) -> list[float] | None:
    """Vector for `messages.embedding` (e.g. HistorySearch). Empty input or failures → None."""
    stripped = (text or "").strip()
    if not stripped:
        return None
    try:
        return await _openai_embeddings().aembed_query(stripped)
    except Exception:
        logger.exception("embed_chat_text_failed", content_chars=len(stripped))
        return None


def count_tokens(text: str) -> int:
    enc = tiktoken.encoding_for_model("gpt-4o")
    return len(enc.encode(text))


def history_to_text(history: list[dict[str, str]]) -> str:
    return "\n".join(f"{m['role']}: {m['content']}" for m in history)


def human_tool_phase(tool: str) -> str:
    return {
        "VectorSearch": "Searching documents",
        "WebSearch": "Searching the web",
        "HistorySearch": "Checking chat history",
        "LLM": "Reasoning",
    }.get(tool, "Working")


def short_tool_result(tool: str, citation_count: int) -> str:

    if tool == "VectorSearch":
        if citation_count == 0:
            return "No matches"
        return f"{citation_count} hit{'s' if citation_count != 1 else ''}"
    if tool == "WebSearch":
        if citation_count == 0:
            return "No results"
        return f"{citation_count} result{'s' if citation_count != 1 else ''}"
    if tool == "HistorySearch":
        if citation_count == 0:
            return "Nothing relevant"
        return f"{citation_count} excerpt{'s' if citation_count != 1 else ''}"
    if tool == "LLM":
        return "Done"
    return "Done"


def format_agent_elapsed(seconds: float) -> str:
    
    if seconds < 1:
        return f"{max(1, int(seconds * 1000))} ms"
    return f"{seconds:.1f} s"
