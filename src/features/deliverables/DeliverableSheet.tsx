import { type ReactNode, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ExternalLink, Eye, FolderOpen, Loader2, MoreHorizontal, PenLine, Trash2, Upload, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { type ActionList, ContextActions, DropdownActions, fileActions } from "@/components/ActionMenu";
import { Chip, SectionTitle } from "@/components/bits";
import { Markdown } from "@/components/Markdown";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { RunEvents } from "@/components/RunLog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, errorText } from "@/lib/api";
import { bytes, clock, dirname, fileUrl, isImage, isText, joinPath } from "@/lib/format";
import { lastEnded, useMarkSeen } from "@/lib/notices";
import { useDeliverables } from "@/lib/queries";
import { useUi } from "@/lib/store";
import type { Deliverable, Project, Version } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FileIcon, GenerateDialog, SOURCE_LABEL } from "./Deliverables";
import { RecipeTab } from "./RecipeTab";

export function DeliverableSheet({ project }: { project: Project }) {
	const id = useUi((s) => s.deliverableId);
	const openDeliverable = useUi((s) => s.openDeliverable);
	const { data } = useDeliverables(project.id);
	const d = data?.find((x) => x.id === id);
	// 열어 본 산출물의 새 판 · 실패는 알림함에서 뺀다.
	useMarkSeen(d?.id, d ? lastEnded(d.runs) : 0);
	return (
		<Sheet open={!!d} onOpenChange={(o) => !o && openDeliverable(null)}>
			<SheetContent
				side="right"
				showCloseButton={false}
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					(e.currentTarget as HTMLElement | null)?.focus();
				}}
				className="pop gap-0 overflow-hidden rounded-none p-0 outline-none data-[side=right]:top-9 data-[side=right]:bottom-0 data-[side=right]:h-auto data-[side=right]:w-[min(860px,64vw)] data-[side=right]:border-y-0 data-[side=right]:border-r-0 data-[side=right]:sm:max-w-none"
			>
				{d && <Detail key={d.id} project={project} d={d} onClose={() => openDeliverable(null)} />}
			</SheetContent>
		</Sheet>
	);
}

/** 판 파일의 자리. 옛 판은 경로 없이 앱 데이터의 v<n>/ 에 있다. */
export function versionPath(d: Deliverable, v: Version) {
	return v.path || joinPath(d.dir, `v${v.n}`, v.file);
}

type Tab = "versions" | "recipe";

