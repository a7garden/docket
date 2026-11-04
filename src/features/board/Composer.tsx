import { useRef, useState } from "react";
import { ImagePlus, StickyNote } from "lucide-react";
import { AttachmentThumbs, DropOverlay } from "@/components/AttachmentThumbs";
import { MarkdownEditor, type EditorHandle } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { useDropZone } from "@/lib/drop";
import { delayText, joinPath } from "@/lib/format";
import { useKey } from "@/lib/keys";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RunPicker } from "../settings/RunPicker";
import { useDraftIssue } from "./useDraftIssue";

/**
 * 보드 맨 위의 포스트잇. 접혀 있다가 누르거나 Ctrl+N 으로 펼친다.
 * 첨부 · 붙이기는 빠른 메모 창과 함께 쓰는 useDraftIssue 가 맡는다.
 */
export function Composer({ project }: { project: Project }) {
	const [open, setOpen] = useState(false);
	const editor = useRef<EditorHandle>(null);
	const d = useDraftIssue(project.id, editor);
	const { settings, note, setNote, draftDir, autoOn, setAuto, model, setModel, effort, setEffort, attachments, busy } = d;

	useKey({
		id: "board.compose",
		combo: "Mod+N",
		label: "메모 붙이기",
		group: "보드",
		command: true,
		run: () => {
			setOpen(true);
			setTimeout(() => editor.current?.focus(), 30);
		},
	});

	const addFiles = async (paths: string[]) => {
		if (await d.addFiles(paths)) setOpen(true);
	};
	const [dropRef, over] = useDropZone<HTMLDivElement>(addFiles);

	const { pickFiles: pickImages, removeAttachment, pasteImage } = d;

	const submit = async () => {
		if (await d.submit()) setOpen(false);
	};

	if (!open) {
		return (
			<div ref={dropRef}>
				<button
					type="button"
					onClick={() => setOpen(true)}
					className={cn(
						"flex h-10 w-full items-center gap-3 rounded-md border border-border bg-card px-3.5 text-left text-[13.5px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground",
						over && "border-foreground/50",
					)}
				>
					<StickyNote className="size-4 text-subtle" />
					<span className="flex-1">{over ? "놓으면 새 메모에 첨부합니다" : "메모 붙이기"}</span>
					<Kbd>Ctrl N</Kbd>
				</button>
			</div>
		);
	}

	return (
		<div
			ref={dropRef}
			className={cn(
				"relative rounded-md border border-border-strong bg-card p-4 transition-colors",
			)}
			onKeyDown={(e) => {
				if (e.key === "Escape") setOpen(false);
			}}
		>
			{over && <DropOverlay />}
			<MarkdownEditor
				ref={editor}
				value={note}
				onChange={setNote}
				autoFocus
				minHeight="96px"
				maxHeight="42vh"
				placeholder={
					settings?.titleModel
						? "무엇을 고치거나 만들까요? 제목은 Claude 가 지어 붙입니다. 스크린샷은 붙여 넣으세요."
						: "무엇을 고치거나 만들까요? 첫 줄이 제목이 됩니다. 스크린샷은 붙여 넣으세요."
				}
				onSubmit={submit}
				onPasteImage={pasteImage}
			/>
			{attachments.length > 0 && draftDir && (
				<AttachmentThumbs className="mt-3" names={attachments} pathOf={(name) => joinPath(draftDir, "attachments", name)} onRemove={(name) => void removeAttachment(name)} />
			)}
			<div className="mt-3 flex items-center gap-3 border-t border-border pt-3">
				<Button variant="ghost" size="sm" onClick={() => void pickImages()}>
					<ImagePlus />
					첨부
				</Button>
				<label className="flex items-center gap-2 text-[13px] text-muted-foreground">
					<Switch checked={autoOn} onCheckedChange={setAuto} />
					자동 계획
					{autoOn && <span className="text-subtle">붙이고 {delayText(settings?.autoPlanDelaySec ?? 60)}</span>}
				</label>
				<RunPicker model={model} effort={effort} onModel={setModel} onEffort={setEffort} followLabel="설정 따름" className="max-w-48 min-w-32" />

				<div className="flex-1" />
				<Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
					접기
				</Button>
				<Button size="sm" disabled={!note.trim() || busy} onClick={() => void submit()}>
					붙이기
					<Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground">Ctrl ↵</Kbd>
				</Button>
			</div>
		</div>
	);
}
