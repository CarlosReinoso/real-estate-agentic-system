from __future__ import annotations

import os
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import FileResponse

from takehome.db.session import get_session
from takehome.services.conversation import get_conversation
from takehome.services.document import (
    delete_document,
    document_file_size_bytes,
    get_document,
    get_documents_for_conversation,
    upload_document,
)

logger = structlog.get_logger()

router = APIRouter(tags=["documents"])


class DocumentOut(BaseModel):
    id: str
    conversation_id: str
    filename: str
    page_count: int
    total_pages: int | None = None
    status: str
    ocr_done: bool
    uploaded_at: datetime
    file_size_bytes: int | None = None

    model_config = {"from_attributes": True}


@router.post(
    "/api/conversations/{conversation_id}/documents",
    response_model=DocumentOut,
    status_code=201,
)
async def upload_document_endpoint(
    conversation_id: str,
    file: UploadFile,
    session: AsyncSession = Depends(get_session),
) -> DocumentOut:
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    try:
        document = await upload_document(session, conversation_id, file)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    logger.info(
        "Document uploaded",
        conversation_id=conversation_id,
        document_id=document.id,
        filename=document.filename,
    )

    return DocumentOut(
        id=document.id,
        conversation_id=document.conversation_id,
        filename=document.filename,
        page_count=document.page_count,
        total_pages=document.total_pages,
        status=document.status,
        ocr_done=document.ocr_done,
        uploaded_at=document.uploaded_at,
        file_size_bytes=document_file_size_bytes(document),
    )


@router.get(
    "/api/conversations/{conversation_id}/documents",
    response_model=list[DocumentOut],
)
async def list_documents_endpoint(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[DocumentOut]:
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    documents = await get_documents_for_conversation(session, conversation_id)
    return [
        DocumentOut(
            id=d.id,
            conversation_id=d.conversation_id,
            filename=d.filename,
            page_count=d.page_count,
            total_pages=d.total_pages,
            status=d.status,
            ocr_done=d.ocr_done,
            uploaded_at=d.uploaded_at,
            file_size_bytes=document_file_size_bytes(d),
        )
        for d in documents
    ]


@router.get("/api/documents/{document_id}/status")
async def get_document_status(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str | int | bool | None]:
    document = await get_document(session, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        "status": document.status,
        "page_count": document.page_count,
        "total_pages": document.total_pages,
        "ocr_done": document.ocr_done,
        "file_size_bytes": document_file_size_bytes(document),
    }


@router.post("/api/documents/{document_id}/reprocess", status_code=202)
async def reprocess_document_endpoint(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    document = await get_document(session, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.status not in ("failed",):
        raise HTTPException(status_code=400, detail="Only failed documents can be reprocessed")

    document.status = "uploading"
    await session.commit()

    from takehome.services.document import process_document

    process_document.delay(document_id)
    return {"status": "reprocessing"}


@router.delete(
    "/api/conversations/{conversation_id}/documents/{document_id}",
    status_code=204,
)
async def delete_document_endpoint(
    conversation_id: str,
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:

    document = await get_document(session, document_id)
    if document is None or document.conversation_id != conversation_id:
        raise HTTPException(status_code=404, detail="Document not found")
    deleted = await delete_document(session, document_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")


@router.get("/api/documents/{document_id}/content")
async def serve_document_file(
    document_id: str,
    session: AsyncSession = Depends(get_session),
) -> FileResponse:

    document = await get_document(session, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    if not os.path.exists(document.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(
        path=document.file_path,
        media_type="application/pdf",
        content_disposition_type="inline",
        headers={"Content-Disposition": "inline"},
    )
