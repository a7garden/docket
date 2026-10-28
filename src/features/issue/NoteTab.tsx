import { useEffect, useRef, useState } from "react";
import { ImagePlus, TextCursorInput, Trash2, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { attempt, ContextActions, fileActions } from "@/components/ActionMenu";
import { Markdown } from "@/components/Markdown";
import { MarkdownEditor, type EditorHandle } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorText } from "@/lib/api";
import { useDropZone } from "@/lib/drop";
import { attachmentPath, attachmentRef, delayText, fileUrl, isImage } from "@/lib/format";
import { useSettings } from "@/lib/queries";
import type { Issue } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MEMO_MODELS } from "../settings/Settings";

/**
 * 메모는 입력이 멈추면 저장한다. 따로 저장 단추를 두지 않는 것은 포스트잇이라서다.
 * 구현 중에는 잠근다. Claude 가 읽은 메모와 화면의 메모가 달라지면 결과를 대조할 수 없다.
 */
export function NoteTab({ issue }: { issue: Issue }) {
	const { data: settings } = useSettings();
	const locked = !!issue.run || issue.status === "implementing";
	const [editing, setEditing] = useState(issue.status === "inbox" && !locked);
	const [text, setText] = useState(issue.note);
	const [saved, setSaved] = useState(true);
	const editor = useRef<EditorHandle>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const latest = useRef(text);
	latest.current = text;

	// 밖(실행 · 다른 창)에서 메모가 바뀌었고 이쪽에 고친 것이 없으면 따라간다.
	useEffect(() => {
		if (saved) setText(issue.note);
	}, [issue.note]); // eslint-disable-line react-hooks/exhaustive-deps

	const flush = async () => {
		clearTimeout(timer.current);
		if (latest.current === issue.note) return setSaved(true);
		try {
			await api.issueSaveNote(issue.projectId, issue.id, latest.current);
			setSaved(true);
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

	const change = (v: string) => {
		setText(v);
		setSaved(false);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => void flush(), 700);
	};

	/** 편집으로 바꾸고, 편집기가 뜬 뒤 첨부를 본문 커서 자리에 넣는다. */
	const insert = (names: string[]) => {
		setEditing(true);
		setTimeout(() => names.forEach((n) => editor.current?.insert(attachmentRef(n))), 30);
	};

	const addFiles = async (paths: string[]) => {
		try {
			const names = await api.attachmentImport(issue.projectId, issue.id, paths);
			if (!locked) insert(names);
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	const [dropRef, over] = useDropZone<HTMLDivElement>(addFiles, !locked);

	const paste = async (file: File) => {
		try {
			const name = await api.attachmentSave(issue.projectId, issue.id, new Uint8Array(await file.arrayBuffer()), file.type.split("/")[1] ?? "png");
			return attachmentRef(name);
		} catch (e) {
			toast.error(errorText(e));
			return null;
		}
	};

	return (
		<div ref={dropRef} className={cn("flex flex-col gap-4 rounded-lg", over && "ring-2 ring-foreground/40")}>
			<div className="flex items-center gap-2">
				<div className="inline-flex rounded-lg bg-secondary p-0.5">
					{[
						{ v: false, label: "보기" },
						{ v: true, label: "편집" },
					].map((o) => (
						<button
							key={o.label}
							type="button"
							disabled={o.v && locked}
							onClick={() => setEditing(o.v)}
							className={cn(
								"h-6 rounded-md px-2.5 text-[12px] font-medium text-muted-foreground transition-colors disabled:opacity-40",
								editing === o.v && "bg-hover text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]",
							)}
						>
							{o.label}
						</button>
					))}
				</div>
				<span className="text-[12px] text-subtle">{locked ? "실행 중에는 고칠 수 없습니다" : editing ? (saved ? "저장됨" : "저장하는 중") : ""}</span>
				<div className="flex-1" />
				<Select
					value={issue.model || "default"}
					onValueChange={(v) => void api.issueSetModel(issue.projectId, issue.id, v === "default" ? "" : v).catch((e) => toast.error(errorText(e)))}
				>
					<SelectTrigger size="sm" className="w-32" aria-label="이 메모의 모델" title="이 메모의 계획 · 구현 · 대화에 쓸 모델. 다음 실행부터 쓰입니다.">
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="pop">
						{MEMO_MODELS.map((m) => (
							<SelectItem key={m.value} value={m.value}>
								{m.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{issue.status === "inbox" && (
					<label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
						<Switch checked={issue.autoPlan} onCheckedChange={(on) => void api.issueSetAutoPlan(issue.projectId, issue.id, on)} />
						자동 계획
						{issue.autoPlan && <span className="text-subtle">마지막 수정 {delayText(settings?.autoPlanDelaySec ?? 60)}</span>}
					</label>
				)}
			</div>

			{editing && !locked ? (
				<div className="surface rounded-lg px-4 py-3">
					<MarkdownEditor
						ref={editor}
						value={text}
						onChange={change}
						onBlur={() => void flush()}
						onSave={() => void flush()}
						onPasteImage={paste}
						minHeight="220px"
						autoFocus
						placeholder="메모를 적으세요. 스크린샷은 붙여 넣으면 첨부됩니다."
					/>
				</div>
			) : (
				<Markdown text={text || "_비어 있음_"} base={issue.dir} className="text-[14px]" />
			)}

			<div className="flex flex-wrap items-start gap-2">
				{issue.attachments.map((name) => (
					<ContextActions
						key={name}
						items={[
							...fileActions(attachmentPath(issue, name)),
							"sep",
							// 붙여 넣은 그림을 메모 본문에서 지웠어도 첨부는 남는다. 다시 본문에 넣을 때 쓴다.
							!locked && { label: "메모에 넣기", icon: <TextCursorInput />, onSelect: () => insert([name]) },
							!locked && { label: "지우기", icon: <Trash2 />, destructive: true, onSelect: () => void attempt(() => api.attachmentDelete(issue.projectId, issue.id, name)) },
						]}
					>
						<div className="group relative">
							<button type="button" title={`${name} 열기`} onClick={() => void api.open(attachmentPath(issue, name))}>
								{isImage(name) ? (
									<img src={fileUrl(attachmentPath(issue, name))} alt={name} className="h-20 w-28 rounded-md border border-border object-cover" />
								) : (
									<div className="flex h-20 w-28 items-center justify-center rounded-md border border-border px-2 text-center text-[11px] break-all text-muted-foreground">
										{name}
									</div>
								)}
							</button>
							{!locked && (
								<button
									type="button"
									aria-label={`${name} 지우기`}
									onClick={() => void api.attachmentDelete(issue.projectId, issue.id, name)}
									className="absolute -top-1.5 -right-1.5 hidden size-5 place-items-center rounded-full border border-border bg-popover text-muted-foreground group-hover:grid hover:text-foreground"
								>
									<X className="size-3" />
								</button>
							)}
						</div>
					</ContextActions>
				))}
				{!locked && (
					<Button
						variant="outline"
						className="h-20 w-28 flex-col gap-1 border-dashed text-[12px] text-subtle"
						onClick={async () => {
							const picked = await openDialog({ multiple: true, title: "첨부할 파일" });
							if (Array.isArray(picked) && picked.length) await addFiles(picked);
						}}
					>
						<ImagePlus />
						첨부
					</Button>
				)}
			</div>
		</div>
	);
}
