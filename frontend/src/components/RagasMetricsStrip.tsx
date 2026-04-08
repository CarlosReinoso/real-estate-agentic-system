/** RAGAS scores: compact toolbar control with icon + tooltip (assistant chat). */

import { AlertCircle, BarChart3, Loader2, MinusCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

function fmtScore(v: unknown): string {
	if (typeof v === "number" && Number.isFinite(v)) {
		if (v >= 0 && v <= 1) return `${Math.round(v * 100)}%`;
		return v.toFixed(2);
	}
	return "—";
}

function meanRagasScore(metrics: Record<string, unknown>): number | null {
	const keys = ["faithfulness", "answer_relevancy", "context_precision", "context_recall"] as const;
	let sum = 0;
	let n = 0;
	for (const k of keys) {
		const v = metrics[k];
		if (typeof v === "number" && Number.isFinite(v)) {
			sum += v;
			n += 1;
		}
	}
	return n > 0 ? sum / n : null;
}

interface RagasMetricsStripProps {
	metrics: Record<string, unknown> | null | undefined;
}

const TOOLTIP_BOX =
	"max-w-[280px] space-y-2 p-2 text-[10px] leading-snug text-neutral-50";

export function RagasMetricsStrip({ metrics }: RagasMetricsStripProps) {
	if (!metrics || typeof metrics !== "object") return null;
	const st = metrics.status;
	if (st == null) return null;

	if (st === "pending") {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-7 w-7 shrink-0 rounded-md text-slate-500 hover:bg-white hover:text-slate-800"
						aria-label="RAGAS quality evaluation in progress"
					>
						<Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top" className={TOOLTIP_BOX}>
					<p className="font-semibold">RAGAS quality</p>
					<p className="text-neutral-300">
						Evaluating this answer (faithfulness, relevancy, context precision & recall). Scores
						appear here when ready.
					</p>
				</TooltipContent>
			</Tooltip>
		);
	}

	if (st === "skipped") {
		const reason =
			metrics.reason != null && String(metrics.reason) !== ""
				? String(metrics.reason)
				: "No evaluation run for this reply.";
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-7 w-7 shrink-0 rounded-md text-slate-400 hover:bg-white hover:text-slate-600"
						aria-label="RAGAS evaluation skipped"
					>
						<MinusCircle className="h-3.5 w-3.5" strokeWidth={2} />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top" className={TOOLTIP_BOX}>
					<p className="font-semibold">RAGAS skipped</p>
					<p className="text-neutral-300">{reason}</p>
				</TooltipContent>
			</Tooltip>
		);
	}

	if (st === "failed") {
		const err = metrics.error != null ? String(metrics.error).slice(0, 400) : "Unknown error.";
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-7 w-7 shrink-0 rounded-md text-rose-500 hover:bg-rose-50 hover:text-rose-700"
						aria-label="RAGAS evaluation failed"
					>
						<AlertCircle className="h-3.5 w-3.5" strokeWidth={2} />
					</Button>
				</TooltipTrigger>
				<TooltipContent side="top" className={TOOLTIP_BOX}>
					<p className="font-semibold text-rose-200">RAGAS failed</p>
					<p className="break-words text-neutral-300">{err}</p>
				</TooltipContent>
			</Tooltip>
		);
	}

	if (st !== "complete") return null;

	const items: [string, unknown][] = [
		["Faithfulness", metrics.faithfulness],
		["Answer relevancy", metrics.answer_relevancy],
		["Context precision", metrics.context_precision],
		["Context recall", metrics.context_recall],
	];

	const mean = meanRagasScore(metrics);
	const meanLabel = mean != null ? `${Math.round(mean * 100)}%` : null;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					className="h-7 shrink-0 gap-1 rounded-md px-2 text-slate-600 hover:bg-white hover:text-slate-800"
					aria-label="RAGAS quality scores"
				>
					<BarChart3 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
					{meanLabel != null ? (
						<span className="text-[10px] font-semibold tabular-nums">{meanLabel}</span>
					) : (
						<span className="text-[10px] font-medium text-slate-500">RAGAS</span>
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="top" className={TOOLTIP_BOX}>
				<p className="font-semibold">RAGAS quality scores</p>
				<ul className="space-y-1 text-neutral-200">
					{items.map(([label, v]) => (
						<li key={label} className="flex justify-between gap-4">
							<span className="text-neutral-400">{label}</span>
							<span className="tabular-nums font-medium text-neutral-100">{fmtScore(v)}</span>
						</li>
					))}
				</ul>
				<p className="border-t border-neutral-700 pt-2 text-[9px] leading-snug text-neutral-400">
					Context precision and recall use the assistant answer as a pseudo-reference, not human
					labels.
				</p>
			</TooltipContent>
		</Tooltip>
	);
}
