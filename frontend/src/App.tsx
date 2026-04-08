import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { ChatSidebar } from "./components/ChatSidebar";
import { CitationsPanel } from "./components/CitationsPanel";
import { ChatWindow } from "./components/ChatWindow";
import { DocumentsPanel } from "./components/DocumentsPanel";
import { PdfPageModal } from "./components/PdfPageModal";
import { TooltipProvider } from "./components/ui/tooltip";
import {
	LAYOUT_DEFAULT_LEFT,
	LAYOUT_DEFAULT_RIGHT,
	LAYOUT_LEFT_MAX,
	LAYOUT_LEFT_MIN,
	LAYOUT_RIGHT_MAX,
	LAYOUT_RIGHT_MIN,
	LAYOUT_SOURCES_WIDTH,
} from "./constants";
import { useConversations } from "./hooks/use-conversations";
import { useDocuments } from "./hooks/use-document";
import { useMessages } from "./hooks/use-messages";
import * as api from "./lib/api";
import type { Citation, Message } from "./types";

export default function App() {
	const {
		conversations,
		selectedId,
		loading: conversationsLoading,
		create,
		select,
		remove,
		refresh: refreshConversations,
	} = useConversations();

	const {
		messages,
		loading: messagesLoading,
		error: messagesError,
		streaming,
		streamingContent,
		agentStatus,
		citations,
		send,
	} = useMessages(selectedId, refreshConversations);

	const {
		documents,
		upload,
		remove: removeDoc,
		reprocess,
	} = useDocuments(selectedId);

	const [sourcesOpen, setSourcesOpen] = useState(false);
	const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
	const [panelCitations, setPanelCitations] = useState<Citation[] | null>(null);
	const [pdfModal, setPdfModal] = useState<{
		documentId: string;
		pageNumber: number;
		filename: string;
	} | null>(null);
	const [leftWidth, setLeftWidth] = useState(LAYOUT_DEFAULT_LEFT);
	const [rightWidth, setRightWidth] = useState(LAYOUT_DEFAULT_RIGHT);
	const [rightCollapsed, setRightCollapsed] = useState(false);
	const pendingRouteIdRef = useRef<string | null>(null);

	useEffect(() => {
		const fromPath = () => {
			const match = window.location.pathname.match(/^\/chat\/([^/]+)$/);
			const rawId = match?.[1];
			return rawId ? decodeURIComponent(rawId) : null;
		};

		const routeId = fromPath();
		if (routeId) {
			pendingRouteIdRef.current = routeId;
		}

		const onPopState = () => {
			const id = fromPath();
			select(id);
		};
		window.addEventListener("popstate", onPopState);
		return () => window.removeEventListener("popstate", onPopState);
	}, [select]);

	useEffect(() => {
		if (!pendingRouteIdRef.current || conversations.length === 0) return;
		const routeId = pendingRouteIdRef.current;
		const exists = conversations.some((c) => c.id === routeId);
		select(exists ? routeId : null);
		pendingRouteIdRef.current = null;
	}, [conversations, select]);

	useEffect(() => {
		const path = selectedId
			? `/chat/${encodeURIComponent(selectedId)}`
			: "/";
		if (window.location.pathname !== path) {
			window.history.pushState({}, "", path);
		}
	}, [selectedId]);

	useEffect(() => {
		setSourcesOpen(false);
		setSelectedCitationId(null);
		setPanelCitations(null);
	}, [selectedId]);

	useEffect(() => {
		if (!selectedCitationId) return;
		const timer = window.setTimeout(() => {
			setSelectedCitationId(null);
		}, 1800);
		return () => window.clearTimeout(timer);
	}, [selectedCitationId]);

	const handleSend = useCallback(
		async (content: string) => {
			await send(content);
			refreshConversations();
		},
		[send, refreshConversations],
	);

	const handleUpload = useCallback(
		async (file: File) => {
			setRightCollapsed(false);
			await upload(file);
			refreshConversations();
		},
		[upload, refreshConversations],
	);

	const handleCreate = useCallback(async () => {
		await create();
	}, [create]);

	const handleOpenSourcesPanel = useCallback(
		(list: Citation[]) => {
			setRightCollapsed(true);
			setSourcesOpen(true);
			const resolved = list.length > 0 ? list : citations;
			setPanelCitations([...resolved]);
			setSelectedCitationId(resolved[0]?.citation_id ?? null);
		},
		[citations],
	);

	const handleCitationClick = useCallback(
		async (
			citation: Citation,
			messageId: string | null,
			messageCitations: Citation[],
		) => {
			setRightCollapsed(true);
			setSourcesOpen(true);

			let list: Citation[] = messageCitations;
			if (messageId && selectedId) {
				try {
					const fromDb = await api.fetchMessageCitations(selectedId, messageId);
					if (fromDb.length > 0) {
						list = fromDb;
					}
				} catch {
					if (list.length === 0) {
						try {
							const msgs = await api.fetchMessages(selectedId);
							const m = msgs.find((x: Message) => x.id === messageId);
							if (m?.citations?.length) list = m.citations;
						} catch {
							// fallback below
						}
					}
				}
			}
			if (list.length === 0) list = citations;

			setPanelCitations([...list]);
			setSelectedCitationId(citation.citation_id);
		},
		[citations, selectedId],
	);

	const handleViewPage = useCallback(
		(citation: Citation) => {
			if (citation.type === "document") {
				const doc = documents.find((d) =>
					citation.path.includes(d.filename),
				);
				if (doc) {
					const page = citation.page_num ?? 1;
					setPdfModal({
						documentId: doc.id,
						pageNumber: Math.max(1, page),
						filename: doc.filename,
					});
				}
			} else if (citation.type === "web") {
				window.open(citation.path, "_blank");
			}
		},
		[documents],
	);

	const startResize = useCallback((side: "left" | "right") => {
		const onMove = (e: MouseEvent) => {
			if (side === "left") {
				const next = Math.min(LAYOUT_LEFT_MAX, Math.max(LAYOUT_LEFT_MIN, e.clientX));
				setLeftWidth(next);
				return;
			}
			const next = Math.min(
				LAYOUT_RIGHT_MAX,
				Math.max(LAYOUT_RIGHT_MIN, window.innerWidth - e.clientX),
			);
			setRightWidth(next);
		};
		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};

		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	}, []);

	return (
		<TooltipProvider delayDuration={200}>
			<div className="flex h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/40">
				<div style={{ width: `${leftWidth}px` }} className="h-full flex-shrink-0">
					<ChatSidebar
						conversations={conversations}
						selectedId={selectedId}
						loading={conversationsLoading}
						onSelect={select}
						onCreate={handleCreate}
						onDelete={remove}
					/>
				</div>
				<div
					className="h-full w-px cursor-col-resize bg-slate-200/70 transition-colors hover:bg-indigo-200/80"
					onMouseDown={() => startResize("left")}
				/>
				<div className="flex h-full min-w-0 flex-1">
					<ChatWindow
						messages={messages}
						loading={messagesLoading}
						error={messagesError}
						streaming={streaming}
						streamingContent={streamingContent}
						agentStatus={agentStatus}
						citations={citations}
						hasDocuments={documents.length > 0}
						conversationId={selectedId}
						onSend={handleSend}
						onUpload={handleUpload}
						onCitationClick={handleCitationClick}
						onOpenSourcesPanel={handleOpenSourcesPanel}
					/>
				</div>

				{selectedId && (
					<>
						{sourcesOpen && (
							<div
								style={{ width: `${LAYOUT_SOURCES_WIDTH}px` }}
								className="flex h-full flex-shrink-0 flex-col border-l border-slate-200/80 bg-white/95 shadow-[inset_1px_0_0_0_rgba(241,245,249,0.9)] backdrop-blur-md"
							>
								<CitationsPanel
									citations={panelCitations ?? citations}
									onClose={() => {
										setSourcesOpen(false);
										setPanelCitations(null);
									}}
									onViewPage={handleViewPage}
									selectedCitationId={selectedCitationId}
								/>
							</div>
						)}
						<div
							className={`h-full w-px flex-shrink-0 bg-slate-200/80 transition-colors ${
								rightCollapsed ? "" : "cursor-col-resize hover:bg-indigo-200/90"
							}`}
							onMouseDown={rightCollapsed ? undefined : () => startResize("right")}
						/>
						{rightCollapsed ? (
							<div className="flex h-full w-8 flex-shrink-0 items-start justify-center border-l border-slate-200/60 bg-white/95 pt-2 backdrop-blur-md">
								<button
									type="button"
									className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200/90 bg-white text-slate-500 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/60 hover:text-indigo-700"
									onClick={() => setRightCollapsed(false)}
									title="Expand documents sidebar"
								>
									<ChevronLeft className="h-3.5 w-3.5" />
								</button>
							</div>
						) : (
							<div
								style={{ width: `${rightWidth}px` }}
								className="flex h-full flex-shrink-0 flex-col border-l border-slate-200/80 bg-white/95 shadow-[inset_1px_0_0_0_rgba(241,245,249,0.9)] backdrop-blur-md"
							>
								<div className="flex h-10 items-center justify-between px-2.5">
									<span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold tracking-tight text-slate-700">
										<span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
											<FileText className="h-3 w-3" strokeWidth={2} />
										</span>
										<span className="truncate">Documents ({documents.length})</span>
									</span>
									<button
										type="button"
										className="flex h-6 w-6 items-center justify-center rounded-lg border border-slate-200/90 bg-white text-slate-500 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/60 hover:text-indigo-700"
										onClick={() => setRightCollapsed(true)}
										title="Collapse documents sidebar"
									>
										<ChevronRight className="h-3.5 w-3.5" />
									</button>
								</div>
								<div className="h-px w-full flex-shrink-0 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
								<div className="min-h-0 flex-1">
									<DocumentsPanel
										documents={documents}
										onDelete={removeDoc}
										onReprocess={reprocess}
									/>
								</div>
							</div>
						)}
					</>
				)}

				{pdfModal && (
					<PdfPageModal
						key={`${pdfModal.documentId}-${pdfModal.pageNumber}`}
						documentId={pdfModal.documentId}
						pageNumber={pdfModal.pageNumber}
						filename={pdfModal.filename}
						onClose={() => setPdfModal(null)}
					/>
				)}
			</div>
		</TooltipProvider>
	);
}
