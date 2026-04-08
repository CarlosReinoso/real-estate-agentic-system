from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from takehome.db.session import get_session
from takehome.services.conversation import (
    create_conversation,
    delete_conversation,
    get_conversation,
    initialize_graph_thread_state,
    list_conversations,
    update_conversation,
)
from takehome.services.document import document_file_size_bytes

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


class ConversationListItem(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    has_document: bool

    model_config = {"from_attributes": True}


class DocumentInfo(BaseModel):
    id: str
    filename: str
    page_count: int
    total_pages: int | None = None
    status: str
    uploaded_at: datetime
    file_size_bytes: int | None = None
    model_config = {"from_attributes": True}


class ConversationDetail(BaseModel):
    id: str
    title: str
    created_at: datetime
    updated_at: datetime
    has_document: bool
    documents: list[DocumentInfo] = []

    model_config = {"from_attributes": True}


class ConversationUpdate(BaseModel):
    title: str


@router.get("", response_model=list[ConversationListItem])
async def list_conversations_endpoint(
    session: AsyncSession = Depends(get_session),
) -> list[ConversationListItem]:

    conversations = await list_conversations(session)
    return [
        ConversationListItem(
            id=c.id,
            title=c.title,
            created_at=c.created_at,
            updated_at=c.updated_at,
            has_document=len(c.documents) > 0,
        )
        for c in conversations
    ]


@router.post("", response_model=ConversationDetail, status_code=201)
async def create_conversation_endpoint(
    session: AsyncSession = Depends(get_session),
) -> ConversationDetail:

    conversation = await create_conversation(session)
    from takehome.web.app import app

    checkpointer = getattr(app.state, "checkpointer", None)
    await initialize_graph_thread_state(conversation.id, checkpointer)

    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        has_document=False,
        documents=[],
    )


@router.get("/{conversation_id}", response_model=ConversationDetail)
async def get_conversation_endpoint(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> ConversationDetail:

    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    doc_infos = [
        DocumentInfo(
            id=d.id,
            filename=d.filename,
            page_count=d.page_count,
            total_pages=d.total_pages,
            status=d.status,
            uploaded_at=d.uploaded_at,
            file_size_bytes=document_file_size_bytes(d),
        )
        for d in conversation.documents
    ]

    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        has_document=len(doc_infos) > 0,
        documents=doc_infos,
    )


@router.patch("/{conversation_id}", response_model=ConversationDetail)
async def update_conversation_endpoint(
    conversation_id: str,
    body: ConversationUpdate,
    session: AsyncSession = Depends(get_session),
) -> ConversationDetail:

    conversation = await update_conversation(session, conversation_id, body.title)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    doc_infos = [
        DocumentInfo(
            id=d.id,
            filename=d.filename,
            page_count=d.page_count,
            total_pages=d.total_pages,
            status=d.status,
            uploaded_at=d.uploaded_at,
            file_size_bytes=document_file_size_bytes(d),
        )
        for d in conversation.documents
    ]

    return ConversationDetail(
        id=conversation.id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
        has_document=len(doc_infos) > 0,
        documents=doc_infos,
    )


@router.delete("/{conversation_id}", status_code=204)
async def delete_conversation_endpoint(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:

    deleted = await delete_conversation(session, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
