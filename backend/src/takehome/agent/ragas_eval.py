from __future__ import annotations

import math
import os
import threading
from typing import Any

import structlog
from celery import shared_task
from sqlalchemy import create_engine, update
from sqlalchemy.orm import sessionmaker

from takehome.config import settings
from takehome.db.models import Message

MAX_CONTEXT_CHUNKS = 24
MAX_CONTEXT_CHARS = 6000
MAX_USER_CHARS = 8000
MAX_ANSWER_CHARS = 12000

logger = structlog.get_logger()

_sync_lock = threading.Lock()
_sync_session_factory: sessionmaker | None = None


def _session_factory() -> sessionmaker:

    global _sync_session_factory
    with _sync_lock:
        if _sync_session_factory is None:
            engine = create_engine(
                settings.database_url_sync,
                echo=False,
                pool_pre_ping=True,
            )
            _sync_session_factory = sessionmaker(bind=engine)
    return _sync_session_factory


@shared_task
def run_ragas_evaluation_task(
    message_id: str,
    user_query: str,
    assistant_answer: str,
    contexts: list[str],
) -> None:

    SessionLocal = _session_factory()

    try:
        scores = run_ragas_four_metrics(
            user_input=user_query,
            response=assistant_answer,
            retrieved_contexts=list(contexts),
        )
        payload: dict = {"status": "complete", **scores}
    except Exception as e:
        logger.exception("ragas_evaluation_failed", message_id=message_id)
        payload = {
            "status": "failed",
            "error": str(e).replace("\n", " ")[:800],
        }

    persist_error: Exception | None = None
    for attempt in range(2):
        try:
            with SessionLocal() as session:
                session.execute(
                    update(Message)
                    .where(Message.id == message_id)
                    .values(ragas_metrics=payload),
                )
                session.commit()
            return
        except Exception as exc:
            persist_error = exc
            logger.exception(
                "ragas_metrics_persist_failed",
                message_id=message_id,
                attempt=attempt,
            )

    try:
        with SessionLocal() as session:
            session.execute(
                update(Message)
                .where(Message.id == message_id)
                .values(
                    ragas_metrics={
                        "status": "failed",
                        "error": "Could not persist RAGAS metrics after retries",
                    },
                ),
            )
            session.commit()
        return
    except Exception:
        logger.exception("ragas_metrics_terminal_marker_failed", message_id=message_id)

    if persist_error:
        raise persist_error


def extract_contexts_from_graph_results(results: dict[str, dict[str, Any]]) -> list[str]:

    seen_prefixes: set[str] = set()
    out: list[str] = []
    for _var, res in results.items():
        for cref in res.get("citations") or []:
            if not isinstance(cref, dict):
                continue
            snip = str(cref.get("snippet") or "").strip()
            if len(snip) < 12:
                continue
            key = snip[:240]
            if key in seen_prefixes:
                continue
            seen_prefixes.add(key)
            out.append(snip[:MAX_CONTEXT_CHARS])
            if len(out) >= MAX_CONTEXT_CHUNKS:
                return out
    return out


def _coerce_json_float(value: Any) -> float | None:
    
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(x):
        return None
    return x


def _normalize_scores(raw: dict[str, Any]) -> dict[str, float | None]:

    out: dict[str, float | None] = {
        "faithfulness": None,
        "answer_relevancy": None,
        "context_precision": None,
        "context_recall": None,
    }
    for k, v in raw.items():
        key_lower = str(k).lower()
        target: str | None = None
        if "faithfulness" in key_lower and "multi" not in key_lower:
            target = "faithfulness"
        elif "relevancy" in key_lower or "relevance" in key_lower:
            target = "answer_relevancy"
        elif "precision" in key_lower:
            target = "context_precision"
        elif "recall" in key_lower and "entity" not in key_lower:
            target = "context_recall"
        if target is None:
            continue
        coerced = _coerce_json_float(v)
        if coerced is not None:
            out[target] = coerced
    return out


def run_ragas_four_metrics(
    *,
    user_input: str,
    response: str,
    retrieved_contexts: list[str],
) -> dict[str, Any]:
    """
    Run RAGAS metrics in-process (blocking). Intended for Celery worker.

    Returns metric fields (no ``status`` wrapper).
    """
    if not settings.openai_api_key and not os.environ.get("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set; cannot run RAGAS")

    ui = user_input.strip()[:MAX_USER_CHARS]
    resp = response.strip()[:MAX_ANSWER_CHARS]
    ctxs = [c[:MAX_CONTEXT_CHARS] for c in retrieved_contexts if c and str(c).strip()]

    if not ctxs:
        raise ValueError("No retrieved contexts")

    reference = resp

    from langchain_openai import ChatOpenAI
    from openai import OpenAI
    from ragas import EvaluationDataset, evaluate
    from ragas.embeddings import OpenAIEmbeddings as RagasOpenAIEmbeddings
    from ragas.llms import LangchainLLMWrapper
    from ragas.metrics import (
        Faithfulness,
        LLMContextPrecisionWithReference,
        LLMContextRecall,
        ResponseRelevancy,
    )

    llm = ChatOpenAI(model=settings.llm_model, temperature=0)
    evaluator_llm = LangchainLLMWrapper(llm)
    embeddings = RagasOpenAIEmbeddings(client=OpenAI())

    dataset = EvaluationDataset.from_list(
        [
            {
                "user_input": ui,
                "response": resp,
                "retrieved_contexts": ctxs,
                "reference": reference,
            },
        ],
    )

    metrics = [
        Faithfulness(),
        ResponseRelevancy(),
        LLMContextPrecisionWithReference(),
        LLMContextRecall(),
    ]

    eval_kwargs: dict[str, Any] = {
        "dataset": dataset,
        "metrics": metrics,
        "llm": evaluator_llm,
        "embeddings": embeddings,
        "show_progress": False,
    }
    try:
        # Celery runs sync tasks; nest_asyncio (RAGAS default) conflicts with worker event loops.
        eval_result = evaluate(**eval_kwargs, allow_nest_asyncio=False)
    except TypeError:
        eval_result = evaluate(**eval_kwargs)

    scores_list = getattr(eval_result, "scores", None) or []
    if not scores_list:
        raise RuntimeError("RAGAS evaluate() returned no score rows")
    first_row = scores_list[0]
    if not isinstance(first_row, dict):
        raise RuntimeError("RAGAS score row is not a dict")
    raw_row: dict[str, Any] = dict(first_row)
    normalized = _normalize_scores(raw_row)

    return {
        "faithfulness": normalized["faithfulness"],
        "answer_relevancy": normalized["answer_relevancy"],
        "context_precision": normalized["context_precision"],
        "context_recall": normalized["context_recall"],
        "reference_mode": "assistant_answer_pseudo",
        "context_chunks_used": len(ctxs),
    }
