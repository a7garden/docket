import { useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ImagePlus, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { AttachmentThumbs, DropOverlay } from "@/components/AttachmentThumbs";
import { MarkdownEditor, type EditorHandle } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { api, errorText } from "@/lib/api";
import { useDropZone } from "@/lib/drop";
import { attachmentRef, delayText, joinPath, newId } from "@/lib/format";
import { useKey } from "@/lib/keys";
import { useAppInfo, useSettings } from "@/lib/queries";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RunPicker } from "../settings/RunPicker";

/**
 * 보드 맨 위의 포스트잇. 접혀 있다가 누르거나 Ctrl+N 으로 펼친다.
 * 붙이기 전에 넣은 이미지는 미리 정한 이슈 id 의 폴더로 바로 저장된다. 그래야 메모 본문에 그림 링크를 끼울 수 있다.
 */
export function Composer({ project }: { project: Project }) {
	const { data: settings } = useSettings();
	const { data: info } = useAppInfo();
	const [open, setOpen] = useState(false);
	const [note, setNote] = useState("");
	const [draftId, setDraftId] = useState(newId);
	const [auto, setAuto] = useState<boolean | null>(null);
	const [model, setModel] = useState("");
	const [effort, setEffort] = useState("");
	const [attachments, setAttachments] = useState<string[]>([]);
	const [busy, setBusy] = useState(false);
	const editor = useRef<EditorHandle>(null);
	const autoOn = auto ?? settings?.autoPlan ?? true;

	const draftDir = info ? joinPath(info.dataRoot, "projects", project.id, "issues", draftId) : "";

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
		try {
			const names = await api.attachmentImport(project.id, draftId, paths);
			setAttachments((a) => [...a, ...names]);
			setOpen(true);
			setTimeout(() => names.forEach((n) => editor.current?.insert(attachmentRef(n))), 30);
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	const [dropRef, over] = useDropZone<HTMLDivElement>(addFiles);

	const pasteImage = async (file: File) => {
		try {
			const bytes = new Uint8Array(await file.arrayBuffer());
			const name = await api.attachmentSave(project.id, draftId, bytes, file.type.split("/")[1] ?? "png");
			setAttachments((a) => [...a, name]);
			return attachmentRef(name);
		} catch (e) {
			toast.error(errorText(e));
			return null;
		}
	};

	const pickImages = async () => {
		const picked = await openDialog({ multiple: true, title: "첨부할 파일" });
		if (Array.isArray(picked) && picked.length) await addFiles(picked);
	};

	const removeAttachment = async (name: string) => {
		await api.attachmentDelete(project.id, draftId, name).catch(() => {});
		setAttachments((a) => a.filter((x) => x !== name));
		setNote((n) => n.split(attachmentRef(name)).join("").replace(/\n{3,}/g, "\n\n"));
	};

	const submit = async () => {
		if (!note.trim() || busy) return;
		setBusy(true);
		try {
			await api.issueCreate(project.id, draftId, note, autoOn, model, effort);
			setNote("");
			setAttachments([]);
			setDraftId(newId());
			setAuto(null);
			setModel("");
			setEffort("");
			setOpen(false);
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setBusy(false);
		}
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
