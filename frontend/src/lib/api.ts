import type {
	Citation,
	Conversation,
	ConversationDetail,
	Document,
	Message,
	SSEEvent,
} from "../types";

const BASE = "/api";

async function handleResponse<T>(response: Response): Promise<T> {
	if (!response.ok) {
		const text = await response.text().catch(() => "Unknown error");
		throw new Error(`API error ${response.status}: ${text}`);
	}
	return response.json() as Promise<T>;
}

export async function fetchConversations(): Promise<Conversation[]> {
	const res = await fetch(`${BASE}/conversations`);
	return handleResponse<Conversation[]>(res);
}

export async function createConversation(): Promise<Conversation> {
	const res = await fetch(`${BASE}/conversations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title: "New conversation" }),
	});
	return handleResponse<Conversation>(res);
}

export async function deleteConversation(id: string): Promise<void> {
	const res = await fetch(`${BASE}/conversations/${id}`, { method: "DELETE" });
	if (!res.ok) {
		const text = await res.text().catch(() => "Unknown error");
		throw new Error(`API error ${res.status}: ${text}`);
	}
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
	const res = await fetch(`${BASE}/conversations/${id}`);
	return handleResponse<ConversationDetail>(res);
}

export async function fetchMessages(conversationId: string): Promise<Message[]> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/messages`);
	return handleResponse<Message[]>(res);
}

export async function fetchMessageCitations(
	conversationId: string,
	messageId: string,
): Promise<Citation[]> {
	const res = await fetch(
		`${BASE}/conversations/${conversationId}/messages/${encodeURIComponent(messageId)}/citations`,
	);
	return handleResponse<Citation[]>(res);
}

export async function fetchCitation(
	citationId: string,
	signal?: AbortSignal,
): Promise<Citation> {
	const res = await fetch(`${BASE}/citations/${encodeURIComponent(citationId)}`, {
		signal,
	});
	return handleResponse<Citation>(res);
}

export async function fetchMessageRagas(
	messageId: string,
	signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
	const res = await fetch(`${BASE}/messages/${encodeURIComponent(messageId)}/ragas`, {
		signal,
	});
	return handleResponse<Record<string, unknown> | null>(res);
}

export async function sendMessage(
	conversationId: string,
	content: string,
): Promise<{ message_id: string; status: string }> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/messages`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content }),
	});
	return handleResponse<{ message_id: string; status: string }>(res);
}

export async function streamMessage(
	conversationId: string,
	content: string,
	onEvent: (event: SSEEvent) => void,
	signal?: AbortSignal,
): Promise<void> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/messages/stream`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ content }),
		signal,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "Unknown error");
		throw new Error(`API error ${res.status}: ${text}`);
	}
	if (!res.body) return;
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("data: ")) continue;
			try {
				onEvent(JSON.parse(trimmed.slice(6)) as SSEEvent);
			} catch {
				// ignore malformed event payload
			}
		}
	}
}

export async function fetchStatus(
	conversationId: string,
): Promise<{ processing: boolean; cursor: string | null }> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/status`);
	return handleResponse<{ processing: boolean; cursor: string | null }>(res);
}

export function streamUrl(conversationId: string, lastEventId: string): string {
	return `${BASE}/conversations/${conversationId}/stream?last_event_id=${encodeURIComponent(lastEventId)}`;
}

export async function uploadDocument(conversationId: string, file: File): Promise<Document> {
	const formData = new FormData();
	formData.append("file", file);
	const res = await fetch(`${BASE}/conversations/${conversationId}/documents`, {
		method: "POST",
		body: formData,
	});
	return handleResponse<Document>(res);
}

export async function fetchDocuments(conversationId: string): Promise<Document[]> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/documents`);
	return handleResponse<Document[]>(res);
}

export async function fetchDocumentStatus(
	documentId: string,
): Promise<{
	status: string;
	page_count: number;
	total_pages: number | null;
	ocr_done: boolean;
	file_size_bytes: number | null;
}> {
	const res = await fetch(`${BASE}/documents/${documentId}/status`);
	return handleResponse(res);
}

export async function reprocessDocument(documentId: string): Promise<void> {
	const res = await fetch(`${BASE}/documents/${documentId}/reprocess`, { method: "POST" });
	if (!res.ok) {
		const text = await res.text().catch(() => "Unknown error");
		throw new Error(`API error ${res.status}: ${text}`);
	}
}

export async function deleteDocument(conversationId: string, documentId: string): Promise<void> {
	const res = await fetch(`${BASE}/conversations/${conversationId}/documents/${documentId}`, {
		method: "DELETE",
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "Unknown error");
		throw new Error(`API error ${res.status}: ${text}`);
	}
}

export function getDocumentUrl(documentId: string): string {
	return `${BASE}/documents/${documentId}/content`;
}
