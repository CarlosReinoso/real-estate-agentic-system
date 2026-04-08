import { Loader2, MessageCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Citation, Message } from "../types";
import { AgentSteps } from "./AgentSteps";
import { ChatInput } from "./ChatInput";
import {
	MessageBubble,
	StreamingBubble,
	type CitationClickHandler,
	type OpenSourcesPanelHandler,
} from "./MessageBubble";

function citationsFollowingAgentSummary(messages: Message[], summaryIndex: number): Citation[] {
	for (let i = summaryIndex + 1; i < messages.length; i++) {
		const m = messages[i];
		if (m?.role === "assistant" && m.type === "chat") {
			return m.citations ?? [];
		}
	}
	return [];
}

interface ChatWindowProps {
	messages: Message[];
	loading: boolean;
	error: string | null;
	streaming: boolean;
	streamingContent: string;
	agentStatus: string | null;
	citations: Citation[];
	hasDocuments: boolean;
	conversationId: string | null;
	onSend: (content: string) => void;
	onUpload: (file: File) => void;
	onCitationClick: CitationClickHandler;
	onOpenSourcesPanel: OpenSourcesPanelHandler;
}

export function ChatWindow({
	messages,
	loading,
	error,
	streaming,
	streamingContent,
	agentStatus,
	citations,
	hasDocuments,
	conversationId,
	onSend,
	onUpload,
	onCitationClick,
	onOpenSourcesPanel,
}: ChatWindowProps) {
	const scrollRef = useRef<HTMLDivElement>(null);

	const messagesLength = messages.length;
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll triggers
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messagesLength, streamingContent, agentStatus]);

	if (!conversationId) {
		return (
			<div className="relative flex flex-1 items-center justify-center overflow-hidden bg-gradient-to-b from-slate-50/80 via-white/90 to-indigo-50/20 backdrop-blur-sm">
				<div
					className="pointer-events-none absolute inset-0 opacity-[0.35]"
					style={{
						backgroundImage:
							"radial-gradient(circle at 1px 1px, rgb(226 232 240) 1px, transparent 0)",
						backgroundSize: "24px 24px",
					}}
				/>
				<div className="relative mx-6 max-w-sm rounded-2xl border border-slate-200/80 bg-white/90 px-8 py-10 text-center shadow-lg shadow-slate-200/40 ring-1 ring-slate-100/60 backdrop-blur-md">
					<div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25 ring-4 ring-indigo-100/50">
						<MessageCircle className="h-7 w-7 text-white" strokeWidth={1.75} />
					</div>
					<h2 className="text-base font-semibold tracking-tight text-slate-900">
						Pick a conversation
					</h2>
					<p className="mt-2 text-sm leading-relaxed text-slate-500">
						Choose one from the sidebar or start a new chat to ask about your documents.
					</p>
				</div>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="relative flex flex-1 flex-col bg-white/75 backdrop-blur-md">
				<div className="flex flex-1 items-center justify-center">
					<Loader2 className="h-7 w-7 animate-spin text-indigo-500" strokeWidth={2} />
				</div>
				<div className="absolute inset-x-0 bottom-0">
					<ChatInput
						onSend={onSend}
						onUpload={onUpload}
						disabled={true}
					/>
				</div>
			</div>
		);
	}

	if (messages.length === 0 && !streaming) {
		return (
			<div className="relative flex flex-1 flex-col overflow-hidden bg-gradient-to-b from-slate-50/60 via-white/85 to-indigo-50/15 backdrop-blur-md">
				<div
					className="pointer-events-none absolute inset-0 opacity-[0.25]"
					style={{
						backgroundImage:
							"radial-gradient(circle at 1px 1px, rgb(226 232 240) 1px, transparent 0)",
						backgroundSize: "24px 24px",
					}}
				/>
				<div className="relative flex flex-1 items-center justify-center px-6">
					<div className="w-full max-w-xl">
						<div className="mb-6 text-center">
							<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 ring-1 ring-indigo-200/60 shadow-sm">
								<MessageCircle
									className="h-6 w-6 text-indigo-600"
									strokeWidth={1.75}
								/>
							</div>
							<h2 className="text-lg font-semibold tracking-tight text-slate-900">
								{hasDocuments ? "Ask about your documents" : "Start a new conversation"}
							</h2>
							<p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
								{hasDocuments
									? "Questions are grounded in your uploads. Be specific for the best answers."
									: "Upload PDFs from the input box, then ask anything here."}
							</p>
						</div>
						<ChatInput
							onSend={onSend}
							onUpload={onUpload}
							disabled={streaming}
						/>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="relative flex flex-1 flex-col bg-white/75 backdrop-blur-md">
			{error && (
				<div className="mx-4 mt-3 rounded-xl border border-red-200/90 bg-red-50/95 px-4 py-2.5 text-sm text-red-700 shadow-sm ring-1 ring-red-100/80">
					{error}
				</div>
			)}

			<div ref={scrollRef} className="flex-1 overflow-y-auto px-5 pb-36 pt-5">
				<div className="mx-auto max-w-xl space-y-0.5">
					{messages.map((message, idx) => (
						<MessageBubble
							key={message.id}
							message={message}
							citations={citations}
							onCitationClick={onCitationClick}
							agentSummaryCitations={
								message.type === "agent_summary"
									? citationsFollowingAgentSummary(messages, idx)
									: undefined
							}
							onOpenSourcesPanel={onOpenSourcesPanel}
						/>
					))}
					{streaming && agentStatus && <AgentSteps status={agentStatus} />}
					{streaming && (
						<StreamingBubble
							content={streamingContent}
							citations={citations}
							onCitationClick={onCitationClick}
						/>
					)}
				</div>
			</div>

			<div className="absolute inset-x-0 bottom-0">
				<ChatInput
					onSend={onSend}
					onUpload={onUpload}
					disabled={streaming}
				/>
			</div>
		</div>
	);
}
