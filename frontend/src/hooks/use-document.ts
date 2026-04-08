import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../lib/api";
import type { Document } from "../types";

const ACTIVE_DOCUMENT_STATUSES: Document["status"][] = [
	"uploading",
	"processing",
	"parsing",
	"chunking",
	"indexing",
];

export function useDocuments(conversationId: string | null) {
	const [documents, setDocuments] = useState<Document[]>([]);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const refresh = useCallback(async () => {
		if (!conversationId) {
			setDocuments([]);
			return;
		}
		try {
			setError(null);
			const docs = await api.fetchDocuments(conversationId);
			setDocuments(docs);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load documents");
		}
	}, [conversationId]);

	useEffect(() => {
		refresh();
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, [refresh]);

	// Poll for documents still processing
	useEffect(() => {
		if (pollRef.current) clearInterval(pollRef.current);

		const processing = documents.filter((d) => ACTIVE_DOCUMENT_STATUSES.includes(d.status));
		if (processing.length === 0) return;

		pollRef.current = setInterval(async () => {
			let changed = false;
			const updated = await Promise.all(
				documents.map(async (doc) => {
					if (ACTIVE_DOCUMENT_STATUSES.includes(doc.status)) {
						try {
							const status = await api.fetchDocumentStatus(doc.id);
							if (status.status !== doc.status) {
								changed = true;
								return { ...doc, ...status };
							}
						} catch {
							// ignore
						}
					}
					return doc;
				}),
			);
			if (changed) setDocuments(updated);
		}, 3000);

		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, [documents]);

	const upload = useCallback(
		async (file: File) => {
			if (!conversationId) return null;
			try {
				setUploading(true);
				setError(null);
				const doc = await api.uploadDocument(conversationId, file);
				setDocuments((prev) => [...prev, doc]);
				return doc;
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to upload document");
				return null;
			} finally {
				setUploading(false);
			}
		},
		[conversationId],
	);

	const remove = useCallback(
		async (documentId: string) => {
			if (!conversationId) return;
			try {
				await api.deleteDocument(conversationId, documentId);
				setDocuments((prev) => prev.filter((d) => d.id !== documentId));
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to delete document");
			}
		},
		[conversationId],
	);

	const reprocess = useCallback(async (documentId: string) => {
		try {
			await api.reprocessDocument(documentId);
			setDocuments((prev) =>
				prev.map((d) => (d.id === documentId ? { ...d, status: "uploading" as const } : d)),
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to reprocess document");
		}
	}, []);

	return {
		documents,
		uploading,
		error,
		upload,
		remove,
		reprocess,
		refresh,
	};
}
