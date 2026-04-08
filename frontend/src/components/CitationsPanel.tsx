import { useEffect } from "react";
import { Library, X } from "lucide-react";
import type { Citation } from "../types";
import { Button } from "./ui/button";

interface CitationsPanelProps {
	citations: Citation[];
	onClose: () => void;
	onViewPage: (citation: Citation) => void;
	selectedCitationId?: string | null;
}

export function CitationsPanel({
	citations,
	onClose,
	onViewPage,
	selectedCitationId,
}: CitationsPanelProps) {
	const sortedCitations = [...citations].sort((a, b) => {
		const byIndex = a.citation_index - b.citation_index;
		return byIndex !== 0 ? byIndex : a.citation_id.localeCompare(b.citation_id);
	});
	const sourceCount = citations.length;
	const getSourceLabel = (citation: Citation) => {
		if (citation.filename) return citation.filename;
		const raw = citation.path.split("/").pop() || citation.path;
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	};

	useEffect(() => {
		if (!selectedCitationId) return;
		const id = window.requestAnimationFrame(() => {
			const el = document.getElementById(`citation-item-${selectedCitationId}`);
			el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		});
		return () => window.cancelAnimationFrame(id);
	}, [selectedCitationId, citations]);

	return (
		<div className="flex h-full flex-col">
			<div className="flex h-10 items-center justify-between px-2.5">
				<span className="flex min-w-0 items-center gap-1.5 truncate text-[11px] font-semibold tracking-tight text-slate-700">
					<span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
						<Library className="h-3 w-3" strokeWidth={2} aria-hidden />
					</span>
					<span className="truncate">{`Sources (${sourceCount})`}</span>
				</span>
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 rounded-lg border border-slate-200/90 bg-white text-slate-500 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/60 hover:text-indigo-700"
					onClick={onClose}
				>
					<X className="h-3.5 w-3.5" />
				</Button>
			</div>
			<div className="h-px w-full flex-shrink-0 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />

			<div className="no-scrollbar flex-1 overflow-y-auto">
				<div className="space-y-1.5 pr-0">
					{sortedCitations.length > 0 && (
						<div className="w-full max-w-full space-y-1.5">
							{sortedCitations.map((c) => {
								const rowInner = (
									<div className="flex w-full min-w-0 max-w-full items-start gap-2">
										<div className="min-w-0 max-w-full flex-1">
											<div className="flex w-full min-w-0 max-w-full items-center gap-1.5">
												<span className="flex-shrink-0 text-[10px] text-neutral-500">
													[{c.citation_index}]
												</span>
												<span
													className={`block min-w-0 max-w-full truncate text-[10px] ${
														c.type === "web"
															? "text-blue-600 underline"
															: "text-neutral-500"
													}`}
												>
													{getSourceLabel(c)}
												</span>
											</div>
											<p className="mt-1 line-clamp-2 max-w-full break-all text-[11px] text-neutral-600">
												{c.content}
											</p>
										</div>
									</div>
								);
								const rowClass = `block w-full min-w-0 max-w-full border px-2 py-1.5 transition-colors ${
									selectedCitationId === c.citation_id
										? "border-blue-400 bg-blue-50"
										: "border-neutral-200 bg-neutral-50 hover:border-blue-300 hover:bg-blue-50/50"
								}`;

								if (c.type === "web") {
									return (
										<a
											id={`citation-item-${c.citation_id}`}
											key={c.citation_id}
											href={c.path}
											target="_blank"
											rel="noopener noreferrer"
											className={rowClass}
										>
											{rowInner}
										</a>
									);
								}
								return (
									<button
										id={`citation-item-${c.citation_id}`}
										key={c.citation_id}
										type="button"
										onClick={() => onViewPage(c)}
										className={`${rowClass} text-left`}
									>
										{rowInner}
									</button>
								);
							})}
						</div>
					)}

					{citations.length === 0 && (
						<div className="flex h-full min-h-[220px] items-center justify-center p-2">
							<p className="text-center text-xs text-neutral-400">No sources yet</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
