import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { getDocumentUrl } from "../lib/api";
import { Button } from "./ui/button";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfPageModalProps {
	documentId: string;
	pageNumber: number;
	filename: string;
	onClose: () => void;
}

export function PdfPageModal({ documentId, pageNumber, filename, onClose }: PdfPageModalProps) {
	const [numPages, setNumPages] = useState<number>(0);
	const [viewPage, setViewPage] = useState(() => Math.max(1, pageNumber));
	const [pageWidth, setPageWidth] = useState(720);
	const [pageInput, setPageInput] = useState(String(Math.max(1, pageNumber)));
	const viewportRef = useRef<HTMLDivElement>(null);
	const url = getDocumentUrl(documentId);

	useEffect(() => {
		setViewPage(Math.max(1, pageNumber));
		setPageInput(String(Math.max(1, pageNumber)));
	}, [pageNumber, documentId]);

	const goPrev = useCallback(() => {
		setViewPage((p: number) => Math.max(1, p - 1));
	}, []);

	const goNext = useCallback(() => {
		setViewPage((p: number) => (numPages > 0 ? Math.min(numPages, p + 1) : p + 1));
	}, [numPages]);

	useEffect(() => {
		setPageInput(String(viewPage));
	}, [viewPage]);

	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		const update = () => {
			const w = el.clientWidth;
			setPageWidth(Math.max(240, w - 32));
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			if (e.key === "ArrowLeft") {
				e.preventDefault();
				goPrev();
				return;
			}
			if (e.key === "ArrowRight") {
				e.preventDefault();
				goNext();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose, goPrev, goNext]);

	const totalLabel = numPages > 0 ? String(numPages) : "…";

	const commitPageInput = () => {
		const n = Number.parseInt(pageInput, 10);
		if (Number.isNaN(n)) {
			setPageInput(String(viewPage));
			return;
		}
		if (numPages > 0) {
			setViewPage(Math.min(Math.max(1, n), numPages));
		} else {
			setViewPage(Math.max(1, n));
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-[2px] sm:p-4"
			role="presentation"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="pdf-modal-title"
				className="flex h-[min(90dvh,880px)] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<header className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2.5 sm:px-4">
					<div className="min-w-0 flex-1">
						<h3 id="pdf-modal-title" className="truncate text-sm font-semibold text-neutral-900">
							{filename}
						</h3>
					</div>
					<div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
						<Button
							variant="outline"
							size="sm"
							className="h-8 px-2"
							disabled={viewPage <= 1}
							onClick={goPrev}
							title="Previous page"
						>
							<ChevronLeft className="h-4 w-4" />
						</Button>
						<div className="flex items-center gap-1 text-xs text-neutral-600">
							<span className="hidden sm:inline">Page</span>
							<input
								className="h-8 w-12 rounded-md border border-neutral-300 bg-white px-1 text-center text-xs tabular-nums shadow-sm outline-none ring-offset-white focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 sm:w-14"
								type="text"
								inputMode="numeric"
								aria-label="Page number"
								value={pageInput}
								onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
								onBlur={commitPageInput}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										commitPageInput();
										(e.target as HTMLInputElement).blur();
									}
								}}
							/>
							<span className="tabular-nums text-neutral-500">/ {totalLabel}</span>
						</div>
						<Button
							variant="outline"
							size="sm"
							className="h-8 px-2"
							disabled={numPages === 0 || viewPage >= numPages}
							onClick={goNext}
							title="Next page"
						>
							<ChevronRight className="h-4 w-4" />
						</Button>
						<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
							<X className="h-4 w-4" />
						</Button>
					</div>
				</header>

				<div
					ref={viewportRef}
					className="min-h-0 flex-1 overflow-auto rounded-b-xl bg-neutral-100"
				>
					<div className="flex justify-center px-2 py-3 sm:px-4 sm:py-5">
						<Document
							file={url}
							onLoadSuccess={({ numPages: n }: { numPages: number }) => {
								setNumPages(n);
								setViewPage((p: number) => Math.min(Math.max(1, p), n));
							}}
							loading={
								<div className="py-16 text-sm text-neutral-500">Loading PDF…</div>
							}
							error={
								<div className="py-16 text-sm text-red-600">Could not load this PDF.</div>
							}
						>
							<Page
								pageNumber={viewPage}
								width={pageWidth}
								className="shadow-md"
								renderAnnotationLayer
								renderTextLayer
							/>
						</Document>
					</div>
				</div>
			</div>
		</div>
	);
}
