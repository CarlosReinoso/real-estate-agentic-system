import { Paperclip, SendHorizontal } from "lucide-react";
import { type KeyboardEvent, useCallback, useRef, useState } from "react";
import { Button } from "./ui/button";

interface ChatInputProps {
	onSend: (content: string) => void;
	onUpload: (file: File) => void;
	disabled: boolean;
}

export function ChatInput({ onSend, onUpload, disabled }: ChatInputProps) {
	const [value, setValue] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleSend = useCallback(() => {
		const trimmed = value.trim();
		if (!trimmed || disabled) return;
		onSend(trimmed);
		setValue("");
		if (textareaRef.current) {
			textareaRef.current.style.height = "auto";
		}
	}, [value, disabled, onSend]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				handleSend();
			}
		},
		[handleSend],
	);

	const handleInput = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
	}, []);

	const handleFileChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files;
			if (files) {
				for (const f of Array.from(files)) {
					onUpload(f);
				}
			}
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		},
		[onUpload],
	);

	return (
		<div className="border-t border-slate-200/60 bg-gradient-to-t from-white via-white to-slate-50/30 p-2 pb-3 backdrop-blur-md">
			<div className="mx-auto max-w-xl rounded-2xl border border-slate-200/90 bg-white px-2.5 py-2 shadow-md shadow-slate-200/30 ring-1 ring-slate-100/80 transition-all focus-within:border-indigo-200/80 focus-within:shadow-lg focus-within:shadow-indigo-500/10 focus-within:ring-indigo-100/60">
				<textarea
					ref={textareaRef}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onInput={handleInput}
					onKeyDown={handleKeyDown}
					placeholder="Ask a question about your documents..."
					rows={1}
					className="max-h-[200px] min-h-[30px] w-full resize-none bg-transparent py-1 text-[13px] leading-snug text-slate-800 placeholder-slate-400 outline-none"
					disabled={disabled}
				/>

				<div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-1.5">
					<Button
						variant="ghost"
						size="icon"
						className="h-7 w-7 flex-shrink-0 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-700"
						onClick={() => fileInputRef.current?.click()}
					>
						<Paperclip className="h-3.5 w-3.5" />
					</Button>

					<input
						ref={fileInputRef}
						type="file"
						accept=".pdf"
						multiple
						className="hidden"
						onChange={handleFileChange}
					/>

					<Button
						variant="ghost"
						size="icon"
						className={`h-7 w-7 flex-shrink-0 rounded-full transition-colors ${
							value.trim() && !disabled
								? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700"
								: "text-slate-300"
						}`}
						disabled={!value.trim() || disabled}
						onClick={handleSend}
					>
						<SendHorizontal className="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
		</div>
	);
}
