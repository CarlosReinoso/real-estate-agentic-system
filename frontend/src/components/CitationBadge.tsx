import { useEffect, useState } from "react";
import type { Citation } from "../types";
import * as api from "../lib/api";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface CitationBadgeProps {
	index: number;
	citation: Citation;
	onClick: (citation: Citation) => void;
}

export function CitationBadge({ index, citation, onClick }: CitationBadgeProps) {
	const [open, setOpen] = useState(false);
	const [fromDb, setFromDb] = useState<Citation | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open) return;
		const ac = new AbortController();
		setLoading(true);
		setFromDb(null);
		api
			.fetchCitation(citation.citation_id, ac.signal)
			.then((row) => {
				setFromDb(row);
			})
			.catch(() => {
				/* 404 / network — keep inline citation below */
			})
			.finally(() => {
				if (!ac.signal.aborted) setLoading(false);
			});
		return () => ac.abort();
	}, [open, citation.citation_id]);

	const display = fromDb ?? citation;
	const isWeb = display.type === "web";
	const sourceLabel = display.filename
		? display.filename
		: (() => {
				const raw = display.path.split("/").pop() || display.path;
				try {
					return decodeURIComponent(raw);
				} catch {
					return raw;
				}
			})();

	const href =
		isWeb && /^https?:\/\//i.test(display.path)
			? display.path
			: `#citation-${display.citation_id}`;

	return (
		<span className="contents">
			<Tooltip open={open} onOpenChange={setOpen}>
				<TooltipTrigger asChild>
					<a
						data-citation-badge
						href={href}
						onClick={(e) => {
							if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
							e.preventDefault();
							onClick(fromDb ?? citation);
						}}
						className="mx-px inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full bg-indigo-100/95 p-0 align-baseline text-[8px] font-semibold tabular-nums leading-none text-indigo-700 !no-underline decoration-transparent underline-offset-0 transition-colors visited:text-indigo-700 hover:bg-indigo-200/90 hover:text-indigo-900"
						aria-label={`Citation ${index}: ${sourceLabel}`}
					>
						{index}
					</a>
				</TooltipTrigger>
				<TooltipContent side="top" className="max-w-[280px]">
					<div className="space-y-1">
						<div className="flex items-center gap-1 text-[9px] text-neutral-400">
							<span className="font-semibold text-neutral-200">{isWeb ? "Web" : "File"}</span>
							{display.page_num != null && display.page_num > 0 && (
								<>
									<span className="text-neutral-500">|</span>
									<span>Page {display.page_num}</span>
								</>
							)}
							{loading && (
								<>
									<span className="text-neutral-500">|</span>
									<span className="text-neutral-500">Loading…</span>
								</>
							)}
						</div>
						<p className="truncate text-[9px] font-medium text-neutral-100">{sourceLabel}</p>
						<div className="line-clamp-4 rounded-sm bg-neutral-800/70 px-1 py-0.5 text-[9px] text-neutral-200">
							{display.content || (loading ? "…" : "")}
						</div>
					</div>
				</TooltipContent>
			</Tooltip>
		</span>
	);
}
