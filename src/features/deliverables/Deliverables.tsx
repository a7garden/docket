/**
 * 산출물 목록 화면.
 *
 * 목차
 * 1. Deliverables — 머리 단추 · 「전체 / 손볼 것」 거르기 · 목록 · 끌어 놓아 가져오기
 * 2. Row — 목록 한 줄 (상태 · 그 까닭 · 작성 · 뽑기 상태 · 우클릭 메뉴)
 * 3. RulesDialog — 규칙 모아 보기 (산출물마다 이름 규칙 · 형식 · 템플릿 · 어휘 · 작성법)
 * 4. SettingsDialog — 산출물 설정 (산출물 폴더 · 기본 파일 이름 규칙 · 지난 판 폴더)
 * 5. NewDialog · GenerateDialog — 새 산출물 · 새 판 쓰기
 */
import { type ReactNode, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { BookA, ExternalLink, File, FileImage, FileSpreadsheet, FileText, FileType2, ListChecks, Loader2, PanelRight, Plus, Presentation, Settings2, Square, StickyNote, Upload } from "lucide-react";
import { toast } from "sonner";
import { type ActionList, attempt, ContextActions } from "@/components/ActionMenu";
import { Chip, Empty, Label } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText } from "@/lib/api";
import { useDropZone } from "@/lib/drop";
import { bytes, extOf, relTime } from "@/lib/format";
import { qk, useDeliverables, useGlossary, useIssues } from "@/lib/queries";
import { useLive, useUi } from "@/lib/store";
import type { Deliverable, DeliverableSettings, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { needsCare, stateOf } from "./AutoTab";
import { DeliverableSheet, useDeliverableActions, versionPath } from "./DeliverableSheet";

/** 결과 파일 형식. 정한 형식 → 템플릿 확장자 → md 순이다(runner 의 doc_file_prompt 와 같은 순서). */
export function docFormat(d: Pick<Deliverable, "format" | "template">) {
	return d.format || extOf(d.template) || "md";
}

export function FileIcon({ name, className }: { name: string; className?: string }) {
	const ext = extOf(name);
	const c = cn("size-4 shrink-0", className);
	if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)) return <FileImage className={c} />;
	if (["xlsx", "xls", "csv"].includes(ext)) return <FileSpreadsheet className={c} />;
	if (["pptx", "ppt"].includes(ext)) return <Presentation className={c} />;
	if (["md", "txt", "markdown"].includes(ext)) return <FileText className={c} />;
	if (["pdf", "docx", "doc", "hwp", "hwpx"].includes(ext)) return <FileType2 className={c} />;
	return <File className={c} />;
}

export const SOURCE_LABEL: Record<string, string> = { import: "가져옴", editor: "직접 씀", claude: "Claude 작성", issue: "이슈에서" };

