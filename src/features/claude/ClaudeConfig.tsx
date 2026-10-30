import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, FolderOpen, MoreHorizontal, PanelRight, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type ActionList, attempt, ContextActions, copy, DropdownActions } from "@/components/ActionMenu";
import { Empty, Label } from "@/components/bits";
import { RuleLines } from "@/features/project/ProjectHeader";
import { Markdown } from "@/components/Markdown";
import { MarkdownEditor } from "@/components/MarkdownEditor";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText } from "@/lib/api";
import { joinPath, relTime } from "@/lib/format";
import { qk, useAppInfo, useProjects, useResources } from "@/lib/queries";
import { useUi } from "@/lib/store";
import type { Resource, ResourceKind, TextFile } from "@/lib/types";
import { cn } from "@/lib/utils";

const KINDS: { kind: ResourceKind; label: string }[] = [
	{ kind: "instructions", label: "지침" },
	{ kind: "skill", label: "스킬" },
	{ kind: "agent", label: "에이전트" },
	{ kind: "command", label: "명령" },
	{ kind: "rule", label: "규칙" },
	{ kind: "settings", label: "설정 파일" },
	{ kind: "folder", label: "폴더" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.kind, k.label])) as Record<ResourceKind, string>;
/** 「새로 만들기」로 만들 수 있는 것. 지침은 첫 자리가 늘 보이고, 설정 파일 · 폴더는 여기서 만들지 않는다. */
const CREATABLE = KINDS.filter((k) => ["skill", "agent", "command", "rule"].includes(k.kind));

/**
 * 프로젝트를 고르면 그 프로젝트의 실행에 실제로 실리는 것을 이 차례로 보인다. Claude Code 가 쌓는 순서와 같다.
 * 상위 폴더 지침은 작업 폴더에서 드라이브 루트까지 올라가며 실리는 CLAUDE.md 다 — 화면에 없으면 실리는 줄 모른다.
 */
const LAYERS: { key: string; label: string; note?: string; kinds: boolean; match: (r: Resource) => boolean }[] = [
	{ key: "global", label: "전역", note: "자동 메모리는 docket 실행에서 꺼집니다", kinds: true, match: (r) => r.scope === "global" && r.kind !== "settings" },
	{ key: "parent", label: "상위 폴더", kinds: false, match: (r) => r.scope === "parent" },
	{ key: "project", label: "프로젝트", kinds: true, match: (r) => r.scope === "project" && r.kind !== "settings" },
	{ key: "extra", label: "함께 여는 폴더", note: "프로젝트 설정에서 정합니다", kinds: false, match: (r) => r.scope === "extra" },
	{ key: "settings", label: "설정", kinds: false, match: (r) => r.kind === "settings" },
];

type Scope = "global" | "project";

