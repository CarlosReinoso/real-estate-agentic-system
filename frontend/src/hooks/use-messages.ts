import { useCallback, useEffect, useRef, useState } from "react";
import {
	RAGAS_METRICS_POLL_INTERVAL_MS,
	RAGAS_METRICS_POLL_MAX_ATTEMPTS,
} from "../constants";
import * as api from "../lib/api";
import type { Citation, Message } from "../types";

export function useMessages(
	conversationId: string | null,
	onConversationTitle?: () => void,
) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [streaming, setStreaming] = useState(false);
	const [streamingContent, setStreamingContent] = useState("");
	const [agentStatus, setAgentStatus] = useState<string | null>(null);
	const [citations, setCitations] = useState<Citation[]>([]);
	const abortRef = useRef<AbortController | null>(null);
	const ragasPollTimerRef = useRef<number | null>(null);
	const ragasPollInFlightRef = useRef(false);
	const pendingRagasIdsRef = useRef<Set<string>>(new Set());
	const ragasAttemptsRef = useRef<Map<string, number>>(new Map());

	const extractLatestCitations = useCallback((items: Message[]): Citation[] => {
		for (let i = items.length - 1; i >= 0; i -= 1) {
			const m = items[i];
			if (!m) continue;
			if (m.role === "assistant" && m.type === "chat" && m.citations?.length) {
				return m.citations;
			}
		}
		return [];
	}, []);

	const refresh = useCallback(async () => {
		if (!conversationId) {
			setMessages([]);
			setAgentStatus(null);
			setCitations([]);
			return;
		}
		try {
			setLoading(true);
			setError(null);
			const data = await api.fetchMessages(conversationId);
			setMessages(data);
			setCitations(extractLatestCitations(data));
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load messages");
		} finally {
			setLoading(false);
		}
	}, [conversationId, extractLatestCitations]);

	const stopRagasPoller = useCallback(() => {
		if (ragasPollTimerRef.current != null) {
			window.clearInterval(ragasPollTimerRef.current);
			ragasPollTimerRef.current = null;
		}
	}, []);

	const upsertMessageRagas = useCallback(
		(messageId: string, metrics: Record<string, unknown> | null) => {
			setMessages((prev: Message[]) =>
				prev.map((m: Message) => (m.id === messageId ? { ...m, ragas_metrics: metrics } : m)),
			);
		},
		[],
	);

	const startRagasPoller = useCallback(() => {
		if (ragasPollTimerRef.current != null) return;
		ragasPollTimerRef.current = window.setInterval(async () => {
			if (ragasPollInFlightRef.current) return;
			if (pendingRagasIdsRef.current.size === 0) {
				stopRagasPoller();
				return;
			}
			ragasPollInFlightRef.current = true;
			try {
				const pendingIds: string[] = Array.from(pendingRagasIdsRef.current);
				await Promise.all(
					pendingIds.map(async (messageId) => {
						try {
							const metrics = await api.fetchMessageRagas(messageId);
							upsertMessageRagas(messageId, metrics);
							const st =
								metrics && typeof metrics === "object" && "status" in metrics
									? String((metrics as { status?: string }).status)
									: "";
							const attempts = ragasAttemptsRef.current.get(messageId) ?? 0;
							if (st !== "pending") {
								pendingRagasIdsRef.current.delete(messageId);
								ragasAttemptsRef.current.delete(messageId);
								return;
							}
							if (attempts + 1 >= RAGAS_METRICS_POLL_MAX_ATTEMPTS) {
								pendingRagasIdsRef.current.delete(messageId);
								ragasAttemptsRef.current.delete(messageId);
								return;
							}
							ragasAttemptsRef.current.set(messageId, attempts + 1);
						} catch {
							const attempts = ragasAttemptsRef.current.get(messageId) ?? 0;
							if (attempts + 1 >= RAGAS_METRICS_POLL_MAX_ATTEMPTS) {
								pendingRagasIdsRef.current.delete(messageId);
								ragasAttemptsRef.current.delete(messageId);
							} else {
								ragasAttemptsRef.current.set(messageId, attempts + 1);
							}
						}
					}),
				);
			} finally {
				ragasPollInFlightRef.current = false;
			}
		}, RAGAS_METRICS_POLL_INTERVAL_MS);
	}, [stopRagasPoller, upsertMessageRagas]);

	// On conversation switch: load message history
	useEffect(() => {
		if (!conversationId) {
			setMessages([]);
			setStreaming(false);
			setStreamingContent("");
			setAgentStatus(null);
			setCitations([]);
			pendingRagasIdsRef.current.clear();
			ragasAttemptsRef.current.clear();
			stopRagasPoller();
			return;
		}

		let cancelled = false;

		const init = async () => {
			try {
				setLoading(true);
				setError(null);
				setStreamingContent("");
				setAgentStatus(null);
				setCitations([]);

				const msgs = await api.fetchMessages(conversationId);

				if (cancelled) return;
				setMessages(msgs);
				setCitations(extractLatestCitations(msgs));
				setStreaming(false);
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Failed to load");
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		};

		init();

		return () => {
			cancelled = true;
			if (abortRef.current) abortRef.current.abort();
			abortRef.current = null;
			stopRagasPoller();
		};
	}, [conversationId, extractLatestCitations, stopRagasPoller]);

	const send = useCallback(
		async (content: string) => {
			if (!conversationId || streaming) return;

			const userMessage: Message = {
				id: `temp-${Date.now()}`,
				conversation_id: conversationId,
				role: "user",
				content,
				type: "chat",
				sources_cited: 0,
				created_at: new Date().toISOString(),
			};

			setMessages((prev: Message[]) => [...prev, userMessage]);
			setStreaming(true);
			setStreamingContent("");
			setAgentStatus("Thinking");
			setCitations([]);
			setError(null);

			try {
				const controller = new AbortController();
				abortRef.current = controller;
				const knownIds = new Set(messages.map((m: Message) => m.id));
				knownIds.add(userMessage.id);
				await api.streamMessage(
					conversationId,
					content,
					(event) => {
						switch (event.type) {
							case "content":
								if (event.content) {
									setAgentStatus(null);
									setStreamingContent((prev: string) => prev + event.content);
								}
								break;
							case "plan":
								setAgentStatus("Planning…");
								break;
							case "replan":
								setAgentStatus("Adjusting plan…");
								break;
							case "tool_start":
								if (typeof event.phase === "string" && event.phase) {
									setAgentStatus(event.phase);
								}
								break;
							case "tool_done":
							case "tool_error":
								if (typeof event.short_result === "string" && event.short_result) {
									setAgentStatus(event.short_result);
								}
								break;
							case "citations":
								if (event.citations) setCitations(event.citations);
								break;
							case "message":
								if (event.message && !knownIds.has(event.message.id)) {
									knownIds.add(event.message.id);
									setMessages((prev: Message[]) => [...prev, event.message as Message]);
									setStreamingContent("");
									setAgentStatus(null);
								}
								break;
							case "error":
								setError(event.error || "An error occurred");
								setAgentStatus(null);
								break;
							case "conversation_title":
								onConversationTitle?.();
								break;
							case "done": {
								setAgentStatus(null);
								const queued = Boolean(event.ragas_eval_queued);
								const messageId = event.message_id;
								if (queued && typeof messageId === "string" && messageId) {
									pendingRagasIdsRef.current.add(messageId);
									ragasAttemptsRef.current.set(messageId, 0);
									startRagasPoller();
								}
								break;
							}
						}
					},
					controller.signal,
				);
				const refreshed = await api.fetchMessages(conversationId);
				setMessages(refreshed);
				setCitations(extractLatestCitations(refreshed));
			} catch (err) {
				if (err instanceof Error && err.message.includes("409")) {
					setError("Agent is still processing a previous message");
				} else {
					setError(err instanceof Error ? err.message : "Failed to send message");
				}
				setStreaming(false);
			}
			setStreaming(false);
			setAgentStatus(null);
			abortRef.current = null;
		},
		[
			conversationId,
			streaming,
			extractLatestCitations,
			messages,
			onConversationTitle,
			startRagasPoller,
		],
	);

	return {
		messages,
		loading,
		error,
		streaming,
		streamingContent,
		agentStatus,
		citations,
		send,
		refresh,
	};
}
