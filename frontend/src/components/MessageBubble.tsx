import { motion } from "framer-motion";
import {
	BookMarked,
	Check,
	ChevronRight,
	Cog,
	Copy,
	Search,
	ThumbsDown,
	ThumbsUp,
} from "lucide-react";
import {
	isValidElement,
	useCallback,
	useEffect,
	useMemo,
	useState,
	type AnchorHTMLAttributes,
	type ReactNode,
} from "react";
import { defaultUrlTransform, Streamdown, type Components } from "streamdown";
import "streamdown/styles.css";
import type { Citation, Message } from "../types";
import { copyTextToClipboard, plainTextFromAssistantMarkdown } from "../lib/utils";
import { CitationBadge } from "./CitationBadge";
import { RagasMetricsStrip } from "./RagasMetricsStrip";
import { Button } from "./ui/button";

const MESSAGE_FEEDBACK_STORAGE_KEY = "orbital_message_feedback_v1";

type MessageFeedback = "up" | "down";

function readStoredFeedback(messageId: string): MessageFeedback | null {
	try {
		const raw = localStorage.getItem(MESSAGE_FEEDBACK_STORAGE_KEY);
		if (!raw) return null;
		const o = JSON.parse(raw) as Record<string, MessageFeedback>;
		const v = o[messageId];
		return v === "up" || v === "down" ? v : null;
	} catch {
		return null;
	}
}

function writeStoredFeedback(messageId: string, value: MessageFeedback | null) {
	try {
		const raw = localStorage.getItem(MESSAGE_FEEDBACK_STORAGE_KEY);
		const o: Record<string, MessageFeedback> = raw ? JSON.parse(raw) : {};
		if (value === null) {
			delete o[messageId];
		} else {
			o[messageId] = value;
		}
		localStorage.setItem(MESSAGE_FEEDBACK_STORAGE_KEY, JSON.stringify(o));
	} catch {
		// ignore quota / private mode
	}
}

export type CitationClickHandler = (
	citation: Citation,
	messageId: string | null,
	messageCitations: Citation[],
) => void | Promise<void>;

export type OpenSourcesPanelHandler = (citations: Citation[]) => void | Promise<void>;

interface MessageBubbleProps {
	message: Message;
	citations?: Citation[];
	onCitationClick?: CitationClickHandler;
	/** Citations for the assistant reply that follows this `agent_summary` (if any). */
	agentSummaryCitations?: Citation[];
	onOpenSourcesPanel?: OpenSourcesPanelHandler;
}

/** Fresh RegExp each use — avoid stale `lastIndex` from a shared `/g` regex. */
const CITATION_LINK_RE_SOURCE = String.raw`\[(\d+)\]\(([^)]+)\)`;

/** Match citation_id-style hrefs from the model (UUID) so streaming works before SSE fills the map. */
const CITATION_HREF_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CITE_HASH_PREFIX = "#cite:";