function Detail({ project, d, onClose }: { project: Project; d: Deliverable; onClose: () => void }) {
	const latest = d.versions[d.versions.length - 1];
	const [selected, setSelected] = useState<number | null>(latest?.n ?? null);
	useEffect(() => setSelected(latest?.n ?? null), [latest?.n]);
	const v = d.versions.find((x) => x.n === selected) ?? latest;
	// 아직 판이 없으면 만드는 법부터 연다. 템플릿을 넣고 쓰게 하는 순서다.
	const [tab, setTab] = useState<Tab>(d.versions.length || d.job ? "versions" : "recipe");
	const [title, setTitle] = useState(d.title);
	const [note, setNote] = useState(d.note);
	const [gen, setGen] = useState(false);
	const [writing, setWriting] = useState(false);
	useEffect(() => {
		setTitle(d.title);
		setNote(d.note);
	}, [d.title, d.note]);
	useEffect(() => {
		if (d.job) setTab("versions");
	}, [d.job]);

	const saveMeta = () => {
		if (title === d.title && note === d.note) return;
		api.deliverableUpdate(project.id, d.id, { title, note, guide: d.guide, naming: d.naming, subdir: d.subdir, mode: d.mode, autoUpdate: d.autoUpdate }).catch((e) => toast.error(errorText(e)));
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex flex-col gap-1.5 px-6 pt-4 pb-3">
				<div className="flex min-h-7 items-center gap-2 text-[12px] text-subtle">
					{d.job && <Chip tone="run">{d.job.phase === "queued" ? "대기 중" : "Claude 가 쓰는 중"}</Chip>}
					<div className="flex-1" />
					<Menu project={project} d={d} />
					<Button size="icon-sm" variant="ghost" aria-label="닫기" onClick={onClose}>
						<X />
					</Button>
				</div>
				<SheetTitle asChild>
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						onBlur={saveMeta}
						onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
						placeholder="제목"
						className="h-auto border-transparent bg-transparent px-0 text-[19px] font-semibold tracking-[-0.02em] shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-[19px] dark:bg-transparent"
					/>
				</SheetTitle>
				<SheetDescription className="sr-only">산출물 상세</SheetDescription>
				<Input
					value={note}
					onChange={(e) => setNote(e.target.value)}
					onBlur={saveMeta}
					placeholder="한 줄 설명 (받는 곳 · 쓰임)"
					className="h-7 border-transparent bg-transparent px-0 text-[13px] text-muted-foreground shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
				/>
			</header>

			<Tabs value={tab} onValueChange={(t) => setTab(t as Tab)} className="min-h-0 flex-1 gap-0">
				<div className="border-b border-border px-6">
					<TabsList variant="line" className="h-9 gap-4 p-0">
						<TabsTrigger value="versions" className="px-0">
							판{d.versions.length > 0 && <span className="tabular text-subtle">{d.versions.length}</span>}
						</TabsTrigger>
						<TabsTrigger value="recipe" className="px-0">
							만드는 법
							{d.learn ? <Loader2 className="size-3.5 animate-spin text-subtle" /> : d.refs.length > 0 && <span className="tabular text-subtle">{d.refs.length}</span>}
						</TabsTrigger>
					</TabsList>
				</div>
				<div data-scroll className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					<TabsContent value="versions">
						{d.job && (
							<section className="mb-6 flex flex-col gap-2">
								<SectionTitle>작성 기록</SectionTitle>
								<div className="surface rounded-md px-3 py-2">
									<RunEvents projectId={project.id} target="deliverable" targetId={d.id} runId={d.job.runId} live={d.job.phase === "running"} />
								</div>
								<p className="text-[12.5px] text-subtle">요청: {d.job.request || "작성 지침대로"}</p>
							</section>
						)}
						{d.error && !d.job && (
							<div className="mb-5 flex items-start gap-3 rounded-md border border-danger/40 px-3.5 py-2.5">
								<pre className="min-w-0 flex-1 font-sans text-[12.5px] whitespace-pre-wrap text-danger selectable">{d.error}</pre>
								<Button size="sm" variant="ghost" onClick={() => void api.deliverableClearError(project.id, d.id)}>
									닫기
								</Button>
							</div>
						)}
						{writing ? (
							<Writer project={project} d={d} onDone={() => setWriting(false)} />
						) : v ? (
							<VersionView project={project} d={d} v={v} isLatest={v.n === latest?.n} />
						) : (
							!d.job && (
								<p className="text-[13px] leading-relaxed break-keep text-subtle">
									아직 판이 없습니다. 만드는 법에 템플릿 · 작성 지침을 넣고 Claude 에게 쓰게 하거나, 직접 쓰거나, 파일을 올리세요.
								</p>
							)
						)}

						{d.versions.length > 1 && !writing && (
							<section className="mt-8 flex flex-col gap-2">
								<SectionTitle>판</SectionTitle>
								<ul className="surface divide-y divide-border overflow-hidden rounded-md">
									{[...d.versions].reverse().map((x) => (
										<li key={x.n}>
											<ContextActions items={[{ label: "이 판 보기", icon: <Eye />, onSelect: () => setSelected(x.n) }, "sep", ...fileActions(versionPath(d, x))]}>
												<button
													type="button"
													onClick={() => setSelected(x.n)}
													className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-hover", x.n === v?.n && "bg-hover")}
												>
													<span className="tabular w-8 font-medium">v{x.n}</span>
													<FileIcon name={x.file} className="text-subtle" />
													<span className="min-w-0 flex-1 truncate">{x.file}</span>
													<Chip>{SOURCE_LABEL[x.source] ?? x.source}</Chip>
													<span className="tabular w-24 text-right text-[12px] text-subtle">{clock(x.addedAt)}</span>
												</button>
											</ContextActions>
										</li>
									))}
								</ul>
							</section>
						)}
					</TabsContent>
					<TabsContent value="recipe">
						<RecipeTab project={project} d={d} />
					</TabsContent>
				</div>
			</Tabs>

			<div className="flex items-center gap-2 border-t border-border px-6 py-3">
				{d.job ? (
					<>
						<div className="flex-1" />
						<Button variant="outline" onClick={() => void api.deliverableStop(project.id, d.id)}>
							중지
						</Button>
					</>
				) : (
					<>
						{v && (
							<>
								<Button variant="ghost" onClick={() => void api.open(versionPath(d, v)).catch((e) => toast.error(errorText(e)))}>
									<ExternalLink />
									열기
								</Button>
								<Button variant="ghost" onClick={() => void api.reveal(versionPath(d, v)).catch((e) => toast.error(errorText(e)))}>
									<FolderOpen />
									폴더
								</Button>
							</>
						)}
						<div className="flex-1" />
						<Button
							variant="outline"
							disabled={writing}
							onClick={() => {
								setTab("versions");
								setWriting(true);
							}}
						>
							<PenLine />
							직접 쓰기
						</Button>
						<Button onClick={() => setGen(true)}>
							<Wand2 />
							{d.versions.length ? "새 판 쓰게 하기" : "Claude 에게 쓰게 하기"}
						</Button>
					</>
				)}
			</div>
			<GenerateDialog project={project} open={gen} onOpenChange={setGen} deliverable={d} />
		</div>
	);
}