export function Deliverables({ project }: { project: Project }) {
	const { data: list = [], isLoading } = useDeliverables(project.id);
	const { data: issues = [] } = useIssues(project.id);
	const openDeliverable = useUi((s) => s.openDeliverable);
	const openIssue = useUi((s) => s.openIssue);
	const setView = useUi((s) => s.setView);
	const [creating, setCreating] = useState(false);
	const [rules, setRules] = useState(false);
	const [settings, setSettings] = useState(false);
	// 「손볼 것」만 보기. 실패 · 검토 필요 · 반영 대기가 있는 산출물만 남긴다.
	const [careOnly, setCareOnly] = useState(false);
	const care = list.filter(needsCare);
	const shown = careOnly ? care : list;
	const pendingIssues = new Set(list.flatMap((d) => d.pending.map((p) => p.id))).size;

	const importPaths = async (paths: string[]) => {
		try {
			const added = await api.deliverableImport(project.id, paths);
			toast(`${added.length}개를 산출물로 가져왔습니다`);
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	const [dropRef, over] = useDropZone<HTMLDivElement>(importPaths);

	return (
		<div ref={dropRef} className="relative flex min-h-0 flex-1 flex-col gap-4">
			<div className="flex items-center gap-2">
				<Button onClick={() => setCreating(true)}>
					<Plus />새 산출물
				</Button>
				<Button
					variant="outline"
					onClick={async () => {
						const picked = await openDialog({ multiple: true, title: "산출물로 가져올 파일" });
						if (Array.isArray(picked) && picked.length) await importPaths(picked);
					}}
				>
					<Upload />
					파일 가져오기
				</Button>
				<span className="ml-2 text-[12.5px] text-subtle">파일을 끌어다 놓아도 됩니다</span>
				<div className="flex-1" />
				<Button variant="ghost" disabled={list.length === 0} onClick={() => setRules(true)}>
					<ListChecks />
					규칙 모아 보기
				</Button>
				<Button variant="outline" title={`판 파일을 두는 폴더: ${project.deliverablesDir || "앱 데이터 폴더"}`} onClick={() => setSettings(true)}>
					<Settings2 />
					산출물 설정
				</Button>
			</div>

			{list.length > 0 && (
				<div className="-mt-1 flex items-center gap-1.5 text-[12.5px]">
					<FilterPill on={!careOnly} onClick={() => setCareOnly(false)}>
						전체 <span className="tabular">{list.length}</span>
					</FilterPill>
					<FilterPill on={careOnly} onClick={() => setCareOnly(true)}>
						손볼 것 <span className="tabular">{care.length}</span>
					</FilterPill>
					{pendingIssues > 0 && <span className="ml-2 text-subtle">반영 대기 이슈 {pendingIssues}건</span>}
				</div>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto">
				{careOnly && care.length === 0 && list.length > 0 ? (
					<Empty className="py-24 leading-relaxed">손볼 산출물이 없습니다. 실패 · 검토 필요 · 반영 대기가 모두 비었습니다.</Empty>
				) : !isLoading && list.length === 0 ? (
					<Empty className="py-24 leading-relaxed">
						이 프로젝트의 산출물이 아직 없습니다.
						<br />
						새 산출물을 만들고 템플릿 · 참고 자료를 넣으면 Claude 가 그 형식대로 씁니다.
					</Empty>
				) : (
					<div className="surface overflow-hidden rounded-md">
						<div className="grid grid-cols-[minmax(0,1fr)_72px_104px_88px] items-center gap-4 border-b border-border px-4 py-2 text-[12px] font-semibold text-subtle">
							<span>이름</span>
							<span>판</span>
							<span>상태</span>
							<span className="text-right">고친 때</span>
						</div>
						{shown.map((d) => (
							<Row
								key={d.id}
								project={project}
								d={d}
								issueNumber={issues.find((i) => i.id === d.issueId)?.number}
								onOpen={() => openDeliverable(d.id)}
								onIssue={() => {
									setView("board");
									openIssue(d.issueId);
								}}
							/>
						))}
					</div>
				)}
			</div>

			{over && (
				<div className="pointer-events-none absolute inset-0 grid place-items-center rounded-md border-2 border-dashed border-foreground/40 bg-background/80 text-[14px] font-medium text-foreground">
					놓으면 산출물로 가져옵니다
				</div>
			)}

			<NewDialog
				project={project}
				open={creating}
				onOpenChange={setCreating}
				onCreated={(d) => {
					setCreating(false);
					openDeliverable(d.id);
				}}
			/>
			<RulesDialog
				project={project}
				list={list}
				open={rules}
				onOpenChange={setRules}
				onOpen={(id) => {
					setRules(false);
					openDeliverable(id);
				}}
				onGlossary={() => {
					setRules(false);
					setView("glossary");
				}}
				onSettings={() => {
					setRules(false);
					setSettings(true);
				}}
			/>
			<SettingsDialog project={project} open={settings} onOpenChange={setSettings} />
			<DeliverableSheet project={project} />
		</div>
	);
}

function FilterPill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<button
			type="button"
			aria-pressed={on}
			onClick={onClick}
			className={cn(
				"inline-flex h-6 items-center gap-1 rounded-full border px-2.5 transition-colors",
				on ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-hover hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function Row({ project, d, issueNumber, onOpen, onIssue }: { project: Project; d: Deliverable; issueNumber?: number; onOpen: () => void; onIssue: () => void }) {
	const last = d.versions[d.versions.length - 1];
	const activity = useLive((s) => (d.job ? s.byTarget[d.id]?.activity : undefined));
	const sub = last ? [last.file, bytes(last.size)] : ["아직 판 없음"];
	if (d.refs.length) sub.push(`템플릿 · 자료 ${d.refs.length}`);
	if (d.skill.trim()) sub.push(d.vocab.length ? `작성법 · 어휘 ${d.vocab.length}` : "작성법");
	if (d.autoUpdate) sub.push(d.autoLast ? `자동 갱신 ${d.autoLast}` : "자동 갱신");
	const state = stateOf(d);
	const { items, dialogs } = useDeliverableActions(project, d);
	const menu: ActionList = [
		{ label: "열기", icon: <PanelRight />, onSelect: onOpen },
		last && { label: `마지막 판(v${last.n}) 열기`, icon: <ExternalLink />, onSelect: () => void attempt(() => api.open(versionPath(d, last))) },
		issueNumber !== undefined && { label: `이슈 #${issueNumber} 열기`, icon: <StickyNote />, onSelect: onIssue },
		"sep",
		d.job && {
			label: d.job.phase === "queued" ? "작성 줄에서 빼기" : "작성 중지",
			icon: <Square className="fill-current" />,
			destructive: true,
			onSelect: () => void attempt(() => api.deliverableStop(project.id, d.id)),
		},
		d.learn && {
			label: d.learn.phase === "queued" ? "뽑기 줄에서 빼기" : "작성법 뽑기 중지",
			icon: <Square className="fill-current" />,
			destructive: true,
			onSelect: () => void attempt(() => api.deliverableLearnStop(project.id, d.id)),
		},
		"sep",
		...items,
	];
	const row = (
		<div
			role="button"
			tabIndex={0}
			onClick={onOpen}
			onKeyDown={(e) => e.key === "Enter" && onOpen()}
			className="grid grid-cols-[minmax(0,1fr)_72px_104px_88px] items-center gap-4 border-b border-border px-4 py-2.5 text-[13.5px] transition-colors outline-none last:border-b-0 hover:bg-hover focus-visible:bg-hover"
		>
			<div className="flex min-w-0 items-center gap-3">
				<span className="text-subtle">{d.job || d.learn ? <Loader2 className="size-4 animate-spin text-run" /> : <FileIcon name={last?.file ?? ".md"} />}</span>
				<div className="min-w-0">
					<div className="truncate font-medium">{d.title || "작성 중인 문서"}</div>
					<div className="truncate text-[12px] text-subtle">
						{d.job ? (
							<span className="text-foreground">{d.job.phase === "queued" ? "앞선 작업을 기다리는 중" : activity || "Claude 가 쓰는 중"}</span>
						) : d.learn ? (
							<span className="text-foreground">작성법 · 어휘를 뽑는 중</span>
						) : d.error ? (
							<span className="text-danger">{d.error.split("\n")[0]}</span>
						) : state.why ? (
							<span className="text-muted-foreground">{state.why}</span>
						) : (
							sub.join(" · ")
						)}
					</div>
				</div>
				{issueNumber !== undefined && (
					<button
						type="button"
						className="mono shrink-0 rounded-md px-1.5 text-[12px] text-subtle hover:bg-hover hover:text-foreground"
						title="이 산출물을 남긴 이슈 열기"
						onClick={(e) => {
							e.stopPropagation();
							onIssue();
						}}
					>
						#{issueNumber}
					</button>
				)}
			</div>
			<span className="tabular text-[12.5px] text-muted-foreground">{last ? `v${last.n}` : ""}</span>
			<span title={last ? `출처: ${SOURCE_LABEL[last.source] ?? last.source}` : undefined}>
				<Chip tone={state.tone}>{state.label}</Chip>
			</span>
			<span className="text-right text-[12.5px] text-subtle">{relTime(d.updatedAt)}</span>
		</div>
	);
	// 확인 창은 줄 밖에 둔다. 줄 안에 두면 창의 단추를 누른 것이 줄의 onClick 까지 올라가 상세 창이 열린다.
	return (
		<>
			<ContextActions items={menu}>{row}</ContextActions>
			{dialogs}
		</>
	);
}

/**
 * 프로젝트의 산출물 규칙을 한 표로 본다. 고치는 곳은 각 산출물의 「만드는 법」이고, 이 표는 어긋난 것을 찾는 자리다.
 * 공용 어휘는 어휘 사전 화면이 맡는다 — 같은 목록을 고치는 칸을 두 군데 두지 않는다.
 */
function RulesDialog({
	project,
	list,
	open,
	onOpenChange,
	onOpen,
	onGlossary,
	onSettings,
}: {
	project: Project;
	list: Deliverable[];
	open: boolean;
	onOpenChange: (o: boolean) => void;
	onOpen: (id: string) => void;
	onGlossary: () => void;
	onSettings: () => void;
}) {
	const { data: glossary } = useGlossary(open ? project.id : null);
	const terms = glossary ? glossary.entries.length + glossary.shared.length : 0;
	const base = project.naming || "{제목}_v{판}_{날짜}";
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="pop gap-4 p-6 sm:max-w-4xl">
				<DialogHeader>
					<DialogTitle>산출물 규칙</DialogTitle>
					<DialogDescription className="sr-only">산출물마다의 이름 규칙 · 형식 · 템플릿 · 어휘 · 작성법</DialogDescription>
				</DialogHeader>
				<div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
					<BookA className="size-4 text-subtle" />
					<span className="min-w-0 flex-1 break-keep text-muted-foreground">
						{glossary?.glossary.enabled ? `프로젝트 어휘 사전 ${terms}개가 모든 산출물 작성에 함께 붙습니다.` : "프로젝트 어휘 사전이 꺼져 있습니다. 켜면 모든 산출물 작성에 함께 붙습니다."}
					</span>
					<Button size="sm" variant="outline" onClick={onGlossary}>
						어휘 사전 열기
					</Button>
				</div>
				<div className="-mt-2 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
					<Settings2 className="size-4 text-subtle" />
					<span className="min-w-0 flex-1 break-keep text-muted-foreground">
						이름 규칙을 비운 산출물은 기본 규칙 <span className="mono text-foreground">{base}</span> 를 따릅니다.
					</span>
					<Button size="sm" variant="outline" onClick={onSettings}>
						산출물 설정
					</Button>
				</div>
				<div className="surface max-h-[60vh] overflow-y-auto rounded-md">
					<div className="sticky top-0 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_64px_minmax(0,1fr)_48px_88px] items-center gap-3 border-b border-border bg-background px-3 py-2 text-[12px] font-semibold text-subtle">
						<span>산출물</span>
						<span>이름 규칙</span>
						<span>형식</span>
						<span>템플릿</span>
						<span className="text-right">어휘</span>
						<span>작성법</span>
					</div>
					{list.map((d) => {
						const pending = !!(d.draft.skill || d.draft.vocab.length || d.draft.format || d.draft.naming || d.draft.template);
						return (
							<button
								key={d.id}
								type="button"
								onClick={() => onOpen(d.id)}
								className="grid w-full grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_64px_minmax(0,1fr)_48px_88px] items-center gap-3 border-b border-border px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-hover"
							>
								<span className="truncate font-medium">{d.title || "제목 없는 문서"}</span>
								<span className={cn("mono truncate text-[12.5px]", !d.naming && "text-subtle")} title={d.naming || `기본 규칙 ${base}`}>
									{d.naming || "기본 규칙"}
								</span>
								<span className="mono text-[12.5px] text-muted-foreground">{docFormat(d)}</span>
								<span className="truncate text-[12.5px] text-muted-foreground" title={d.template}>
									{d.template || "—"}
								</span>
								<span className="tabular text-right text-[12.5px]">{d.vocab.length || "—"}</span>
								<span className="text-[12.5px]">
									{d.learn ? (
										<span className="inline-flex items-center gap-1 text-muted-foreground">
											<Loader2 className="size-3.5 animate-spin text-run" />
											뽑는 중
										</span>
									) : pending ? (
										<Chip tone="brand">제안 있음</Chip>
									) : d.skill.trim() ? (
										"있음"
									) : (
										<span className="text-subtle">없음</span>
									)}
								</span>
							</button>
						);
					})}
				</div>
			</DialogContent>
		</Dialog>
	);
}

const pick = (p: Project): DeliverableSettings => ({ deliverablesDir: p.deliverablesDir, naming: p.naming, namingUnderscore: p.namingUnderscore, archiveDir: p.archiveDir });

/**
 * 판 파일을 어디에 어떤 이름으로 둘지 정한다. 이 규칙을 따르는 「만드는 법」 · 「규칙 모아 보기」가 이 화면에 있어 고치는 곳도 여기 둔다.
 * 저장은 이 네 칸만 바꾼다 — 프로젝트 설정 창이 들고 있던 옛 값과 서로 덮지 않는다.
 */
function SettingsDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
	const qc = useQueryClient();
	const [s, setS] = useState(() => pick(project));
	const [preview, setPreview] = useState("");
	useEffect(() => {
		if (open) setS(pick(project));
	}, [open, project]);
	useEffect(() => {
		if (!open) return;
		const t = setTimeout(() => {
			api.namingPreview(project.id, s.naming || "{제목}_v{판}_{날짜}", "테이블 정의서", 3, s.namingUnderscore).then(setPreview, () => setPreview(""));
		}, 150);
		return () => clearTimeout(t);
	}, [open, project.id, s.naming, s.namingUnderscore]);

	const save = async () => {
		try {
			await api.deliverableSettingsSave(project.id, s);
			await qc.invalidateQueries({ queryKey: qk.projects });
			onOpenChange(false);
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="pop max-h-[88vh] gap-5 overflow-y-auto p-6 sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>산출물 설정</DialogTitle>
					<DialogDescription className="sr-only">판 파일을 둘 폴더와 이름 규칙</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1.5">
					<Label>산출물 폴더</Label>
					<div className="flex gap-2">
						<Input
							value={s.deliverablesDir}
							onChange={(e) => setS({ ...s, deliverablesDir: e.target.value })}
							placeholder="비우면 앱 데이터 폴더"
							className="mono h-8 text-[12.5px] placeholder:font-sans md:text-[12.5px]"
						/>
						<Button
							variant="outline"
							onClick={async () => {
								const dir = await openDialog({ directory: true, title: "산출물 폴더", defaultPath: s.deliverablesDir || project.path });
								if (typeof dir === "string") setS({ ...s, deliverablesDir: dir });
							}}
						>
							고르기
						</Button>
					</div>
					<p className="text-[12px] leading-relaxed break-keep text-subtle">판 파일을 이 폴더에 둡니다. 템플릿 · 작성 기록은 앱 데이터에 둡니다.</p>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>기본 파일 이름 규칙</Label>
					<Input value={s.naming} onChange={(e) => setS({ ...s, naming: e.target.value })} placeholder="{제목}_v{판}_{날짜}" className="h-8 text-[13px] md:text-[13px]" />
					<p className="text-[12px] leading-relaxed text-subtle">
						산출물마다 「만드는 법」에서 따로 정할 수 있습니다. 쓸 수 있는 자리: <span className="mono text-muted-foreground">{"{제목} {판} {날짜} {시각} {프로젝트}"}</span>
						{preview && (
							<>
								<br />
								예: <span className="font-medium text-foreground">{preview}</span>
							</>
						)}
					</p>
				</div>
				<label className="flex items-center justify-between gap-3 text-[13px]">
					<span>이름의 빈칸을 _ 로 바꾸기</span>
					<Switch checked={s.namingUnderscore} onCheckedChange={(v) => setS({ ...s, namingUnderscore: v })} />
				</label>
				<div className="flex flex-col gap-1.5">
					<Label>지난 판을 옮길 폴더</Label>
					<Input value={s.archiveDir} onChange={(e) => setS({ ...s, archiveDir: e.target.value })} placeholder="예: 이전판 (비우면 옮기지 않음)" className="h-8 text-[13px]" />
					<p className="text-[12px] leading-relaxed break-keep text-subtle">새 판이 생기면 지난 판 파일을 산출물 폴더 안의 이 폴더로 옮깁니다. 산출물 폴더를 정했을 때만 씁니다.</p>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						취소
					</Button>
					<Button onClick={() => void save()}>저장</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function NewDialog({ project, open, onOpenChange, onCreated }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void; onCreated: (d: Deliverable) => void }) {
	const [title, setTitle] = useState("");
	const [busy, setBusy] = useState(false);
	const create = async () => {
		if (!title.trim()) return;
		setBusy(true);
		try {
			onCreated(await api.deliverableCreate(project.id, title));
			setTitle("");
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="pop gap-4 p-6 sm:max-w-md">
				<DialogHeader>
					<DialogTitle>새 산출물</DialogTitle>
					<DialogDescription className="leading-relaxed break-keep">만든 뒤 템플릿 · 참고 자료와 작성 지침을 넣고 Claude 에게 쓰게 합니다.</DialogDescription>
				</DialogHeader>
				<Input
					autoFocus
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && void create()}
					placeholder="예: 테이블 정의서"
					className="h-9"
				/>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						취소
					</Button>
					<Button disabled={busy || !title.trim()} onClick={() => void create()}>
						만들기
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function GenerateDialog({ project, open, onOpenChange, deliverable }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void; deliverable: Deliverable }) {
	const [request, setRequest] = useState("");
	const [busy, setBusy] = useState(false);
	const hasRecipe = !!deliverable.guide.trim() || !!deliverable.skill.trim() || deliverable.refs.length > 0;
	const submit = async () => {
		if (!request.trim() && !hasRecipe) return;
		setBusy(true);
		try {
			await api.deliverableGenerate(project.id, request, deliverable.id);
			onOpenChange(false);
			setRequest("");
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="pop gap-4 p-6 sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{deliverable.versions.length ? `「${deliverable.title}」 새 판 쓰기` : `「${deliverable.title}」 쓰기`}</DialogTitle>
					<DialogDescription className="leading-relaxed break-keep">
						{`${docFormat(deliverable)} 파일로 만들어 ${deliverable.outputDir} 에 둡니다.`}
					</DialogDescription>
				</DialogHeader>
				<Textarea
					autoFocus
					value={request}
					onChange={(e) => setRequest(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
					}}
					placeholder={hasRecipe ? "이번 판에 더할 요청. 비워 두면 작성 지침과 템플릿대로 씁니다." : "무엇을 쓸지. 예: 화면별 기능 설명. 화면마다 하는 일, 쓰는 API, 남은 일"}
					className="min-h-28 resize-none bg-transparent text-[13.5px] leading-relaxed"
				/>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						취소
					</Button>
					<Button disabled={busy || (!request.trim() && !hasRecipe)} onClick={() => void submit()}>
						쓰게 하기
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