function rewriteCitationLinksBeforeHarden(markdown: string, citations: Citation[]): string {
	const ids = new Set(citations.map((c) => c.citation_id));
	return markdown.replace(new RegExp(CITATION_LINK_RE_SOURCE, "g"), (match, num, id: string) => {
		const raw = String(id).trim();
		if (/^https?:\/\//i.test(raw)) return match;
		if (ids.has(raw) || CITATION_HREF_UUID.test(raw)) {
			return `[${num}](#cite:${encodeURIComponent(raw)})`;
		}
		return match;
	});
}

function createCitationUrlTransform(citations: Citation[]) {
	const ids = new Set(citations.map((c) => c.citation_id));
	return (
		url: string,
		key: string,
		node: Parameters<typeof defaultUrlTransform>[2],
	) => {
		const raw = String(url ?? "");
		if (key === "href" && (ids.has(raw) || CITATION_HREF_UUID.test(raw))) {
			return `${CITE_HASH_PREFIX}${encodeURIComponent(raw)}`;
		}
		return defaultUrlTransform(url, key, node);
	};
}

/** Parse [N] from markdown link children (Streamdown may pass strings, arrays, or nested elements). */
function linkChildrenToIndex(children: ReactNode): number {
	if (children == null || children === false || children === true) return 0;
	if (typeof children === "number" && Number.isFinite(children) && children >= 1) {
		return Math.floor(children);
	}
	if (typeof children === "string") {
		const n = Number.parseInt(children.trim().replace(/[^\d]/g, "") || "0", 10);
		return Number.isNaN(n) ? 0 : n;
	}
	if (Array.isArray(children)) {
		for (const child of children) {
			const n = linkChildrenToIndex(child);
			if (n > 0) return n;
		}
		return 0;
	}
	if (isValidElement(children) && children.props != null && typeof children.props === "object") {
		const ch = (children.props as { children?: ReactNode }).children;
		if (ch !== undefined) return linkChildrenToIndex(ch);
	}
	const s = String(children);
	const n = Number.parseInt(s.replace(/\D/g, "") || "0", 10);
	return Number.isNaN(n) ? 0 : n;
}

/** Prefer persisted / merged citation_index so badges match Sources panel after dedup. */
function citationBadgeDisplayIndex(
	citation: Citation | undefined,
	children: ReactNode,
): number {
	const fromRecord =
		citation != null &&
		typeof citation.citation_index === "number" &&
		Number.isFinite(citation.citation_index) &&
		citation.citation_index > 0
			? citation.citation_index
			: 0;
	if (fromRecord > 0) return fromRecord;
	const fromLink = linkChildrenToIndex(children);
	return fromLink > 0 ? fromLink : 0;
}

type MarkdownAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
	/** hast node from streamdown; do not forward to DOM */
	node?: unknown;
};

function mergeCitationsForMessage(
	messageCitations: Citation[] | undefined,
	conversationCitations: Citation[],
): Citation[] {
	const map = new Map<string, Citation>();
	for (const c of messageCitations ?? []) map.set(c.citation_id, c);
	for (const c of conversationCitations) {
		if (!map.has(c.citation_id)) map.set(c.citation_id, c);
	}
	return [...map.values()];
}

function createCitationMarkdownComponents(
	citationMap: Map<string, Citation>,
	onCitationBadgeClick?: (citation: Citation) => void,
): Components {
	return {
		a: ({ href, children, className, node: _node, ...rest }: MarkdownAnchorProps) => {
			if (typeof href === "string" && href.startsWith(CITE_HASH_PREFIX)) {
				const id = decodeURIComponent(href.slice(CITE_HASH_PREFIX.length));
				const citation = citationMap.get(id);
				const index = citationBadgeDisplayIndex(citation, children);
				if (citation && onCitationBadgeClick) {
					return (
						<CitationBadge
							citation={citation}
							index={index}
							onClick={onCitationBadgeClick}
						/>
					);
				}
				return (
					<span className="contents">
						<span className="mx-px inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-slate-200/90 p-0 align-baseline text-[8px] font-medium tabular-nums leading-none text-slate-600">
							{index || children}
						</span>
					</span>
				);
			}
			return (
				<a href={href} className={className} {...rest}>
					{children}
				</a>
			);
		},
	};
}

/** Assistant markdown: readable type scale; avoid [&_*] overrides that flatten headings/lists. */
const ASSISTANT_MARKDOWN_WRAP =
	"prose max-w-none min-w-0 text-[13px] leading-[1.65] text-slate-800 antialiased " +
	"[&_p]:!mb-0 [&_p+_p]:mt-3 [&_p:first-child]:!mt-0 " +
	"[&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_ul]:pl-4 [&_ol]:pl-4 " +
	"[&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:!text-lg [&_h1]:!leading-snug [&_h1]:font-semibold [&_h1]:text-slate-900 " +
	"[&_h2]:mb-1.5 [&_h2]:mt-4 [&_h2]:!text-base [&_h2]:!leading-snug [&_h2]:font-semibold [&_h2]:text-slate-900 " +
	"[&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:!text-[15px] [&_h3]:!leading-snug [&_h3]:font-semibold [&_h3]:text-slate-900 " +
	"[&_code]:rounded-md [&_code]:bg-slate-100/90 [&_code]:px-1 [&_code]:py-px [&_code]:text-[12px] [&_code]:font-mono [&_code]:text-slate-800 " +
	"[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-slate-200/80 [&_pre]:bg-slate-50/90 [&_pre]:p-2.5 " +
	"[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
	"[&_strong]:font-semibold [&_strong]:text-slate-900 " +
	"[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-indigo-200 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 [&_blockquote]:not-italic " +
	"[&_hr]:my-4 [&_hr]:border-slate-200 " +
	"[&_a:not([data-citation-badge])]:font-medium [&_a:not([data-citation-badge])]:text-indigo-600 [&_a:not([data-citation-badge])]:underline [&_a:not([data-citation-badge])]:underline-offset-2 " +
	"[&_a[data-citation-badge]]:!no-underline [&_a[data-citation-badge]]:decoration-transparent";