export function ClaudeConfig() {
	const qc = useQueryClient();
	const claudeProjectId = useUi((s) => s.claudeProjectId);
	const setClaudeProject = useUi((s) => s.setClaudeProject);
	const { data: projects = [] } = useProjects();
	// 목록에서 빠진 프로젝트를 가리키고 있으면 전역으로 본다. 그 id 로 조회하면 백엔드가 오류를 낸다.
	const project = projects.find((p) => p.id === claudeProjectId);
	const { data: info } = useAppInfo();
	const scope: Scope = project ? "project" : "global";
	const { data: all = [] } = useResources(project?.id ?? null);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [file, setFile] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [pending, setPending] = useState<(() => void) | null>(null);
	const [creating, setCreating] = useState<ResourceKind | null>(null);
	/** 목록 우클릭에서 지우려는 것. 편집 화면의 「더 보기」는 편집 화면이 따로 묻는다. */
	const [deleting, setDeleting] = useState<Resource | null>(null);

	const items = useMemo(() => {
		const q = query.trim().toLowerCase();
		// 전역을 볼 때는 전역 층만, 프로젝트를 볼 때는 그 프로젝트에 실리는 층을 모두 보인다.
		return all.filter((r) => (scope === "project" || r.scope === "global") && (!q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)));
	}, [all, scope, query]);

	const current = all.find((r) => r.path === selected) ?? items[0];
	const currentFile = file && current?.dir ? joinPath(current.dir, file) : current?.path;

	/** 고친 것을 저장하지 않고 다른 곳으로 가려 하면 한 번 묻는다. */
	const guard = (fn: () => void) => {
		if (dirty) setPending(() => fn);
		else fn();
	};

	/** 범위(전역 · 프로젝트)를 바꾼다. 다른 범위의 목록이 오므로 고른 것도 비운다. */
	const pickScope = (id: string | null) =>
		guard(() => {
			setClaudeProject(id);
			setSelected(null);
			setFile(null);
		});

	const home = info?.claudeHome ?? "";
	const short = (p: string) => (home && p.toLowerCase().startsWith(home.toLowerCase()) ? "~/.claude" + p.slice(home.length).replace(/\\/g, "/") : p);

	return (
		<div className="flex min-h-0 flex-1 gap-4">
			<aside className="flex w-72 shrink-0 flex-col gap-3">
				{/* 프로젝트를 여기서 바로 고른다. 사이드바로 가서 프로젝트를 누르면 보드로 넘어가 버려 다시 돌아와야 한다. */}
				<div className="flex gap-0.5 rounded-lg bg-secondary p-0.5">
					<button
						type="button"
						onClick={() => scope !== "global" && pickScope(null)}
						className={cn(
							"h-7 shrink-0 rounded-md px-3 text-[12.5px] font-medium text-muted-foreground transition-colors",
							scope === "global" && "bg-hover text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]",
						)}
					>
						전역
					</button>
					<Select value={project?.id ?? ""} onValueChange={(id) => pickScope(id)} disabled={projects.length === 0}>
						<SelectTrigger
							size="sm"
							aria-label="프로젝트 고르기"
							className={cn(
								"h-7 min-w-0 flex-1 rounded-md border-0 bg-transparent px-3 text-[12.5px] font-medium text-muted-foreground shadow-none dark:bg-transparent dark:hover:bg-transparent data-placeholder:text-muted-foreground",
								scope === "project" && "bg-hover text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)] dark:bg-hover dark:hover:bg-hover",
							)}
						>
							<SelectValue placeholder="프로젝트" />
						</SelectTrigger>
						<SelectContent className="pop" position="popper" align="end">
							{projects.map((p) => (
								<SelectItem key={p.id} value={p.id} title={p.path}>
									{p.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex gap-2">
					<div className="relative flex-1">
						<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
						<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름 · 설명 찾기" className="h-8 pl-8 text-[13px]" />
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="icon" variant="outline" aria-label="새로 만들기">
								<Plus />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="pop">
							{CREATABLE.map((k) => (
								<DropdownMenuItem key={k.kind} onSelect={() => setCreating(k.kind)}>
									새 {k.label}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				<div className="-mr-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
					{LAYERS.map((layer) => {
						const inLayer = items.filter(layer.match);
						if (inLayer.length === 0) return null;
						const groups = layer.kinds ? KINDS.map((k) => ({ ...k, list: inLayer.filter((r) => r.kind === k.kind) })).filter((g) => g.list.length > 0) : [{ kind: layer.key, label: "", list: inLayer }];
						return (
							<section key={layer.key} className="flex flex-col gap-2">
								{/* 전역만 볼 때는 층이 하나라 머리를 달지 않는다 */}
								{scope === "project" && (
									<div className="flex flex-col border-b border-border px-2 pb-1">
										<span className="text-[12.5px] font-semibold">{layer.label}</span>
										{layer.note && <span className="text-[11.5px] text-subtle">{layer.note}</span>}
									</div>
								)}
								{groups.map((g) => (
									<div key={g.kind} className="flex flex-col gap-0.5">
										{g.label && (
											<Label className="flex items-center gap-1.5 px-2 pb-1">
												{g.label}
												<span className="tabular font-normal text-subtle">{g.list.length}</span>
											</Label>
										)}
										{g.list.map((r) => {
											const pick = () =>
												guard(() => {
													setSelected(r.path);
													setFile(null);
												});
											return (
												<ContextActions key={r.path} items={resourceActions(r, () => setDeleting(r), pick)}>
													<button
														type="button"
														onClick={pick}
														title={r.scope === "parent" || r.scope === "extra" ? r.path : undefined}
														className={cn(
															"flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover",
															current?.path === r.path && "bg-hover shadow-[inset_0_0_0_1px_var(--border-strong)]",
														)}
													>
														<span className={cn("truncate text-[13px] font-medium", (!r.exists || r.excluded) && "text-subtle")}>{r.name}</span>
														{r.excluded && <span className="text-[11.5px] text-subtle">docket 실행에서는 빠짐</span>}
														{r.description ? (
															<span className="line-clamp-2 text-[12px] leading-snug break-keep text-subtle">{r.description}</span>
														) : (
															!r.exists && <span className="text-[12px] text-subtle">아직 없습니다. 저장하면 만듭니다.</span>
														)}
													</button>
												</ContextActions>
											);
										})}
									</div>
								))}
							</section>
						);
					})}
					{scope === "global" && <p className="px-2 text-[11.5px] leading-relaxed break-keep text-subtle">자동 메모리는 docket 실행에서 꺼집니다</p>}
					{items.length === 0 && <Empty>찾는 것이 없습니다</Empty>}
				</div>
			</aside>

			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{current?.kind === "settings" ? (
					<SettingsView key={current.path} resource={current} shortPath={short(current.path)} />
				) : current?.kind === "folder" ? (
					<FolderView key={current.path} resource={current} />
				) : current && currentFile ? (
					<ResourceEditor
						key={currentFile}
						resource={current}
						projectId={project?.id ?? null}
						path={currentFile}
						file={file}
						onFile={(f) => guard(() => setFile(f))}
						shortPath={short(currentFile)}
						onDirty={setDirty}
						onDeleted={() => {
							setSelected(null);
							setFile(null);
							void qc.invalidateQueries({ queryKey: qk.resources(project?.id ?? null) });
						}}
					/>
				) : (
					<Empty className="py-24">왼쪽에서 고를 것을 누르세요</Empty>
				)}
			</div>

			<AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
				<AlertDialogContent className="pop">
					<AlertDialogHeader>
						<AlertDialogTitle>저장하지 않은 변경이 있습니다</AlertDialogTitle>
						<AlertDialogDescription>이대로 옮기면 고친 내용이 사라집니다.</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>머무르기</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								setDirty(false);
								pending?.();
								setPending(null);
							}}
						>
							버리고 옮기기
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<DeleteConfirm
				resource={deleting}
				onClose={() => setDeleting(null)}
				onDeleted={() => {
					// 편집 중인 것을 지웠으면 고친 내용도 함께 버린다. 파일이 없으니 저장할 곳이 없다.
					if (deleting?.path === current?.path) {
						setDirty(false);
						setSelected(null);
						setFile(null);
					}
					void qc.invalidateQueries({ queryKey: qk.resources(project?.id ?? null) });
				}}
			/>

			<CreateDialog
				kind={creating}
				scope={scope}
				projectId={project?.id ?? null}
				onClose={() => setCreating(null)}
				onCreated={(path) => {
					void qc.invalidateQueries({ queryKey: qk.resources(project?.id ?? null) });
					setSelected(path);
					setFile(null);
				}}
			/>
		</div>
	);
}

function ResourceEditor({
	resource,
	projectId,
	path,
	file,
	onFile,
	shortPath,
	onDirty,
	onDeleted,
}: {
	resource: Resource;
	/** 저장 뒤 새로 고칠 목록의 프로젝트. 사이드바의 현재 프로젝트를 쓰면 다른 프로젝트의 목록만 새로 고쳐진다. */
	projectId: string | null;
	path: string;
	file: string | null;
	onFile: (f: string | null) => void;
	shortPath: string;
	onDirty: (d: boolean) => void;
	onDeleted: () => void;
}) {
	const qc = useQueryClient();
	const { data: text, error, refetch } = useQuery({ queryKey: ["text", path], queryFn: () => api.textRead(path), staleTime: 0 });
	const [draft, setDraftState] = useState<string | null>(null);
	const [preview, setPreview] = useState(false);
	const [conflict, setConflict] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const markdownFile = /\.md$/i.test(path);

	const setDraft = (v: string | null) => {
		setDraftState(v);
		onDirty(v !== null);
	};

	const save = async (force = false) => {
		if (!text || draft === null) return;
		try {
			const next: TextFile = await api.textWrite(text, draft, force);
			qc.setQueryData(["text", path], next);
			setDraft(null);
			setConflict(false);
			void qc.invalidateQueries({ queryKey: qk.resources(projectId) });
			toast("저장했습니다");
		} catch (e) {
			if (errorText(e) === "conflict") setConflict(true);
			else toast.error(errorText(e));
		}
	};

	const others = resource.files.filter((f) => !/^skill\.md$/i.test(f));
	const value = draft ?? text?.content ?? "";

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<header className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h2 className="truncate text-[17px] font-semibold tracking-[-0.015em]">{resource.name}</h2>
						<span className="text-[12px] text-subtle">{KIND_LABEL[resource.kind]}</span>
						{draft !== null && <span className="text-[12px] text-foreground">· 저장 안 됨</span>}
					</div>
					<button type="button" className="mono mt-0.5 block max-w-full truncate text-[12px] text-subtle hover:text-foreground" title="폴더에서 보기" onClick={() => void api.reveal(path).catch(() => {})}>
						{shortPath}
					</button>
				</div>
				{markdownFile && (
					<div className="inline-flex shrink-0 rounded-lg bg-secondary p-0.5">
						{[false, true].map((p) => (
							<button
								key={String(p)}
								type="button"
								onClick={() => setPreview(p)}
								className={cn("h-7 rounded-md px-2.5 text-[12px] font-medium text-muted-foreground", preview === p && "bg-hover text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]")}
							>
								{p ? "미리보기" : "편집"}
							</button>
						))}
					</div>
				)}
				{/* 고친 것이 없을 때는 노란색을 쓰지 않는다. 흐린 노란 단추가 결정할 일이 있는 것처럼 보인다. */}
				<Button variant={draft === null ? "outline" : "default"} disabled={draft === null} onClick={() => void save()}>
					저장
				</Button>
				{resource.kind !== "instructions" && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="icon" variant="ghost" aria-label="더 보기">
								<MoreHorizontal />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="pop w-48">
							<DropdownActions items={resourceActions(resource, () => setConfirmDelete(true))} />
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</header>

			{resource.kind === "skill" && others.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{["SKILL.md", ...others].map((f) => {
						const active = f === "SKILL.md" ? file === null : file === f;
						return (
							<button
								key={f}
								type="button"
								onClick={() => onFile(f === "SKILL.md" ? null : f)}
								className={cn(
									"mono h-7 rounded-md px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground",
									active && "bg-hover text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]",
								)}
							>
								{f}
							</button>
						);
					})}
				</div>
			)}

			<div className="surface min-h-0 flex-1 overflow-y-auto rounded-xl px-5 py-4" data-scroll>
				{error ? (
					<p className="text-[13px] text-danger">{errorText(error)}</p>
				) : !text ? null : preview && markdownFile ? (
					<Markdown text={value} />
				) : (
					<MarkdownEditor
						value={value}
						onChange={(v) => setDraft(v === text.content ? null : v)}
						onSave={() => void save()}
						minHeight="100%"
						plain={!markdownFile}
						placeholder={resource.kind === "instructions" ? "모든 세션에 들어갈 지침을 적습니다" : ""}
					/>
				)}
			</div>
			{text && (
				<footer className="flex items-center gap-3 text-[12px] text-subtle">
					<span>{text.exists ? `${relTime(text.modified)} 고침` : "새 파일"}</span>
					<span>{text.crlf ? "CRLF" : "LF"}</span>
					{text.bom && <span>BOM</span>}
					<span className="ml-auto">Ctrl S 로 저장</span>
				</footer>
			)}

			<AlertDialog open={conflict} onOpenChange={setConflict}>
				<AlertDialogContent className="pop">
					<AlertDialogHeader>
						<AlertDialogTitle>다른 곳에서 이 파일이 바뀌었습니다</AlertDialogTitle>
						<AlertDialogDescription>
							열어 둔 사이 다른 편집기나 Claude 세션이 고쳤습니다. 다시 불러오면 이쪽에서 고친 것이 사라지고, 덮어쓰면 그쪽에서 고친 것이 사라집니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel
							onClick={() => {
								setDraft(null);
								void refetch();
							}}
						>
							다시 불러오기
						</AlertDialogCancel>
						<AlertDialogAction variant="destructive" onClick={() => void save(true)}>
							덮어쓰기
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<DeleteConfirm
				resource={confirmDelete ? resource : null}
				onClose={() => setConfirmDelete(false)}
				onDeleted={() => {
					onDirty(false);
					onDeleted();
				}}
			/>
		</div>
	);
}

/**
 * settings.json 은 읽기 전용으로 보인다. 고치는 것은 「파일 열기」로 다른 편집기에서 한다 —
 * JSON 을 한 글자 깨뜨리면 그 파일의 거부 규칙(SVN 쓰기 금지 등)이 통째로 빠진다.
 */
function SettingsView({ resource, shortPath }: { resource: Resource; shortPath: string }) {
	const r = resource.rules;
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<header className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h2 className="truncate text-[17px] font-semibold tracking-[-0.015em]">{resource.name}</h2>
						<span className="text-[12px] text-subtle">설정 파일 · 읽기 전용</span>
					</div>
					<button type="button" className="mono mt-0.5 block max-w-full truncate text-[12px] text-subtle hover:text-foreground" title="폴더에서 보기" onClick={() => void api.reveal(resource.path).catch(() => {})}>
						{shortPath}
					</button>
				</div>
				<Button variant="outline" onClick={() => void attempt(() => api.open(resource.path))}>
					<ExternalLink />
					파일 열기
				</Button>
			</header>
			<div className="surface flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl px-5 py-4 text-[12px]" data-scroll>
				{r && (
					<>
						<RuleLines label="거부" rules={r.deny} />
						<RuleLines label="허용" rules={r.allow} />
						{r.ask.length > 0 && <RuleLines label="묻기" rules={r.ask} />}
						<RuleLines label="훅" rules={r.hooks ?? []} />
						{r.defaultMode && <RuleLines label="기본 모드" rules={[r.defaultMode]} />}
					</>
				)}
				<p className="leading-relaxed break-keep text-subtle">
					docket 실행도 이 파일을 읽어 앱의 규칙과 합칩니다. 거부가 허용보다 앞섭니다. 묻기 규칙은 앱 실행에서 묻지 못해 막힙니다. 기본 모드는 앱이 실행마다 정해 주므로 따르지 않습니다.
				</p>
			</div>
		</div>
	);
}

/** 함께 여는 폴더 한 줄. 폴더 안 파일은 Claude 가 읽고 고칠 수 있지만 그 폴더의 CLAUDE.md 는 실리지 않는다. */
function FolderView({ resource }: { resource: Resource }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			<header className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h2 className="mono truncate text-[15px] font-semibold">{resource.name}</h2>
						<span className="shrink-0 text-[12px] text-subtle">함께 여는 폴더</span>
					</div>
					{!resource.exists && <p className="mt-0.5 text-[12px] text-danger">폴더가 없어 실행에 넘기지 않습니다</p>}
				</div>
				{resource.exists && (
					<Button variant="outline" onClick={() => void attempt(() => api.open(resource.path))}>
						<FolderOpen />
						폴더 열기
					</Button>
				)}
			</header>
			<div className="surface flex flex-col gap-2 rounded-xl px-5 py-4 text-[13px] leading-relaxed break-keep">
				<p>실행마다 --add-dir 로 이 폴더를 함께 엽니다. 계획 · 읽기 대화 · 산출물에서는 읽기만, 구현과 편집 대화에서는 고치기까지 됩니다.</p>
				<p className="text-subtle">이 폴더의 CLAUDE.md 는 실리지 않습니다. 저장소 지침이 그 파일을 열라고 시키면 읽을 수 있을 뿐입니다. 목록은 프로젝트 설정의 「함께 여는 폴더」에서 고칩니다.</p>
			</div>
		</div>
	);
}

/** 편집 화면의 「더 보기」와 목록 우클릭이 같이 쓴다. 목록에서만 `onOpen` 을 준다. 지침 · 설정 파일 · 폴더는 지우지 않는다. */
function resourceActions(r: Resource, onDelete: () => void, onOpen?: () => void): ActionList {
	const removable = CREATABLE.some((k) => k.kind === r.kind) && r.exists;
	return [
		onOpen && { label: "열기", icon: <PanelRight />, onSelect: onOpen },
		"sep",
		r.kind === "settings" && { label: "파일 열기", icon: <ExternalLink />, onSelect: () => void attempt(() => api.open(r.path)) },
		r.exists && { label: "폴더 열기", icon: <FolderOpen />, onSelect: () => void attempt(() => api.reveal(r.dir || r.path)) },
		{ label: "경로 복사", icon: <Copy />, onSelect: () => void copy(r.path, "경로") },
		"sep",
		removable && { label: "지우기", icon: <Trash2 />, destructive: true, onSelect: onDelete },
	];
}

/** 편집 화면의 「더 보기」와 목록 우클릭이 같이 쓴다. `resource` 가 있으면 열린다. */
function DeleteConfirm({ resource, onClose, onDeleted }: { resource: Resource | null; onClose: () => void; onDeleted: () => void }) {
	// 닫히는 동안에도 글이 남아 있게 마지막으로 연 것을 쥐고 있는다. 바로 비우면 빈 창이 줄어들며 사라진다.
	const last = useRef(resource);
	if (resource) last.current = resource;
	const r = last.current;
	return (
		<AlertDialog open={!!resource} onOpenChange={(o) => !o && onClose()}>
			<AlertDialogContent className="pop">
				{r && (
					<>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{KIND_LABEL[r.kind]} 「{r.name}」 를 지울까요?
							</AlertDialogTitle>
							<AlertDialogDescription>
								{r.kind === "skill" ? "스킬 폴더째" : "이 파일을"} 앱 데이터의 휴지통 폴더로 옮깁니다. 다음 Claude 세션부터 쓰이지 않습니다.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>취소</AlertDialogCancel>
							<AlertDialogAction variant="destructive" onClick={() => void api.resourceDelete(r.path).then(onDeleted).catch((e) => toast.error(errorText(e)))}>
								지우기
							</AlertDialogAction>
						</AlertDialogFooter>
					</>
				)}
			</AlertDialogContent>
		</AlertDialog>
	);
}

function CreateDialog({
	kind,
	scope,
	projectId,
	onClose,
	onCreated,
}: {
	kind: ResourceKind | null;
	scope: Scope;
	projectId: string | null;
	onClose: () => void;
	onCreated: (path: string) => void;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [busy, setBusy] = useState(false);
	const valid = /^[A-Za-z0-9_-]+$/.test(name);
	const where = scope === "global" ? "~/.claude" : "프로젝트의 .claude";

	const submit = async () => {
		if (!kind || !valid) return;
		setBusy(true);
		try {
			const path = await api.resourceCreate(kind, scope, projectId, name, description);
			onCreated(path);
			onClose();
			setName("");
			setDescription("");
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={!!kind} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="pop gap-4 p-6 sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>새 {kind ? KIND_LABEL[kind] : ""}</DialogTitle>
					<DialogDescription>{where} 아래에 만듭니다.</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1.5">
					<Label>이름</Label>
					<Input value={name} onChange={(e) => setName(e.target.value)} placeholder="영문 · 숫자 · - · _" autoFocus aria-invalid={!!name && !valid} />
					{name && !valid && <span className="text-[12px] text-danger">영문 · 숫자 · - · _ 만 씁니다</span>}
				</div>
				{kind !== "rule" && (
					<div className="flex flex-col gap-1.5">
						<Label>설명</Label>
						<Textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder={kind === "skill" ? "언제 이 스킬을 쓰는지. Claude 는 이 설명을 보고 스킬을 고릅니다." : "무엇을 하는지"}
							className="min-h-20 resize-none bg-transparent text-[13.5px]"
						/>
					</div>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						취소
					</Button>
					<Button disabled={!valid || busy} onClick={() => void submit()}>
						만들기
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
