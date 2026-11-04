import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, ImagePlus, StickyNote, X } from "lucide-react";
import { AttachmentThumbs, DropOverlay } from "@/components/AttachmentThumbs";
import { MarkdownEditor, type EditorHandle } from "@/components/MarkdownEditor";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import { useDraftIssue } from "@/features/board/useDraftIssue";
import { useDropZone } from "@/lib/drop";
import { joinPath } from "@/lib/format";
import { useProjects } from "@/lib/queries";
import { useTheme } from "@/lib/theme";

const win = getCurrentWindow();

/** 주 창에서 마지막으로 본 프로젝트. 주 창의 화면 상태(store.ts 의 docket-ui)를 읽기만 한다 — 이 창이 그 상태를 덮으면 주 창이 엉뚱한 화면으로 켜진다. */
function mainProject(): string | null {
	try {
		return (JSON.parse(localStorage.getItem("docket-ui") ?? "{}") as { state?: { projectId?: string | null } }).state?.projectId ?? null;
	} catch {
		return null;
	}
}

/**
 * 전역 단축키로 띄우는 빠른 메모 창(src-tauri/src/quick.rs). 적고 Ctrl+Enter 로 붙이면 숨는다.
 * Esc 를 누르거나 다른 창을 누르면 숨되 쓰던 글은 남긴다. 다시 띄울 때 글이 비어 있으면 주 창에서 보던 프로젝트로 맞춘다.
 */
export function QuickCapture() {
	const { data: projects = [] } = useProjects();
	const [projectId, setProjectId] = useState<string | null>(mainProject);
	const project = projects.find((p) => p.id === projectId) ?? projects[0];
	const editor = useRef<EditorHandle>(null);
	const d = useDraftIssue(project?.id, editor);
	const theme = useTheme(d.settings?.theme);
	const [sent, setSent] = useState<number | null>(null);
	// 파일 고르기 창이 떠 있는 동안은 초점을 잃어도 숨지 않는다.
	const picking = useRef(false);
	const note = useRef(d.note);
	note.current = d.note;

	const hide = () => void win.hide();

	useEffect(() => {
		const un = listen("docket://quick-open", () => {
			setSent(null);
			if (!note.current.trim()) setProjectId(mainProject());
			setTimeout(() => editor.current?.focus(), 30);
		});
		const unFocus = win.onFocusChanged(({ payload: focused }) => {
			if (!focused && !picking.current) void win.hide();
		});
		return () => {
			void un.then((f) => f());
			void unFocus.then((f) => f());
		};
	}, []);

	const [dropRef, over] = useDropZone<HTMLDivElement>((paths) => void d.addFiles(paths));

	const submit = async () => {
		const issue = await d.submit();
		if (!issue) return;
		setSent(issue.number);
		setTimeout(() => {
			hide();
			setSent(null);
		}, 700);
	};

	const pick = async () => {
		picking.current = true;
		try {
			await d.pickFiles();
		} finally {
			picking.current = false;
			editor.current?.focus();
		}
	};

	return (
		<div
			ref={dropRef}
			className="relative flex h-full flex-col overflow-hidden border border-border-strong bg-card"
			onKeyDown={(e) => {
				// 펼친 프로젝트 목록 안의 Esc 는 목록만 닫는다. 목록은 창 밖(portal)에 그려져 이 칸 안에 들지 않는다.
				if (e.key === "Escape" && e.currentTarget.contains(e.target as Node)) hide();
			}}
		>
			{over && <DropOverlay />}
			<header data-tauri-drag-region className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3.5 select-none">
				<StickyNote className="size-4 text-subtle" />
				<span data-tauri-drag-region className="text-[13px] font-semibold">
					빠른 메모
				</span>
				<div data-tauri-drag-region className="flex-1 self-stretch" />
				{projects.length > 0 && (
					<Select value={project?.id} onValueChange={setProjectId}>
						<SelectTrigger size="sm" className="h-7 max-w-52 min-w-28 text-[12.5px]" aria-label="붙일 프로젝트">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="pop">
							{projects.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				<Button variant="ghost" size="icon" className="size-7" aria-label="숨기기" onClick={hide}>
					<X />
				</Button>
			</header>

			{projects.length === 0 ? (
				<p className="grid flex-1 place-items-center px-6 text-center text-[13px] break-keep text-muted-foreground">
					붙일 프로젝트가 없습니다. docket 을 열어 개발 폴더를 먼저 추가하세요.
				</p>
			) : (
				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 py-3">
					<MarkdownEditor
						ref={editor}
						value={d.note}
						onChange={d.setNote}
						autoFocus
						minHeight="96px"
						placeholder="무엇을 고치거나 만들까요? 스크린샷은 붙여 넣으세요."
						onSubmit={() => void submit()}
						onPasteImage={d.pasteImage}
					/>
					{d.attachments.length > 0 && d.draftDir && (
						<AttachmentThumbs className="mt-3" names={d.attachments} pathOf={(name) => joinPath(d.draftDir, "attachments", name)} onRemove={(name) => void d.removeAttachment(name)} />
					)}
				</div>
			)}

			<footer className="flex h-12 shrink-0 items-center gap-3 border-t border-border px-3">
				<Button variant="ghost" size="sm" disabled={!project} onClick={() => void pick()}>
					<ImagePlus />
					첨부
				</Button>
				<label className="flex items-center gap-2 text-[13px] text-muted-foreground">
					<Switch checked={d.autoOn} onCheckedChange={d.setAuto} />
					자동 계획
				</label>
				<div className="flex-1" />
				{sent !== null ? (
					<span className="flex items-center gap-1.5 text-[13px] text-foreground">
						<Check className="size-4" />#{sent} 붙였습니다
					</span>
				) : (
					<Button size="sm" disabled={!project || !d.note.trim() || d.busy} onClick={() => void submit()}>
						붙이기
						<Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground">Ctrl ↵</Kbd>
					</Button>
				)}
			</footer>
			<Toaster position="top-center" theme={theme} />
		</div>
	);
}
