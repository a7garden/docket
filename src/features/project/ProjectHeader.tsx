import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { BookA, BookMarked, Check, ChevronRight, Copy, FileStack, FolderOpen, FolderPlus, LayoutGrid, Library, MessagesSquare, MoreHorizontal, Plus, Settings2, Unlink, X } from "lucide-react";
import { toast } from "sonner";
import { type ActionList, attempt, copy, DropdownActions } from "@/components/ActionMenu";
import { Label } from "@/components/bits";
import { KeyTip } from "@/components/KeyTip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText } from "@/lib/api";
import { keyAnchor } from "@/lib/keys";
import { type NoticeView, useNoticeCounts } from "@/lib/notices";
import { qk } from "@/lib/queries";
import { useUi, type View } from "@/lib/store";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 프로젝트 머리의 화면 탭. Ctrl+1~5 가 이 순서를 그대로 따른다 — 숫자가 곧 탭 자리다.
 * 탭 순서를 바꾸면 키 숫자도 함께 바뀐다.
 */
export const PROJECT_TABS: [View, string][] = [
	["board", "보드"],
	["talks", "대화"],
	["deliverables", "산출물"],
	["knowledge", "지식베이스"],
	["glossary", "어휘 사전"],
];

/** 프로젝트를 고르고(이미 보던 것이면 연 이슈를 닫지 않는다) 그 프로젝트의 화면으로 간다. */
export function goProject(id: string, view?: View) {
	const ui = useUi.getState();
	if (ui.projectId !== id) ui.setProject(id);
	// 프로젝트 머리는 보드 · 대화 · 산출물 · 지식베이스 · 어휘 사전에만 있다. Claude 설정 · 설정 화면에서 불렀으면 보드로 간다.
	const next = view ?? (ui.view === "talks" || ui.view === "deliverables" || ui.view === "knowledge" || ui.view === "glossary" ? ui.view : "board");
	if (ui.view !== next) ui.setView(next);
}

/**
 * 프로젝트 메뉴. 머리의 「프로젝트 메뉴」와 사이드바 우클릭이 같이 쓴다.
 * `nav` 는 사이드바에서만 켠다 — 머리에는 보드 · 대화 · 산출물 · 지식베이스 · 어휘 사전 칸이 이미 있다.
 */
export function projectActions(project: Project, nav = false): ActionList {
	const ui = () => useUi.getState();
	return [
		nav && { label: "보드", icon: <LayoutGrid />, onSelect: () => goProject(project.id, "board") },
		nav && { label: "대화", icon: <MessagesSquare />, onSelect: () => goProject(project.id, "talks") },
		nav && { label: "산출물", icon: <FileStack />, onSelect: () => goProject(project.id, "deliverables") },
		nav && { label: "지식베이스", icon: <Library />, onSelect: () => goProject(project.id, "knowledge") },
		nav && { label: "어휘 사전", icon: <BookA />, onSelect: () => goProject(project.id, "glossary") },
		"sep",
		{
			label: "프로젝트 설정",
			icon: <Settings2 />,
			onSelect: () => {
				goProject(project.id);
				ui().editProject(project.id);
			},
		},
		{ label: "Claude 설정", icon: <BookMarked />, onSelect: () => ui().openClaude(project.id) },
		"sep",
		{ label: "프로젝트 폴더 열기", icon: <FolderOpen />, onSelect: () => void attempt(() => api.open(project.path)) },
		{ label: "경로 복사", icon: <Copy />, onSelect: () => void copy(project.path, "경로") },
	];
}

