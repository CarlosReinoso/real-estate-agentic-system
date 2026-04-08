import {
	ChevronLeft,
	ChevronRight,
	CircleCheck,
	FileText,
	LoaderCircle,
	RefreshCw,
	Trash2,
	XCircle,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Document as PdfDocument, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import type { Document } from "../types";
import { getDocumentUrl } from "../lib/api";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface DocumentsPanelProps {
	documents: Document[];
	onDelete: (documentId: string) => void;
	onReprocess: (documentId: string) => void;
}

const STATUS_RING: Record<string, string> = {
	uploading: "bg-amber-50 text-amber-600 ring-amber-200/60",
	parsing: "bg-sky-50 text-sky-600 ring-sky-200/50",
	chunking: "bg-indigo-50 text-indigo-600 ring-indigo-200/50",
	indexing: "bg-violet-50 text-violet-600 ring-violet-200/50",
	processing: "bg-blue-50 text-blue-600 ring-blue-200/50",
	ready: "bg-emerald-50 text-emerald-600 ring-emerald-200/50",
	failed: "bg-rose-50 text-rose-600 ring-rose-200/50",
};

const STATUS_TEXT: Record<string, string> = {
	uploading: "Uploading",
	parsing: "Parsing",
	chunking: "Chunking",
	indexing: "Indexing",
	processing: "Processing",
};

const STATUS_TITLE: Record<string, string> = {
	...STATUS_TEXT,
	ready: "Ready",
	failed: "Failed",
};

function StatusIcon({ status }: { status: string }) {
	const ring = STATUS_RING[status] || "bg-neutral-100 text-neutral-500 ring-neutral-200/60";
	if (status === "failed") {
		return (
			<span
				className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${ring}`}
			>
				<XCircle className="h-3 w-3" strokeWidth={2} />
			</span>
		);
	}
	if (status === "ready") {
		return (
			<span
				className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${ring}`}
			>
				<CircleCheck className="h-3 w-3" strokeWidth={2} />
			</span>
		);
	}
	return (
		<span
			className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${ring}`}
		>
			<LoaderCircle className="h-3 w-3 animate-spin" strokeWidth={2} />
		</span>
	);
}

function MetaPill({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex items-center rounded-md bg-slate-100/90 px-1.5 py-px text-[9px] font-medium tabular-nums text-slate-600">
			{children}
		</span>
	);
}

export function DocumentsPanel({
	documents,
	onDelete,
	onReprocess,
}: DocumentsPanelProps) {
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const [previewPage, setPreviewPage] = useState<Record<string, number>>({});
	const [previewTotalPages, setPreviewTotalPages] = useState<Record<string, number>>({});

	const formatSize = (bytes: number) => {
		if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${bytes} B`;
	};

	const getStatusLabel = (status: string) => STATUS_TEXT[status] || "Processing";
	const getStatusTitle = (status: string) => STATUS_TITLE[status] || getStatusLabel(status);
	const isInProgressStatus = (status: string) =>
		status === "uploading" ||
		status === "parsing" ||
		status === "chunking" ||
		status === "indexing" ||
		status === "processing";

	const isTerminalStatus = (status: string) => status === "ready" || status === "failed";

	return (
		<div className="flex h-full flex-col">
			<ScrollArea className="flex-1 [scrollbar-gutter:stable]">
				{documents.length === 0 ? (
					<div className="flex h-full min-h-[100px] items-center justify-center px-3 py-4">
						<div className="max-w-[200px] text-center">
							<div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-100 to-violet-50 shadow-inner ring-1 ring-indigo-200/50">
								<FileText className="h-3.5 w-3.5 text-indigo-500" strokeWidth={1.5} />
							</div>
							<p className="text-[11px] font-semibold text-slate-800">No documents yet</p>
							<p className="mt-0.5 text-[10px] leading-snug text-slate-500">
								Upload a PDF to ask about it.
							</p>
						</div>
					</div>
				) : (
					<div className="space-y-1.5 pl-2 pr-0 pb-2 pt-1">
						{documents.map((doc) => {
							const sizeBytes = doc.file_size_bytes;
							const sizeLabel =
								isTerminalStatus(doc.status) && sizeBytes != null && sizeBytes > 0
									? formatSize(sizeBytes)
									: "";
							return (
								<div
									key={doc.id}
									className="group/card overflow-hidden rounded-xl border border-slate-200/85 bg-white/95 shadow-sm ring-1 ring-slate-100/60 transition-all duration-200 hover:border-indigo-200/70 hover:shadow-md hover:shadow-indigo-500/5 hover:ring-indigo-100/40"
								>
									<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 px-2 py-1.5">
										<button
											type="button"
											className="flex min-w-0 items-center gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40 focus-visible:ring-offset-1 rounded-md -m-px p-px"
											onClick={() =>
												setExpanded((prev) => ({ ...prev, [doc.id]: !prev[doc.id] }))
											}
										>
											<span title={getStatusTitle(doc.status)} className="shrink-0">
												<StatusIcon status={doc.status} />
											</span>
											<div className="min-w-0 flex-1">
												<p className="truncate text-[11px] font-medium leading-tight text-neutral-800">
													{doc.filename}
												</p>
												<div className="mt-0.5 flex flex-wrap items-center gap-1">
													{isInProgressStatus(doc.status) ? (
														<span className="text-[9px] font-medium text-neutral-500">
															{getStatusLabel(doc.status)}
															<span className="ml-0.5 inline-flex translate-y-px">
																<span className="animate-pulse">·</span>
																<span className="animate-pulse [animation-delay:150ms]">·</span>
																<span className="animate-pulse [animation-delay:300ms]">·</span>
															</span>
														</span>
													) : (
														<MetaPill>
															{doc.total_pages || doc.page_count || 0}{" "}
															{(doc.total_pages || doc.page_count) === 1 ? "page" : "pages"}
														</MetaPill>
													)}
													{sizeLabel ? <MetaPill>{sizeLabel}</MetaPill> : null}
												</div>
											</div>
										</button>

										<div className="flex shrink-0 items-center gap-px pr-px">
											{doc.status === "failed" && (
												<Button
													variant="ghost"
													size="icon"
													className="h-6 w-6 rounded-md text-neutral-500 opacity-80 transition-colors hover:bg-amber-50 hover:text-amber-700 hover:opacity-100"
													onClick={(e) => {
														e.stopPropagation();
														onReprocess(doc.id);
													}}
													title="Reprocess document"
												>
													<RefreshCw className="h-3 w-3" strokeWidth={2} />
												</Button>
											)}
											<Button
												variant="ghost"
												size="icon"
												className="h-6 w-6 rounded-md text-neutral-400 opacity-80 transition-colors hover:bg-rose-50 hover:text-rose-600 hover:opacity-100"
												onClick={(e) => {
													e.stopPropagation();
													onDelete(doc.id);
												}}
												title="Delete document"
											>
												<Trash2 className="h-3 w-3" strokeWidth={2} />
											</Button>
										</div>
									</div>

									{expanded[doc.id] && (
										<div className="border-t border-neutral-100 bg-gradient-to-b from-neutral-50/80 to-neutral-50 px-2 pb-2 pt-1.5">
											<div className="mb-1 flex items-center justify-between gap-1.5">
												<span className="text-[9px] font-medium uppercase tracking-wide text-neutral-400">
													Preview
												</span>
												<div className="flex items-center gap-0.5 rounded-md bg-white/80 px-0.5 py-px shadow-sm ring-1 ring-neutral-200/60">
													<Button
														variant="ghost"
														size="icon"
														className="h-5 w-5 rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
														disabled={(previewPage[doc.id] || 1) <= 1}
														onClick={() =>
															setPreviewPage((prev) => ({
																...prev,
																[doc.id]: Math.max(1, (prev[doc.id] || 1) - 1),
															}))
														}
														title="Previous page"
													>
														<ChevronLeft className="h-3 w-3" />
													</Button>
													<span className="min-w-[3.25rem] text-center text-[9px] font-medium tabular-nums text-neutral-600">
														{previewPage[doc.id] || 1}
														{(previewTotalPages[doc.id] || doc.total_pages) ? (
															<span className="text-neutral-400">
																{" "}
																/ {previewTotalPages[doc.id] || doc.total_pages}
															</span>
														) : null}
													</span>
													<Button
														variant="ghost"
														size="icon"
														className="h-5 w-5 rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
														disabled={
															Boolean(previewTotalPages[doc.id] || doc.total_pages) &&
															(previewPage[doc.id] || 1) >=
																(previewTotalPages[doc.id] || doc.total_pages || 1)
														}
														onClick={() =>
															setPreviewPage((prev) => ({
																...prev,
																[doc.id]:
																	(previewTotalPages[doc.id] || doc.total_pages) != null
																		? Math.min(
																				previewTotalPages[doc.id] || doc.total_pages || 1,
																				(prev[doc.id] || 1) + 1,
																			)
																		: (prev[doc.id] || 1) + 1,
															}))
														}
														title="Next page"
													>
														<ChevronRight className="h-3 w-3" />
													</Button>
												</div>
											</div>
											<div className="overflow-hidden rounded-md bg-white shadow-inner ring-1 ring-neutral-200/70">
												<div className="flex max-h-[200px] w-full items-start justify-center overflow-y-auto overflow-x-hidden bg-gradient-to-b from-neutral-100/40 to-neutral-50/80 p-1.5 [scrollbar-gutter:stable]">
													<PdfDocument
														file={getDocumentUrl(doc.id)}
														onLoadSuccess={({ numPages }) => {
															setPreviewTotalPages((prev) => ({
																...prev,
																[doc.id]: numPages,
															}));
															setPreviewPage((prev) => ({
																...prev,
																[doc.id]: Math.min(prev[doc.id] || 1, numPages),
															}));
														}}
														loading={
															<span className="py-5 text-[10px] text-neutral-400">
																Loading…
															</span>
														}
														error={
															<span className="py-5 text-[10px] text-rose-600/90">
																Unavailable
															</span>
														}
													>
														<Page pageNumber={previewPage[doc.id] || 1} width={168} />
													</PdfDocument>
												</div>
											</div>
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</ScrollArea>
		</div>
	);
}
