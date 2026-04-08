import { FileSearch, Upload } from "lucide-react";
import { useRef } from "react";
import { Button } from "./ui/button";

interface EmptyStateProps {
	onUpload: (file: File) => void;
}

export function EmptyState({ onUpload }: EmptyStateProps) {
	const fileInputRef = useRef<HTMLInputElement>(null);

	return (
		<div className="flex flex-col items-center px-4">
			<div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-neutral-900">
				<FileSearch className="h-7 w-7 text-white" />
			</div>
			<h2 className="mb-2 text-lg font-semibold text-neutral-800">
				Upload a document to get started
			</h2>
			<p className="mb-8 max-w-sm text-center text-sm text-neutral-500">
				Ask questions about leases, title reports, contracts, and other legal documents
			</p>
			<Button variant="outline" onClick={() => fileInputRef.current?.click()}>
				<Upload className="mr-2 h-4 w-4" /> Upload PDF
			</Button>
			<input
				ref={fileInputRef}
				type="file"
				accept=".pdf"
				multiple
				className="hidden"
				onChange={(e) => {
					const files = e.target.files;
					if (files) {
						for (const f of Array.from(files)) {
							onUpload(f);
						}
					}
					if (fileInputRef.current) fileInputRef.current.value = "";
				}}
			/>
		</div>
	);
}
