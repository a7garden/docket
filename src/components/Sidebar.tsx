import type { ReactNode } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { BookMarked, FolderPlus, MessagesSquare, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { projectActions } from "@/features/project/ProjectHeader";
import { api, errorText } from "@/lib/api";
import { keyAnchor, useCommands } from "@/lib/keys";
import { useNoticeCounts } from "@/lib/notices";
import { focusOnly, qk, useAllTalks, usePluginMenus, useProjects } from "@/lib/queries";
import { roveItem, useRovingList } from "@/lib/rovingList";
import { useUi } from "@/lib/store";
import { GLOBAL_PID, type Issue, type Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContextActions } from "./ActionMenu";
import { KeyTip } from "./KeyTip";
import { pluginActions } from "./PluginResult";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Label, RunDot } from "./bits";

export async function pickProject(qc: ReturnType<typeof useQueryClient>) {
	const dir = await open({ directory: true, title: "프로젝트 폴더 고르기" });
	if (typeof dir !== "string") return;
	try {
		const p = await api.projectAdd(dir);
		await qc.invalidateQueries({ queryKey: qk.projects });
		useUi.getState().setProject(p.id);
		useUi.getState().setView("board");
	} catch (e) {
		toast.error(errorText(e));
	}
}

/**
 * rail 은 옆 칸 대화를 띄워 창이 좁아졌을 때의 56px 아이콘 띠다. 프로젝트는 머리글자로, 이름은 툴팁으로 보인다.
 * 본문이 너무 좁아지지 않게 사이드바가 먼저 비켜 준다(useDockLayout).
 */
export function Sidebar({ rail = false }: { rail?: boolean }) {
	const qc = useQueryClient();
	const { projectId, view, setProject, setView } = useUi();
	const { data: projects = [] } = useProjects();
	const lists = useQueries({ queries: projects.map((p) => ({ queryKey: qk.issues(p.id), queryFn: () => api.issues(p.id), ...focusOnly(p.id) })) });
	const { app: appTalks, byProject } = useAllTalks(projects);
	const counts = useNoticeCounts();
	const rove = useRovingList();
	useCommands([{ label: "프로젝트 폴더 추가", onSelect: () => void pickProject(qc) }]);

	return (
		<aside data-region="sidebar" {...rove} className={cn("flex shrink-0 flex-col border-r border-border bg-sidebar p-2", rail ? "w-14" : "w-56")}>
			{rail ? (
				<div className="h-1" />
			) : (
				<div className="flex h-8 items-center justify-between pr-0.5 pl-2.5">
					<Label>프로젝트</Label>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button size="icon-xs" variant="ghost" aria-label="프로젝트 추가" onClick={() => void pickProject(qc)}>
								<FolderPlus />
							</Button>
						</TooltipTrigger>
						<TooltipContent>프로젝트 폴더 추가</TooltipContent>
					</Tooltip>
				</div>
			)}
			<nav className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
				{projects.map((p, i) => (
					<ProjectItem
						key={p.id}
						project={p}
						rail={rail}
						issues={lists[i]?.data ?? []}
						notices={counts(p.id).total - counts(p.id).talks}
						active={p.id === projectId && (view === "board" || view === "deliverables" || view === "knowledge" || view === "glossary")}
						onClick={() => {
							setProject(p.id);
							if (view !== "deliverables" && view !== "knowledge" && view !== "glossary") setView("board");
						}}
					/>
				))}
			</nav>
			<div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2">
				{/* 프로젝트에 매이지 않는 자리끼리 묶는다. 프로젝트가 하나도 없어도 열린다. 대화는 앱 대화와 프로젝트별 대화를 모아 보는 유일한 자리라, 숫자도 모든 대화의 읽지 않은 답을 센다 — 프로젝트 줄은 대화를 뺀다. */}
				<NavItem
					icon={<MessagesSquare />}
					label="대화"
					active={view === "talks"}
					onClick={() => setView("talks")}
					keyId="view.talks"
					rail={rail}
					running={appTalks.some((t) => t.run) || byProject.some((g) => g.talks.some((t) => t.run))}
					notices={projects.reduce((n, p) => n + counts(p.id).talks, counts(GLOBAL_PID).talks)}
				/>
				<NavItem icon={<BookMarked />} label="Claude 설정" active={view === "claude"} onClick={() => setView("claude")} rail={rail} />
				<NavItem icon={<Settings2 />} label="설정" active={view === "settings"} onClick={() => setView("settings")} keyId="view.settings" rail={rail} />
			</div>
		</aside>
	);
}

