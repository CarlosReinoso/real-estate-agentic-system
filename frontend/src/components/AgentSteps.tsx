import { BookMarked, Loader2 } from "lucide-react";

interface AgentStepsProps {
	/** Single current agentic status line; replaces in place as events arrive. */
	status: string | null;
}

export function AgentSteps({ status }: AgentStepsProps) {
	if (!status) return null;

	return (
		<div
			className={
				"mx-auto my-2 flex max-w-xl items-center gap-2 rounded-xl border border-indigo-100/90 " +
				"bg-gradient-to-r from-indigo-50/90 via-white to-violet-50/50 px-3 py-2 shadow-sm shadow-indigo-500/5 ring-1 ring-indigo-50/70"
			}
			role="status"
			aria-live="polite"
		>
			<BookMarked className="h-3.5 w-3.5 shrink-0 text-indigo-500" strokeWidth={2} aria-hidden />
			<Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-400" aria-hidden />
			<span className="min-w-0 text-[11px] font-medium leading-snug text-slate-600">{status}</span>
		</div>
	);
}