const STREAMDOWN_BODY_CLASS =
	"min-w-0 !space-y-3 text-[13px] leading-[1.65] text-slate-800 [&>*:first-child]:!mt-0";

export function MessageBubble({
	message,
	citations = [],
	onCitationClick,
	agentSummaryCitations,
	onOpenSourcesPanel,
}: MessageBubbleProps) {
	const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
	const [feedback, setFeedback] = useState<MessageFeedback | null>(() =>
		message.role === "assistant" && message.type === "chat"
			? readStoredFeedback(message.id)
			: null,
	);

	useEffect(() => {
		setFeedback(
			message.role === "assistant" && message.type === "chat"
				? readStoredFeedback(message.id)
				: null,
		);
	}, [message.id, message.role, message.type]);

	useEffect(() => {
		if (copyState === "idle") return;
		const t = window.setTimeout(() => setCopyState("idle"), copyState === "copied" ? 2000 : 2500);
		return () => window.clearTimeout(t);
	}, [copyState]);

	const handleCopy = useCallback(async (text: string, asAssistantMarkdown: boolean) => {
		const payload = asAssistantMarkdown ? plainTextFromAssistantMarkdown(text) : text;
		const ok = await copyTextToClipboard(payload);
		setCopyState(ok ? "copied" : "error");
	}, []);

	const setFeedbackChoice = useCallback(
		(choice: MessageFeedback) => {
			const next = feedback === choice ? null : choice;
			setFeedback(next);
			writeStoredFeedback(message.id, next);
		},
		[feedback, message.id],
	);

	const allCitations = useMemo<Citation[]>(
		() =>
			message.role === "assistant"
				? mergeCitationsForMessage(message.citations, citations)
				: [],
		[message.role, message.citations, citations],
	);

	const citationMap = useMemo(
		() => new Map(allCitations.map((c: Citation) => [c.citation_id, c])),
		[allCitations],
	);

	const citationUrlTransform = useMemo(
		() => createCitationUrlTransform(allCitations),
		[allCitations],
	);

	const handleCitationBadgeClick = useCallback(
		(c: Citation) => {
			if (!onCitationClick) return;
			const list =
				message.role === "assistant"
					? mergeCitationsForMessage(message.citations, citations)
					: [];
			onCitationClick(c, message.id, list);
		},
		[onCitationClick, message.id, message.role, message.citations, citations],
	);

	const citationMarkdownComponents = useMemo(
		() => createCitationMarkdownComponents(citationMap, handleCitationBadgeClick),
		[citationMap, handleCitationBadgeClick],
	);

	const assistantBodyTrimmed = useMemo(
		() => (message.role === "assistant" ? message.content.trimStart() : ""),
		[message.role, message.content],
	);

	const assistantMarkdownForStreamdown = useMemo(
		() =>
			message.role === "assistant"
				? rewriteCitationLinksBeforeHarden(assistantBodyTrimmed, allCitations)
				: "",
		[message.role, assistantBodyTrimmed, allCitations],
	);

	if (message.type === "agent_summary") {
		const panelCits =
			agentSummaryCitations && agentSummaryCitations.length > 0
				? agentSummaryCitations
				: citations;
		const canOpen = Boolean(onOpenSourcesPanel);

		return (
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 0.15 }}
				className="py-0.5"
			>
				<button
					type="button"
					disabled={!canOpen}
					onClick={() => {
						if (!onOpenSourcesPanel) return;
						onOpenSourcesPanel(panelCits);
					}}
					className={
						"inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-200/90 " +
						"bg-gradient-to-b from-slate-50/95 to-white px-2.5 py-1.5 text-left shadow-sm ring-1 ring-slate-100/60 transition-colors " +
						(canOpen
							? "cursor-pointer hover:border-indigo-200/90 hover:from-indigo-50/80 hover:to-white hover:ring-indigo-100/50"
							: "cursor-default")
					}
					title={canOpen ? "View sources" : undefined}
				>
					<BookMarked className="h-3 w-3 shrink-0 text-indigo-500" strokeWidth={2} aria-hidden />
					<span className="min-w-0 text-[11px] font-medium leading-snug text-slate-600">
						{message.content}
					</span>
					{canOpen ? (
						<ChevronRight className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
					) : null}
				</button>
			</motion.div>
		);
	}

	if (message.type === "plan") {
		return (
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 0.15 }}
				className="flex items-start gap-2 py-1"
			>
				<Cog className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-indigo-400" />
				<div className="min-w-0 flex-1">
					<p className="text-[13px] leading-snug text-indigo-800/90">{message.content}</p>
				</div>
			</motion.div>
		);
	}

	if (message.type === "tool") {
		return (
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 0.15 }}
				className="flex items-start gap-2 py-1"
			>
				<Search className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-violet-400" />
				<div className="min-w-0 flex-1">
					<p className="text-[13px] leading-snug text-violet-800/90">{message.content}</p>
				</div>
			</motion.div>
		);
	}

	if (message.role === "system") {
		return (
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 0.2 }}
				className="flex justify-center py-2"
			>
				<div className="max-w-full px-2 text-center">
					<p className="text-[12px] leading-snug text-slate-500">{message.content}</p>
				</div>
			</motion.div>
		);
	}

	if (message.role === "user") {
		return (
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.2 }}
				className="flex justify-end py-1"
			>
				<div className="max-w-[80%]">
					<div className="rounded-2xl rounded-br-md border border-indigo-100/90 bg-gradient-to-br from-indigo-50/95 to-slate-50/90 px-3.5 py-2.5 shadow-sm shadow-slate-200/30 ring-1 ring-indigo-50/60">
						<p className="m-0 whitespace-pre-wrap text-[13px] leading-[1.55] text-slate-800">
							{message.content}
						</p>
					</div>
					<div className="mt-0.5 flex justify-end">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-5 w-5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
							onClick={() => handleCopy(message.content, false)}
							title={
								copyState === "copied"
									? "Copied"
									: copyState === "error"
										? "Copy failed — try again"
										: "Copy message"
							}
						>
							{copyState === "copied" ? (
								<Check className="h-3 w-3 text-emerald-600" strokeWidth={2.5} />
							) : (
								<Copy className="h-3 w-3" />
							)}
						</Button>
					</div>
				</div>
			</motion.div>
		);
	}

	// Assistant chat message — citations stay inside markdown flow (e.g. <li>) via custom <a> rendering
	const hasCitations =
		citations.length > 0 &&
		new RegExp(CITATION_LINK_RE_SOURCE).test(assistantBodyTrimmed);

	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2 }}
			className="py-1"
		>
			<div className="w-full min-w-0 rounded-2xl border border-slate-200/70 bg-white/90 p-4 shadow-sm shadow-slate-200/40 ring-1 ring-slate-100/80 backdrop-blur-[2px]">
				{hasCitations ? (
					<div className={ASSISTANT_MARKDOWN_WRAP}>
						{/*
							Pre-rewrite [n](uuid) → [n](#cite:…) so rehype-harden allows hrefs (see rewriteCitationLinksBeforeHarden).
							Single Streamdown pass keeps chips inside <li>. urlTransform is a fallback; components.a renders chips.
						*/}
						<Streamdown
							mode="static"
							className={STREAMDOWN_BODY_CLASS}
							components={citationMarkdownComponents}
							urlTransform={citationUrlTransform}
						>
							{assistantMarkdownForStreamdown}
						</Streamdown>
					</div>
				) : (
					<div className={ASSISTANT_MARKDOWN_WRAP}>
						<Streamdown className={STREAMDOWN_BODY_CLASS}>{assistantBodyTrimmed}</Streamdown>
					</div>
				)}
				<div className="mt-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg bg-slate-50/90 p-0.5 ring-1 ring-slate-100/80">
					<div className="flex items-center gap-0.5">
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="h-7 w-7 rounded-md text-slate-500 hover:bg-white hover:text-slate-800"
							onClick={() => handleCopy(message.content, true)}
							title={
								copyState === "copied"
									? "Copied"
									: copyState === "error"
										? "Copy failed — try again"
										: "Copy answer (plain text)"
							}
						>
							{copyState === "copied" ? (
								<Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
							) : (
								<Copy className="h-3.5 w-3.5" />
							)}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className={`h-7 w-7 rounded-md hover:bg-white ${
								feedback === "up"
									? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80"
									: "text-slate-500 hover:text-slate-800"
							}`}
							onClick={() => setFeedbackChoice("up")}
							title={feedback === "up" ? "Thanks — tap to clear" : "Good response"}
							aria-pressed={feedback === "up"}
						>
							<ThumbsUp className="h-3.5 w-3.5" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className={`h-7 w-7 rounded-md hover:bg-white ${
								feedback === "down"
									? "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80"
									: "text-slate-500 hover:text-slate-800"
							}`}
							onClick={() => setFeedbackChoice("down")}
							title={feedback === "down" ? "Noted — tap to clear" : "Bad response"}
							aria-pressed={feedback === "down"}
						>
							<ThumbsDown className="h-3.5 w-3.5" />
						</Button>
					</div>
					{message.type === "chat" ? (
						<RagasMetricsStrip metrics={message.ragas_metrics} />
					) : null}
				</div>
			</div>
		</motion.div>
	);
}

