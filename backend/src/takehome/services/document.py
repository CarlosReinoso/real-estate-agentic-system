from __future__ import annotations

import os
import uuid

import structlog
import tiktoken
from celery import Celery, shared_task
from docling.document_converter import DocumentConverter
from docling_core.transforms.chunker.tokenizer.openai import OpenAITokenizer
from langchain_core.documents import Document as LCDocument
from langchain_openai import OpenAIEmbeddings
from langchain_postgres import PGEngine, PGVectorStore
from fastapi import UploadFile
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from takehome.config import settings
from takehome.db.models import Document

logger = structlog.get_logger()


def document_file_size_bytes(doc: Document) -> int | None:

    if doc.file_size_bytes is not None:
        return doc.file_size_bytes
    if doc.status in ("ready", "failed") and doc.file_path and os.path.exists(doc.file_path):
        try:
            return os.path.getsize(doc.file_path)
        except OSError:
            return None
    return None


celery_app = Celery(
    "takehome",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["takehome.services.document", "takehome.agent.ragas_eval"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
)


# ---------------------------------------------------------------------------
# Async service functions (called from FastAPI endpoints)
# ---------------------------------------------------------------------------


async def upload_document(
    session: AsyncSession, 
    conversation_id: str, 
    file: UploadFile
) -> Document:

    if file.content_type not in ("application/pdf", "application/x-pdf"):
        filename = file.filename or ""
        if not filename.lower().endswith(".pdf"):
            raise ValueError("Only PDF files are supported.")

    content = await file.read()

    if len(content) > settings.max_upload_size:
        raise ValueError(
            f"File too large. Maximum size is {settings.max_upload_size // (1024 * 1024)}MB."
        )

    original_filename = file.filename or "document.pdf"
    unique_name = f"{uuid.uuid4().hex}_{original_filename}"
    file_path = os.path.join(settings.upload_dir, unique_name)

    os.makedirs(settings.upload_dir, exist_ok=True)

    with open(file_path, "wb") as f:
        f.write(content)

    logger.info("Saved uploaded PDF", filename=original_filename, path=file_path, size=len(content))

    document = Document(
        conversation_id=conversation_id,
        filename=original_filename,
        file_path=file_path,
        status="uploading",
        file_size_bytes=len(content),
    )

    session.add(document)
    await session.commit()
    await session.refresh(document)

    process_document.delay(document.id)

    return document


async def get_document(session: AsyncSession, document_id: str) -> Document | None:

    stmt = select(Document).where(Document.id == document_id)
    result = await session.execute(stmt)

    return result.scalar_one_or_none()


async def get_document_for_conversation(
    session: AsyncSession, 
    conversation_id: str
) -> Document | None:

    stmt = select(Document).where(Document.conversation_id == conversation_id)
    result = await session.execute(stmt)

    return result.scalar_one_or_none()


async def get_documents_for_conversation(
    session: AsyncSession, conversation_id: str
) -> list[Document]:

    stmt = (
        select(Document)
        .where(Document.conversation_id == conversation_id)
        .order_by(Document.uploaded_at.asc())
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def delete_document(session: AsyncSession, document_id: str) -> bool:

    doc = await get_document(session, document_id)
    if doc is None:
        return False

    await session.execute(
        text("DELETE FROM document_chunks WHERE document_id = :document_id"),
        {"document_id": document_id},
    )
    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    await session.delete(doc)
    await session.commit()

    return True


# ---------------------------------------------------------------------------
# Celery task: process_document (sync, runs in worker)
# ---------------------------------------------------------------------------


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def process_document(self, document_id: str) -> None:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    def _build_doc_converter() -> DocumentConverter:
        try:
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.pipeline_options import (
                PdfPipelineOptions,
                TesseractCliOcrOptions,
            )
            from docling.document_converter import PdfFormatOption

            pdf_options = PdfPipelineOptions()
            pdf_options.do_ocr = True
            pdf_options.ocr_options = TesseractCliOcrOptions()
            return DocumentConverter(
                format_options={
                    InputFormat.PDF: PdfFormatOption(pipeline_options=pdf_options),
                }
            )
        except Exception:
            logger.warning("Could not enable Docling OCR config; using default converter")
            return DocumentConverter()

    engine = create_engine(settings.database_url_sync, echo=False)
    SessionLocal = sessionmaker(bind=engine)
    session: Session = SessionLocal()
    
    try:
        def _clear_indexed_chunks() -> None:

            session.execute(
                text("DELETE FROM document_chunks WHERE document_id = :document_id"),
                {"document_id": document_id},
            )
            session.commit()

        def _set_status(status: str) -> None:
            doc.status = status
            session.commit()

        doc = session.query(Document).filter(Document.id == document_id).first()
        if doc is None:
            logger.error("Document not found", document_id=document_id)
            return

        _set_status("parsing")

        result = _build_doc_converter().convert(doc.file_path)
        docling_doc = result.document

        page_count = 0
        if hasattr(docling_doc, "pages") and docling_doc.pages:
            page_count = len(docling_doc.pages)

        extracted_text = docling_doc.export_to_markdown()

        from docling.chunking import HybridChunker

        _set_status("chunking")
        openai_tokenizer = OpenAITokenizer(
            tokenizer=tiktoken.encoding_for_model(settings.embedding_model),
            max_tokens=settings.chunk_size,
        )
        chunker = HybridChunker(
            tokenizer=openai_tokenizer,
        )
        chunks = list(chunker.chunk(docling_doc))

        lc_documents: list[LCDocument] = []
        for chunk in chunks:
            chunk_id = uuid.uuid4().hex
            page_number = None
            bbox = None

            if hasattr(chunk, "meta") and chunk.meta:
                if hasattr(chunk.meta, "doc_items") and chunk.meta.doc_items:
                    first_item = chunk.meta.doc_items[0]
                    if hasattr(first_item, "prov") and first_item.prov:
                        prov = first_item.prov[0]
                        page_number = prov.page_no if hasattr(prov, "page_no") else None
                        if hasattr(prov, "bbox"):
                            bbox = {
                                "l": prov.bbox.l,
                                "t": prov.bbox.t,
                                "r": prov.bbox.r,
                                "b": prov.bbox.b,
                            }

            lc_doc = LCDocument(
                page_content=chunk.text,
                metadata={
                    "chunk_id": chunk_id,
                    "document_id": document_id,
                    "page_number": page_number,
                    "bbox": bbox,
                    "source_path": doc.file_path,
                },
            )
            lc_documents.append(lc_doc)


        if lc_documents:
            _set_status("indexing")
            _clear_indexed_chunks()
            pg_engine = PGEngine.from_connection_string(settings.database_url)
            embedding_service = OpenAIEmbeddings(model=settings.embedding_model)
            store = PGVectorStore.create_sync(
                engine=pg_engine,
                table_name="document_chunks",
                embedding_service=embedding_service,
                metadata_columns=[
                    "chunk_id",
                    "document_id",
                    "page_number",
                    "bbox",
                    "source_path",
                ],
            )
            store.add_documents(lc_documents)
        else:
            _set_status("indexing")
            _clear_indexed_chunks()

        doc.extracted_text = extracted_text
        doc.page_count = page_count
        doc.total_pages = page_count
        doc.ocr_done = True
        doc.status = "ready"
        session.commit()

        logger.info(
            "Document processed",
            document_id=document_id,
            chunks=len(lc_documents),
            pages=page_count,
        )

    except Exception as exc:
        session.rollback()
        try:
            doc_refresh = session.query(Document).filter(Document.id == document_id).first()
            retries = getattr(self.request, "retries", 0)
            max_retries = self.max_retries if self.max_retries is not None else 0
            will_retry = retries < max_retries
            if doc_refresh and not will_retry:
                doc_refresh.status = "failed"
                session.commit()
            elif will_retry:
                logger.warning(
                    "Document processing retry scheduled",
                    document_id=document_id,
                    retries=retries,
                    max_retries=max_retries,
                )
        except Exception:
            pass
        logger.exception("Document processing failed", document_id=document_id)
        raise self.retry(exc=exc)
    finally:
        session.close()
        engine.dispose()