/** 확인할 것의 수. 띠에서는 자리가 없어 점으로 줄인다. */
function Count({ n, rail }: { n: number; rail: boolean }) {
	if (n <= 0) return null;
	if (rail) return <span aria-label={`확인할 것 ${n}건`} className="absolute top-1 right-1 size-2 rounded-full bg-brand" />;
	return (
		<span className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-ink" title={`확인할 것 ${n}건`}>
			{n > 99 ? "99+" : n}
		</span>
	);
}

/** 띠에서는 이름 대신 툴팁으로 보인다. */
function RailTip({ rail, label, children }: { rail: boolean; label: string; children: React.ReactElement }) {
	if (!rail) return children;
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	);
}

/**
 * 2026.10.29 : 숫자를 「결정할 이슈」 수에서 그 프로젝트의 알림 수로 바꿨다. 알림함 = 프로젝트 줄과 「대화」 줄의 합, 프로젝트 줄 = 탭 숫자의 합이 되게 한다.
 * 결정할 이슈는 보드의 「내 차례」에서 본다.
 */
function ProjectItem({
	project,
	issues,
	notices,
	active,
	rail,
	onClick,
}: {
	project: Project;
	issues: Issue[];
	notices: number;
	active: boolean;
	rail: boolean;
	onClick: () => void;
}) {
	const menus = usePluginMenus("project");
	const running = issues.some((i) => i.run);
	const item = (
		<button
			type="button"
			onClick={onClick}
			title={rail ? undefined : project.path}
			aria-label={rail ? project.name : undefined}
			{...roveItem(active)}
			className={cn(
				"group relative flex h-8 w-full items-center gap-2.5 rounded-md text-left text-[13.5px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
				rail ? "justify-center px-0" : "px-2.5",
				active ? "bg-hover font-semibold text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
			)}
		>
			{rail ? (
				<span className="grid size-6 place-items-center rounded-md border border-border text-[12px] font-semibold uppercase">{[...project.name][0] ?? "?"}</span>
			) : (
				<span className="min-w-0 flex-1 truncate">{project.name}</span>
			)}
			{running && <RunDot className={rail ? "absolute bottom-1 left-1/2 -translate-x-1/2" : undefined} />}
			<Count n={notices} rail={rail} />
		</button>
	);
	return (
		<ContextActions items={[...projectActions(project, true), "sep", ...pluginActions(menus, { projectId: project.id })]}>
			<RailTip rail={rail} label={project.name}>
				{item}
			</RailTip>
		</ContextActions>
	);
}

/** `keyId` 가 있으면 그 키를 툴팁에 보이고 Alt 배지 자리로 삼는다. 띠에서는 아이콘만 남고 이름은 툴팁으로 간다. */
function NavItem({
	icon,
	label,
	active,
	onClick,
	keyId,
	rail = false,
	running = false,
	notices = 0,
}: {
	icon: ReactNode;
	label: string;
	active: boolean;
	onClick: () => void;
	keyId?: string;
	rail?: boolean;
	running?: boolean;
	notices?: number;
}) {
	const item = (
		<button
			type="button"
			onClick={onClick}
			aria-label={rail ? label : undefined}
			{...(keyId ? keyAnchor(keyId, "end") : {})}
			{...roveItem(active)}
			className={cn(
				"relative flex h-8 items-center gap-2.5 rounded-md text-[13.5px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&_svg]:size-4 [&_svg]:shrink-0",
				rail ? "justify-center px-0" : "px-2.5",
				active ? "bg-hover font-semibold text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
			)}
		>
			{icon}
			{!rail && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
			{running && <RunDot className={rail ? "absolute bottom-1 left-1/2 -translate-x-1/2" : undefined} />}
			<Count n={notices} rail={rail} />
		</button>
	);
	if (keyId) {
		return (
			<KeyTip id={keyId} side="right">
				{item}
			</KeyTip>
		);
	}
	return (
		<RailTip rail={rail} label={label}>
			{item}
		</RailTip>
	);
}
