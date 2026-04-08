import { AnimatePresence, motion } from "framer-motion";
import { PenSquare, Sparkles, Trash2 } from "lucide-react";
import { relativeTime } from "../lib/utils";
import type { Conversation } from "../types";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

interface ChatSidebarProps {
	conversations: Conversation[];
	selectedId: string | null;
	loading: boolean;
	onSelect: (id: string) => void;
	onCreate: () => void;
	onDelete: (id: string) => void;
}

export function ChatSidebar({
	conversations,
	selectedId,
	loading,
	onSelect,
	onCreate,
	onDelete,
}: ChatSidebarProps) {
	return (
		<div className="flex h-full w-full flex-col border-r border-slate-200/80 bg-white/95 shadow-[inset_-1px_0_0_0_rgba(241,245,249,0.9)] backdrop-blur-md">
			<div className="space-y-1 px-3 py-3">
				<div className="flex min-w-0 items-center gap-2.5">
					<div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 shadow-md shadow-indigo-500/20 ring-1 ring-white/20">
						<Sparkles className="h-4 w-4 text-white" strokeWidth={2} />
					</div>
					<div className="min-w-0">
						<span className="block truncate text-[12px] font-semibold tracking-tight text-slate-900">
							Orbital
						</span>
						<span className="block truncate text-[10px] font-medium text-slate-500">
							Document Q&A
						</span>
					</div>
				</div>
			</div>
			<div className="px-3">
				<div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
			</div>
			<div className="p-2.5">
				<Button
					variant="ghost"
					size="sm"
					className="h-9 w-full justify-center gap-2 rounded-xl border border-indigo-200/80 bg-gradient-to-b from-indigo-50 to-white px-2.5 text-center text-[11px] font-semibold text-indigo-800 shadow-sm shadow-indigo-500/5 transition-all hover:border-indigo-300 hover:from-indigo-100/80 hover:to-indigo-50/90 hover:shadow-indigo-500/10"
					onClick={onCreate}
					title="New chat"
				>
					<PenSquare className="h-3.5 w-3.5" />
					New chat
				</Button>
			</div>
			<div className="px-3 pb-1">
				<div className="h-px w-full bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
			</div>

			<ScrollArea className="flex-1">
				<div className="space-y-1 p-2">
					{loading && conversations.length === 0 && (
						<div className="space-y-2.5 p-2">
							{[1, 2, 3].map((i) => (
								<div key={i} className="animate-pulse space-y-1.5 rounded-lg border border-slate-100/80 bg-slate-50/50 p-2">
									<div className="h-3.5 w-3/4 rounded-md bg-slate-200/70" />
									<div className="h-2.5 w-1/2 rounded-md bg-slate-100" />
								</div>
							))}
						</div>
					)}

					{!loading && conversations.length === 0 && (
						<p className="px-3 py-10 text-center text-[11px] leading-relaxed text-slate-400">
							No conversations yet — start one below.
						</p>
					)}

					<AnimatePresence initial={false}>
						{conversations.map((conversation) => (
							<motion.div
								key={conversation.id}
								initial={{ opacity: 0, height: 0 }}
								animate={{ opacity: 1, height: "auto" }}
								exit={{ opacity: 0, height: 0 }}
								transition={{ duration: 0.15 }}
							>
								<div
									role="button"
									tabIndex={0}
									className={`grid w-full grid-cols-[minmax(0,1fr)_20px] items-center gap-1 rounded-lg px-2 py-2 text-left transition-all ${
										selectedId === conversation.id
											? "bg-indigo-50 ring-1 ring-indigo-200/80 shadow-sm shadow-indigo-500/5"
											: "hover:bg-slate-50"
									}`}
									onClick={() => onSelect(conversation.id)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											onSelect(conversation.id);
										}
									}}
								>
									<div className="min-w-0 flex-1 overflow-hidden">
										<p
											className={`truncate text-[11px] font-medium ${
												selectedId === conversation.id
													? "text-indigo-950"
													: "text-slate-800"
											}`}
										>
											{conversation.title}
										</p>
										<p
											className={`mt-0.5 text-[10px] ${
												selectedId === conversation.id
													? "text-indigo-600/90"
													: "text-slate-400"
											}`}
										>
											{relativeTime(conversation.updated_at)}
										</p>
									</div>

									<button
										type="button"
										className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
										onClick={(e) => {
											e.stopPropagation();
											onDelete(conversation.id);
										}}
										title="Delete conversation"
									>
										<Trash2 className="h-3 w-3" />
									</button>
								</div>
							</motion.div>
						))}
					</AnimatePresence>
				</div>
			</ScrollArea>
		</div>
	);
}
