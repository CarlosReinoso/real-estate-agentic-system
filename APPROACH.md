# Approach: ReWOO + Corrective RAG + HybridChunking Architecture

This is a multi agenti AI system for **Legal/Commercial-Real-Estate Industry**, where answer quality alone is not enough: users also need clear evidence provenance, predictable behavior, and strong operational reliability.  
I chose a **ReWOO-style agent with Corrective RAG and HybridChunking** because this industry routinely requires cross-referencing long documents (leases, reports, due-diligence artifacts) while maintaining traceability and low hallucination risk. I optimized for three outcomes: **grounded answers**, **evidence traceability**, and **production-ready operability**

## Architecture

![Overall Architecture](screen/Overall%20Architecture.png)

### LangGraph Agent Workflow

![LangGraph Agentic Architecture (ReWOO + Corrective RAG)](screen/LangGraph%20Agentic%20Architecture%20%28ReWOO%20%2B%20Corrective%20RAG%29.png)

## How I architected the AI system and why

- **Core pattern:** I implemented a LangGraph ReWOO-style `summarize -> assemble -> classify -> plan -> tool loop -> solve` flow with bounded replan/fallback to keep behavior explicit and debuggable.
- **Simple/complex routing:** I route lightweight turns away from heavy retrieval to control latency/cost, and reserve structured planning/tooling for higher-complexity legal questions.
- **RAG-first tooling:** I treat document retrieval as the primary evidence source, with web/history retrieval as explicit secondary tools when local evidence is insufficient.
- **Evidence integrity:** I canonicalize and persist citations with stable indices, then bind them to final answers so users can audit where each claim came from.
- **Asynchronous evaluation:** I run RAGAS in Celery post-response so users get fast streaming UX while quality signals are computed safely in the background.

### Specific tech stack and methods

| Area | Stack / Method | Why |
|---|---|---|
| API | FastAPI + StreamingResponse (SSE) | low-latency token + status streaming |
| Agent orchestration | LangGraph + Postgres checkpointer | explicit state machine + durability |
| Models | `gpt-4o`, `gpt-4o-mini` | quality on solve, lower-cost utility paths |
| Embeddings | `text-embedding-3-small` (1536d) | consistent vectors for docs/history |
| DB | Postgres + SQLAlchemy async | transactional app data + citations |
| Vector store | PGVector (`document_chunks`) | in-DB dense retrieval |
| OCR / parsing | Docling `DocumentConverter` + Tesseract (`pytesseract`) | CPU-friendly and reliable for local/dev extraction of scanned PDFs; production target is GPU-optimized OCR for higher throughput |
| Chunking | **HybridChunking** (structure-aware + token-aware, `chunk_size=2000`, `chunk_overlap=500`) | preserve legal section boundaries while maintaining retrieval recall |
| Async jobs | Celery + Redis | non-blocking evaluation and heavy background work |
| Evaluation | RAGAS (faithfulness/relevancy/context precision/recall) | post-hoc quality measurement per message |
| Frontend | React + TypeScript + Tailwind + Streamdown | responsive chat UX + markdown/citation rendering |

## RAG architecture (specific)

1. **Ingest:** parse PDF + OCR when needed -> hbridchunking -> embed -> persist in vector database.
2. **Retrieve:** planner calls `VectorSearch` with conversation-scoped filters.
3. **Corrective RAG:** `retrieve -> grade_documents -> transform_query -> retrieve` (max rounds).
4. **Ground answer:** solver receives only completed tool outputs + citation metadata.
5. **Persist provenance:** `build_citations_node` dedups, assigns `citation_index`, stores rows, links to assistant message.

## What I prioritized

| Priority | Implementation |
|---|---|
| Trust / auditability | strict citation pipeline, DB-backed sources, UI source panel |
| UX responsiveness | SSE streaming for content + plan/tool status; async RAGAS |
| Retrieval robustness | corrective RAG loop + explicit tool routing + history embeddings |
| Reliability | bounded retries/rounds, fallback node, durable graph/checkpointer state |

## Interesting problems and how I solved them

I approached the architecture as a sequence of trade-offs rather than one fixed design.

I initially evaluated a **heavier retrieval strategy (LightRAG-style graph retrieval)** to maximize multi-hop answer quality. The quality potential was strong, but for this take-home environment (CPU-first local runtime, fast feedback loops), the latency/complexity overhead was too high for day-to-day iteration speed. I therefore chose a **native RAG baseline (PGVector + corrective loop)** as the production-ready default for this scope, while explicitly keeping LightRAG as a next-step enhancement once more compute and tuning time are available.

I made the same pragmatic decision in document extraction: I used **Docling + Tesseract** because it is stable and performs well on CPU in development, then documented a production path toward **GPU-optimized OCR** to improve ingestion throughput at scale.

In short, I prioritized a system that is **fast enough for real use on CPU, auditable for legal workflows, and structured to evolve toward higher-end retrieval/OCR paths** without re-architecting the full stack.