export function ProjectHeader({ project }: { project: Project }) {
	const view = useUi((s) => s.view);
	const setView = useUi((s) => s.setView);
	const editing = useUi((s) => s.editingProjectId === project.id);
	const editProject = useUi((s) => s.editProject);
	const notices = useNoticeCounts()(project.id);
	return (
		<header className="flex items-center gap-4">
			<div className="min-w-0">
				<h1 className="truncate text-[18px] font-semibold tracking-[-0.02em]">{project.name}</h1>
				<button
					type="button"
					className="mono block max-w-full truncate text-[12px] text-subtle hover:text-foreground"
					title="탐색기에서 열기"
					onClick={() => void api.open(project.path).catch((e) => toast.error(errorText(e)))}
				>
					{project.path}
				</button>
			</div>
			<div className="flex-1" />
			<div className="inline-flex rounded-lg bg-secondary p-0.5">
				{PROJECT_TABS.map(([v, label]) => {
					// 지식베이스 · 어휘 사전에는 알림이 없다. 보고 있는 탭의 숫자도 남긴다 — 탭을 연 것만으로는 항목을 본 것이 아니다.
					const n = v in notices ? notices[v as NoticeView] : 0;
					return (
						<KeyTip key={v} id={`view.${v}`} extra={n ? `확인할 것 ${n}건` : undefined}>
							<button
								type="button"
								onClick={() => setView(v)}
								{...keyAnchor(`view.${v}`)}
								className={cn(
									"flex h-7 items-center gap-1.5 rounded-md px-3.5 text-[13px] font-medium text-muted-foreground transition-colors",
									view === v && "bg-hover text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]",
								)}
							>
								{label}
								{n > 0 && (
									<span className="tabular grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-none font-bold text-brand-ink">{n > 99 ? "99+" : n}</span>
								)}
							</button>
						</KeyTip>
					);
				})}
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="icon" variant="ghost" aria-label="프로젝트 메뉴">
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="pop w-52">
					<DropdownActions items={projectActions(project)} />
				</DropdownMenuContent>
			</DropdownMenu>
			<ProjectSettings project={project} open={editing} onOpenChange={(o) => editProject(o ? project.id : null)} />
		</header>
	);
}

