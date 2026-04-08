export interface Conversation {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	has_document: boolean;
}

export interface Citation {
	citation_id: string;
	citation_index: number;
	chunk_id?: string;
	filename?: string;
	path: string;
	content: string;
	page_num?: number;
	type: "document" | "web";
	score?: number;
}

export interface PlanStep {
	description: string;
	variable: string;
	tool: string;
	tool_input: string;
	status: "pending" | "done" | "error" | "skipped";
	/** Short live label while the step runs (from SSE). */
	phaseLabel?: string;
	/** Short outcome after tool_done / tool_error (from SSE). */
	resultShort?: string;
}

/** RAGAS payload from backend (JSONB); shape varies by status. */
export type RagasMetricsPayload = Record<string, unknown> | null;

export interface Message {
	id: string;
	conversation_id: string;
	role: "user" | "assistant" | "system";
	content: string;
	type: "chat" | "plan" | "tool" | "agent_summary";
	sources_cited: number;
	created_at: string;
	citations?: Citation[];
	ragas_metrics?: RagasMetricsPayload;
}

export interface Document {
	id: string;
	conversation_id: string;
	filename: string;
	page_count: number;
	total_pages?: number;
	status:
		| "uploading"
		| "parsing"
		| "chunking"
		| "indexing"
		| "processing"
		| "ready"
		| "failed";
	ocr_done: boolean;
	uploaded_at: string;
	/** Set when known; shown for ready/failed documents */
	file_size_bytes?: number | null;
}

export interface ConversationDetail extends Conversation {
	document?: Document;
}

export interface SSEEvent {
	type: string;
	content?: string;
	message?: Message;
	message_id?: string;
	conversation_id?: string;
	title?: string;
	steps?: PlanStep[];
	step_count?: number;
	summary?: string;
	step_id?: string;
	phase?: string;
	short_result?: string;
	tool?: string;
	query?: string;
	citations?: Citation[];
	error?: string;
	reason?: string;
	ragas_eval_queued?: boolean;
	node?: string;
	status?: string;
}