interface StreamingBubbleProps {
	content: string;
	citations: Citation[];
	onCitationClick: CitationClickHandler;
}

export function StreamingBubble({
	content,
	citations,
	onCitationClick,
}: StreamingBubbleProps) {
	const body = content.trimStart();
	const useCitationRender =
		citations.length > 0 || new RegExp(CITATION_LINK_RE_SOURCE).test(body);

	const streamMarkdownForCitations = useMemo(
		() => rewriteCitationLinksBeforeHarden(body, citations),
		[body, citations],
	);

	const citationMap = useMemo(
		() => new Map(citations.map((c: Citation) => [c.citation_id, c])),
		[citations],
	);

	const citationUrlTransform = useMemo(
		() => createCitationUrlTransform(citations),
		[citations],
	);

	const handleStreamCitationBadgeClick = useCallback(
		(c: Citation) => {
			onCitationClick(c, null, citations);
		},
		[onCitationClick, citations],
	);

	const citationMarkdownComponents = useMemo(
		() => createCitationMarkdownComponents(citationMap, handleStreamCitationBadgeClick),
		[citationMap, handleStreamCitationBadgeClick],
	);

	if (!content) {
		return null;
	}

	return (
		<div className="py-1">
			<div className="w-full min-w-0 rounded-2xl border border-indigo-100/80 bg-gradient-to-b from-indigo-50/40 via-white to-white p-4 shadow-sm shadow-indigo-100/30 ring-1 ring-indigo-50/60">
				<div className="flex min-w-0 max-w-full flex-nowrap items-start gap-1">
					{useCitationRender ? (
						<div className={`${ASSISTANT_MARKDOWN_WRAP} min-w-0 flex-1`}>
							<Streamdown
								mode="streaming"
								className={STREAMDOWN_BODY_CLASS}
								components={citationMarkdownComponents}
								urlTransform={citationUrlTransform}
							>
								{streamMarkdownForCitations}
							</Streamdown>
						</div>
					) : (
						<div className={`${ASSISTANT_MARKDOWN_WRAP} min-w-0 flex-1`}>
							<Streamdown className={STREAMDOWN_BODY_CLASS} mode="streaming">
								{content}
							</Streamdown>
						</div>
					)}
					<span
						className="mt-[0.35rem] inline-block h-[0.875rem] w-px shrink-0 animate-pulse rounded-full bg-indigo-400/80"
						aria-hidden
					/>
				</div>
			</div>
		</div>
	);
}