function ProjectSettings({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
	const qc = useQueryClient();
	const [p, setP] = useState(project);
	const [tools, setTools] = useState(project.allowedTools.join("\n"));
	const [deny, setDeny] = useState(project.deniedTools.join("\n"));
	const [removing, setRemoving] = useState(false);
	const [wipe, setWipe] = useState(false);
	useEffect(() => {
		if (open) {
			setP(project);
			setTools(project.allowedTools.join("\n"));
			setDeny(project.deniedTools.join("\n"));
			setRemoving(false);
			setWipe(false);
		}
	}, [open, project]);

	const save = async () => {
		try {
			const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
			await api.projectSave({ ...p, allowedTools: lines(tools), deniedTools: lines(deny) });
			await qc.invalidateQueries({ queryKey: qk.projects });
			onOpenChange(false);
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	const remove = async () => {
		try {
			await api.projectRemove(project.id, wipe);
			await qc.invalidateQueries({ queryKey: qk.projects });
			useUi.getState().setProject(null);
			onOpenChange(false);
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="pop max-h-[88vh] gap-5 overflow-y-auto p-6 sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>프로젝트 설정</DialogTitle>
					<DialogDescription className="mono truncate text-[12px]">{project.path}</DialogDescription>
				</DialogHeader>
				{removing ? (
					<div className="flex flex-col gap-4">
						<p className="text-[13.5px] leading-relaxed break-keep">
							「{project.name}」 를 목록에서 뺍니다. 프로젝트 폴더의 파일은 건드리지 않습니다.
						</p>
						<label className="flex items-start gap-3 text-[13px]">
							<Switch checked={wipe} onCheckedChange={setWipe} className="mt-0.5" />
							<span className="leading-relaxed break-keep text-muted-foreground">이 프로젝트의 이슈 · 첨부 · 산출물도 앱 데이터의 휴지통 폴더로 옮깁니다</span>
						</label>
						<DialogFooter>
							<Button variant="ghost" onClick={() => setRemoving(false)}>
								취소
							</Button>
							<Button variant="destructive" onClick={() => void remove()}>
								목록에서 빼기
							</Button>
						</DialogFooter>
					</div>
				) : (
					<>
						<div className="flex flex-col gap-1.5">
							<Label>이름</Label>
							<Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
						</div>
						<div className="flex flex-col gap-2">
							<Label>구현 때 권한</Label>
							{(
								[
									["acceptEdits", "파일 편집만 허용", "명령은 아래 허용 목록에 있는 것만 합니다. 나머지는 묻지 않고 막고, 막힌 것은 실행 기록에서 바로 허용할 수 있습니다."],
									["bypassPermissions", "모두 허용", "명령 · 웹 · 스킬까지 묻지 않고 실행합니다. 아래 막을 목록과 전역 거부 규칙은 지킵니다. 믿는 저장소에서만 켭니다."],
								] as const
							).map(([v, title, desc]) => (
								<button
									key={v}
									type="button"
									onClick={() => setP({ ...p, implMode: v })}
									className={cn(
										"surface flex flex-col gap-0.5 rounded-lg px-3.5 py-2.5 text-left transition-colors hover:border-[var(--border-strong)]",
										p.implMode === v && "border-foreground/60",
									)}
								>
									<span className="text-[13px] font-medium">{title}</span>
									<span className="text-[12px] leading-relaxed break-keep text-subtle">{desc}</span>
								</button>
							))}
						</div>
						{p.implMode === "acceptEdits" && (
							<div className="flex flex-col gap-1.5">
								<Label>묻지 않고 허용할 명령</Label>
								<Textarea
									value={tools}
									onChange={(e) => setTools(e.target.value)}
									placeholder={"한 줄에 하나\nBash(npm test:*)\nBash(cargo check:*)"}
									className="mono min-h-24 resize-none bg-transparent text-[12.5px]"
								/>
								<CommandChips projectId={project.id} open={open} value={tools} onChange={setTools} />
							</div>
						)}
						<div className="flex flex-col gap-1.5">
							<Label>막을 명령 · 경로</Label>
							<Textarea
								value={deny}
								onChange={(e) => setDeny(e.target.value)}
								placeholder={"한 줄에 하나 · 어떤 실행에서도 막습니다\nBash(git push:*)\nEdit(src/main/resources/**)"}
								className="mono min-h-24 resize-none bg-transparent text-[12.5px]"
							/>
							<p className="text-[12px] leading-relaxed break-keep text-subtle">허용보다 앞섭니다. 「모두 허용」에서도, 실행 기록의 「허용」 단추로도 풀리지 않습니다.</p>
						</div>
						<label className="flex items-start gap-3 text-[13px]">
							<Switch checked={p.planVcsRead} onCheckedChange={(planVcsRead) => setP({ ...p, planVcsRead })} className="mt-0.5" />
							<span className="flex flex-col gap-0.5">
								<span className="font-medium">계획 · 질문 때 이력 조회 허용</span>
								<span className="text-[12px] leading-relaxed break-keep text-subtle">git · svn 의 log · diff · status · show · cat 같은 조회 명령만 엽니다. 최근에 누가 왜 바꿨는지를 근거로 계획합니다.</span>
							</span>
						</label>
						<label className="flex items-start gap-3 text-[13px]">
							<Switch checked={p.parallelImpl} onCheckedChange={(parallelImpl) => setP({ ...p, parallelImpl })} className="mt-0.5" />
							<span className="flex flex-col gap-0.5">
								<span className="font-medium">파일이 겹치지 않는 구현은 함께 돌리기</span>
								<span className="text-[12px] leading-relaxed break-keep text-subtle">
									계획에 적힌 파일이 겹치지 않으면 몇 개든 함께 돌고, 다른 구현이 잡은 파일은 고치지 못하게 막습니다. 계획에 폴더 · 와일드카드가 있거나 「모두 허용」이면 한 줄로 섭니다.
								</span>
							</span>
						</label>
						{/* 함께 돌리기를 끄면 모두 한 줄로 서라는 뜻이라 워크트리로 비켜 가지 않는다. */}
						<label className="flex items-start gap-3 text-[13px]">
							<Switch checked={p.parallelImpl && !!p.worktree} disabled={!p.parallelImpl} onCheckedChange={(worktree) => setP({ ...p, worktree })} className="mt-0.5" />
							<span className="flex flex-col gap-0.5">
								<span className="font-medium">기다려야 할 구현은 워크트리에서 돌리기</span>
								<span className="text-[12px] leading-relaxed break-keep text-subtle">
									파일이 겹쳐 줄을 서야 할 구현만 저장소 옆 「저장소이름.worktrees」 폴더에 지금 작업트리의 사본을 만들어 바로 돌립니다. 결과 확인 때 「반영」을 눌러야 본 작업트리에 들어가고, 반영하거나 되돌리면 사본을 지웁니다.
									사본에는 .gitignore 로 빠진 파일(node_modules · 빌드 결과 · .env)이 없어 처음 빌드가 오래 걸립니다. 저장소가 크면 켜지 마세요. git 저장소의 맨 위 폴더만 됩니다.
								</span>
							</span>
						</label>
						<ExtraDirs project={p} value={p.extraDirs ?? []} onChange={(extraDirs) => setP({ ...p, extraDirs })} />
						<EffectiveRules projectId={project.id} open={open} />

						<p className="text-[12px] leading-relaxed break-keep text-subtle">산출물 폴더 · 파일 이름 규칙은 산출물 화면의 「산출물 설정」에서 정합니다.</p>

						<DialogFooter className="items-center">
							<Button variant="ghost" className="mr-auto text-danger hover:text-danger" onClick={() => setRemoving(true)}>
								<Unlink />
								목록에서 빼기
							</Button>
							<Button variant="ghost" onClick={() => onOpenChange(false)}>
								취소
							</Button>
							<Button onClick={() => void save()}>저장</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

/**
 * 앱 대화의 권한. 앱 대화는 앱 데이터 폴더에서 돌아 이름 · 경로 · 워크트리 · 함께 여는 폴더가 뜻이 없고, 명령 허용 · 막을 목록만 둔다.
 * 플러그인 빌드 명령(npm · extism-js)을 여기 허용해 두면 묻지 않고 돈다.
 */
export function AppTalkSettings({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
	const qc = useQueryClient();
	const [tools, setTools] = useState(project.allowedTools.join("\n"));
	const [deny, setDeny] = useState(project.deniedTools.join("\n"));
	useEffect(() => {
		if (open) {
			setTools(project.allowedTools.join("\n"));
			setDeny(project.deniedTools.join("\n"));
		}
	}, [open, project]);

	const save = async () => {
		try {
			const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
			const p = await api.projectSave({ ...project, allowedTools: lines(tools), deniedTools: lines(deny) });
			qc.setQueryData(qk.appProject, p);
			onOpenChange(false);
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="pop max-h-[88vh] gap-5 overflow-y-auto p-6 sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>앱 대화 권한</DialogTitle>
					<DialogDescription className="mono truncate text-[12px]">{project.path}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1.5">
					<Label>묻지 않고 허용할 명령</Label>
					<Textarea
						value={tools}
						onChange={(e) => setTools(e.target.value)}
						placeholder={"한 줄에 하나\nBash(npm run build:*)\nBash(extism-js:*)"}
						className="mono min-h-24 resize-none bg-transparent text-[12.5px]"
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label>막을 명령 · 경로</Label>
					<Textarea value={deny} onChange={(e) => setDeny(e.target.value)} placeholder={"한 줄에 하나 · 어떤 실행에서도 막습니다"} className="mono min-h-24 resize-none bg-transparent text-[12.5px]" />
					<p className="text-[12px] leading-relaxed break-keep text-subtle">허용보다 앞섭니다. 실행 기록의 「허용」 단추로도 풀리지 않습니다.</p>
				</div>
				<EffectiveRules projectId={project.id} open={open} />
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

/** 저장소의 빌드 · 시험 도구를 보고 고른 명령 후보. 누르면 허용 목록 끝에 한 줄 더한다. 이미 있는 것은 눌린 채로 보인다. */
function CommandChips({ projectId, open, value, onChange }: { projectId: string; open: boolean; value: string; onChange: (v: string) => void }) {
	const { data = [] } = useQuery({ queryKey: ["permSuggest", projectId], queryFn: () => api.permissionsSuggest(projectId), enabled: open });
	if (data.length === 0) return null;
	const have = new Set(value.split("\n").map((x) => x.trim()));
	return (
		<div className="flex flex-wrap gap-1.5 pt-0.5">
			{data.map((s) => {
				const on = have.has(s.rule);
				return (
					<button
						key={s.rule}
						type="button"
						disabled={on}
						title={s.why}
						onClick={() => onChange([...value.split("\n").filter((x) => x.trim()), s.rule].join("\n"))}
						className={cn(
							"mono flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[11.5px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground",
							on && "border-transparent bg-secondary text-subtle hover:border-transparent hover:text-subtle",
						)}
					>
						{on ? <Check className="size-3" /> : <Plus className="size-3" />}
						{s.rule}
					</button>
				);
			})}
		</div>
	);
}

/**
 * 실행마다 --add-dir 로 함께 여는 폴더. 저장소 지침이 저장소 밖 파일(과업 루트의 정본 · 산출물)을 읽고 고치라고 시킬 때 쓴다.
 * 이 폴더의 CLAUDE.md 는 실리지 않는다 — 지침이 그 파일을 열라고 시키면 읽을 수 있을 뿐이다.
 */
function ExtraDirs({ project, value, onChange }: { project: Project; value: string[]; onChange: (v: string[]) => void }) {
	const add = async () => {
		const dir = await openDialog({ directory: true, title: "함께 열 폴더", defaultPath: project.path });
		if (typeof dir === "string" && !value.some((d) => d.toLowerCase() === dir.toLowerCase())) onChange([...value, dir]);
	};
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-2">
				<Label>함께 여는 폴더</Label>
				<Button size="sm" variant="ghost" className="ml-auto h-7 text-[12px]" onClick={() => void add()}>
					<FolderPlus />
					폴더 더하기
				</Button>
			</div>
			{value.map((d) => (
				<div key={d} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1">
					<span className="mono min-w-0 flex-1 truncate text-[12px]" title={d}>
						{d}
					</span>
					<Button size="icon" variant="ghost" className="size-6" aria-label="빼기" onClick={() => onChange(value.filter((x) => x !== d))}>
						<X />
					</Button>
				</div>
			))}
			<p className="text-[12px] leading-relaxed break-keep text-subtle">
				프로젝트 밖 폴더를 모든 실행에 함께 엽니다. 계획 · 읽기 대화 · 산출물에서는 읽기만, 구현과 편집 대화에서는 고치기까지 됩니다. 그 폴더의 CLAUDE.md 는 실리지 않습니다.
			</p>
		</div>
	);
}

const SCOPE_LABEL = { global: "전역 설정", project: "저장소 공유 설정", local: "저장소 개인 설정" } as const;

/**
 * 앱이 띄운 claude 는 이 프로젝트의 규칙에 더해 아래 파일들의 규칙도 함께 읽는다. 거부가 허용보다 앞선다.
 * 전역 지침의 SVN 쓰기 금지 같은 규칙이 앱 실행에도 걸린다는 것을 여기서 보인다 — 화면에 없으면 있는 줄 모른다.
 */
function EffectiveRules({ projectId, open }: { projectId: string; open: boolean }) {
	const [show, setShow] = useState(false);
	const { data = [] } = useQuery({ queryKey: ["permView", projectId], queryFn: () => api.permissionsView(projectId), enabled: open });
	const sets = data.filter((s) => s.exists);
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border px-3.5 py-2.5">
			<button type="button" onClick={() => setShow((v) => !v)} className="flex items-center gap-2 text-left text-[13px]">
				<ChevronRight className={cn("size-3.5 text-subtle transition-transform", show && "rotate-90")} />
				<span className="font-medium">함께 걸리는 규칙</span>
				<span className="tabular text-[12px] text-subtle">
					{sets.length === 0 ? "없음" : sets.map((s) => `${SCOPE_LABEL[s.scope]} 거부 ${s.deny.length} · 허용 ${s.allow.length}`).join(" / ")}
				</span>
			</button>
			{show && (
				<div className="flex flex-col gap-3 pl-5.5 text-[12px]">
					<p className="leading-relaxed break-keep text-subtle">
						Claude 를 띄울 때 이 파일들의 규칙도 함께 읽어 위 설정과 합칩니다. 거부가 허용보다 앞섭니다. 기본 모드는 앱이 실행마다 정해 주므로 따르지 않습니다.
					</p>
					{data.map((s) => (
						<div key={s.scope} className="flex flex-col gap-1">
							<div className="flex items-baseline gap-2">
								<span className="font-medium text-foreground">{SCOPE_LABEL[s.scope]}</span>
								<span className="mono min-w-0 truncate text-[11.5px] text-subtle" title={s.path}>
									{s.exists ? s.path : "파일 없음"}
								</span>
							</div>
							{s.exists && (
								<RuleLines label="거부" rules={s.deny} />
							)}
							{s.exists && <RuleLines label="허용" rules={s.allow} />}
							{s.exists && s.ask.length > 0 && <RuleLines label="묻기 (앱에서는 막힘)" rules={s.ask} />}
						</div>
					))}
				</div>
			)}
		</div>
	);
}

export function RuleLines({ label, rules }: { label: string; rules: string[] }) {
	const [all, setAll] = useState(false);
	const shown = all ? rules : rules.slice(0, 6);
	return (
		<div className="grid grid-cols-[4.5rem_1fr] gap-x-2">
			<span className="text-subtle">
				{label} <span className="tabular">{rules.length}</span>
			</span>
			<div className="mono flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
				{rules.length === 0 && <span className="font-sans text-subtle">없음</span>}
				{shown.map((r) => (
					<span key={r}>{r}</span>
				))}
				{rules.length > shown.length && (
					<button type="button" className="font-sans text-subtle underline-offset-2 hover:text-foreground hover:underline" onClick={() => setAll(true)}>
						외 {rules.length - shown.length}개 더 보기
					</button>
				)}
			</div>
		</div>
	);
}