/** 새 판을 손으로 쓴다. 마지막 판이 글이면 그것을 바탕으로 연다. */
function Writer({ project, d, onDone }: { project: Project; d: Deliverable; onDone: () => void }) {
	const latest = d.versions[d.versions.length - 1];
	const base = latest && isText(latest.file);
	const { data: content } = useQuery({
		queryKey: ["deliverable-text", d.id, latest?.n, latest?.size],
		queryFn: () => api.deliverableReadText(project.id, d.id, latest!.n),
		enabled: !!base,
	});
	const [draft, setDraft] = useState<string | null>(null);
	const value = draft ?? (base ? (content ?? "") : "");
	const save = async () => {
		try {
			await api.deliverableSaveDoc(project.id, d.id, value, true);
			toast("새 판으로 저장했습니다");
			onDone();
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	return (
		<section className="flex flex-col gap-3">
			<p className="text-[12.5px] text-subtle">
				저장하면 <span className="mono text-muted-foreground">{d.nextName}</span> 로 새 판이 됩니다.
			</p>
			<div className="surface rounded-md px-4 py-3">
				<MarkdownEditor value={value} onChange={setDraft} minHeight="360px" onSave={() => void save()} autoFocus placeholder="마크다운으로 적습니다" />
			</div>
			<div className="flex justify-end gap-2">
				<Button variant="ghost" onClick={onDone}>
					취소
				</Button>
				<Button disabled={!value.trim()} onClick={() => void save()}>
					새 판으로 저장
				</Button>
			</div>
		</section>
	);
}

function VersionView({ project, d, v, isLatest }: { project: Project; d: Deliverable; v: Version; isLatest: boolean }) {
	const text = isText(v.file);
	const { data: content, refetch } = useQuery({
		queryKey: ["deliverable-text", d.id, v.n, v.size],
		queryFn: () => api.deliverableReadText(project.id, d.id, v.n),
		enabled: text,
	});
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const path = versionPath(d, v);

	const save = async () => {
		try {
			await api.deliverableSaveDoc(project.id, d.id, draft, false);
			setEditing(false);
			void refetch();
			toast("저장했습니다");
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	return (
		<section className="flex flex-col gap-3">
			<div className="flex items-center gap-2 text-[12.5px] text-subtle">
				<FileIcon name={v.file} />
				<span className="min-w-0 truncate text-foreground" title={path}>
					{v.file}
				</span>
				<span>{bytes(v.size)}</span>
				<Chip>{SOURCE_LABEL[v.source] ?? v.source}</Chip>
				<div className="flex-1" />
				{text && isLatest && !editing && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => {
							setDraft(content ?? "");
							setEditing(true);
						}}
					>
						이 판 고치기
					</Button>
				)}
			</div>
			{v.note && <p className="text-[13px] break-keep text-muted-foreground">{v.note}</p>}
			{text ? (
				editing ? (
					<div className="flex flex-col gap-3">
						<div className="surface rounded-md px-4 py-3">
							<MarkdownEditor value={draft} onChange={setDraft} minHeight="360px" onSave={() => void save()} autoFocus />
						</div>
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => setEditing(false)}>
								취소
							</Button>
							<Button onClick={() => void save()}>이 판에 저장</Button>
						</div>
					</div>
				) : (
					<Markdown text={content ?? ""} base={dirname(path)} className="text-[14px]" />
				)
			) : isImage(v.file) ? (
				<img src={fileUrl(path)} alt={v.file} className="max-h-[60vh] w-fit rounded-md border border-border object-contain" />
			) : (
				<div className="surface rounded-md px-4 py-8 text-center text-[13px] text-subtle">앱 안에서는 미리 보지 않는 형식입니다. 열기를 눌러 기본 프로그램으로 엽니다.</div>
			)}
		</section>
	);
}

/** 새 판 올리기 · 저장 폴더 · 지우기와 그 확인 창. 상세 창의 「더 보기」와 목록 줄의 우클릭이 같이 쓴다. */
export function useDeliverableActions(project: Project, d: Deliverable): { items: ActionList; dialogs: ReactNode } {
	const [confirm, setConfirm] = useState(false);
	const items: ActionList = [
		{
			label: "새 판 파일 올리기",
			icon: <Upload />,
			onSelect: async () => {
				const picked = await openDialog({ multiple: false, title: "새 판으로 올릴 파일" });
				if (typeof picked === "string") await api.deliverableImport(project.id, [picked], d.id).catch((e) => toast.error(errorText(e)));
			},
		},
		{ label: "저장 폴더 열기", icon: <FolderOpen />, onSelect: () => void api.open(d.outputDir).catch((e) => toast.error(errorText(e))) },
		"sep",
		{ label: "지우기", icon: <Trash2 />, destructive: true, disabled: !!d.job, onSelect: () => setConfirm(true) },
	];
	const dialogs = (
		<AlertDialog open={confirm} onOpenChange={setConfirm}>
			<AlertDialogContent className="pop">
				<AlertDialogHeader>
					<AlertDialogTitle>「{d.title}」 를 지울까요?</AlertDialogTitle>
					<AlertDialogDescription className="leading-relaxed break-keep">
						정보 · 템플릿 · 작성 기록을 앱 데이터의 휴지통 폴더로 옮깁니다.
						{project.deliverablesDir ? " 산출물 폴더에 둔 판 파일은 그대로 둡니다." : " 앱 데이터에 둔 판 파일도 함께 옮깁니다."}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>취소</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() =>
							void api
								.deliverableDelete(project.id, d.id)
								.then(() => {
									// 목록에서 지웠어도 그 산출물의 상세 창이 열려 있으면 닫는다.
									const ui = useUi.getState();
									if (ui.deliverableId === d.id) ui.openDeliverable(null);
								})
								.catch((e) => toast.error(errorText(e)))
						}
					>
						지우기
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
	return { items, dialogs };
}

function Menu({ project, d }: { project: Project; d: Deliverable }) {
	const { items, dialogs } = useDeliverableActions(project, d);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="icon-sm" variant="ghost" aria-label="더 보기">
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="pop w-52">
					<DropdownActions items={items} />
				</DropdownMenuContent>
			</DropdownMenu>
			{dialogs}
		</>
	);
}
