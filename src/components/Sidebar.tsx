import { useQueries, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { BookMarked, FolderPlus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { projectActions } from "@/features/project/ProjectHeader";
import { api, errorText } from "@/lib/api";
import { keyAnchor } from "@/lib/keys";
import { useNoticeCounts } from "@/lib/notices";
import { qk, usePluginMenus, useProjects } from "@/lib/queries";
import { useUi } from "@/lib/store";
import type { Issue, Project } from "@/lib/types";
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

export function Sidebar() {
	const qc = useQueryClient();
	const { projectId, view, setProject, setView } = useUi();
	const { data: projects = [] } = useProjects();
	const lists = useQueries({ queries: projects.map((p) => ({ queryKey: qk.issues(p.id), queryFn: () => api.issues(p.id) })) });
	const counts = useNoticeCounts();

	return (
		<aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar p-2">
			<div className="flex h-8 items-center justify-between pr-0.5 pl-2.5">
				{/* 모든 프로젝트를 건너 찾는 키는 프로젝트 목록 머리에서 알린다. 늘 보이는 안내는 두지 않는다. */}
				<KeyTip id="palette" side="right">
					{/* Label 은 속성을 넘기지 않아 툴팁이 붙지 않는다. 감싸는 칸에 붙인다. */}
					<span>
						<Label>프로젝트</Label>
					</span>
				</KeyTip>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button size="icon-xs" variant="ghost" aria-label="프로젝트 추가" onClick={() => void pickProject(qc)}>
							<FolderPlus />
						</Button>
					</TooltipTrigger>
					<TooltipContent>프로젝트 폴더 추가</TooltipContent>
				</Tooltip>
			</div>
			<nav className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
				{projects.map((p, i) => (
					<ProjectItem
						key={p.id}
						project={p}
						issues={lists[i]?.data ?? []}
						notices={counts(p.id).total}
						active={p.id === projectId && (view === "board" || view === "deliverables" || view === "talks" || view === "knowledge" || view === "glossary")}
						onClick={() => {
							setProject(p.id);
							if (view !== "deliverables" && view !== "talks" && view !== "knowledge" && view !== "glossary") setView("board");
						}}
					/>
				))}
			</nav>
			<div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2">
				<NavItem icon={<BookMarked />} label="Claude 설정" active={view === "claude"} onClick={() => setView("claude")} />
				<NavItem icon={<Settings2 />} label="설정" active={view === "settings"} onClick={() => setView("settings")} keyId="view.settings" />
			</div>
		</aside>
	);
}

/**
 * 2026.10.29 : 숫자를 「결정할 이슈」 수에서 그 프로젝트의 알림 수로 바꿨다. 알림함 = 프로젝트 줄의 합, 프로젝트 줄 = 탭 숫자의 합이 되게 한다.
 * 결정할 이슈는 보드의 「내 차례」에서 본다.
 */
function ProjectItem({ project, issues, notices, active, onClick }: { project: Project; issues: Issue[]; notices: number; active: boolean; onClick: () => void }) {
	const menus = usePluginMenus("project");
	const running = issues.some((i) => i.run);
	const item = (
		<button
			type="button"
			onClick={onClick}
			title={project.path}
			className={cn(
				"group flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13.5px] transition-colors",
				active ? "bg-hover font-semibold text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
			)}
		>
			<span className="min-w-0 flex-1 truncate">{project.name}</span>
			{running && <RunDot />}
			{notices > 0 && (
				<span className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-ink" title={`확인할 것 ${notices}건`}>
					{notices > 99 ? "99+" : notices}
				</span>
			)}
		</button>
	);
	return <ContextActions items={[...projectActions(project, true), "sep", ...pluginActions(menus, { projectId: project.id })]}>{item}</ContextActions>;
}

/** `keyId` 가 있으면 그 키를 툴팁에 보이고 Alt 배지 자리로 삼는다. */
function NavItem({ icon, label, active, onClick, keyId }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void; keyId?: string }) {
	const item = (
		<button
			type="button"
			onClick={onClick}
			{...(keyId ? keyAnchor(keyId, "end") : {})}
			className={cn(
				"flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
				active ? "bg-hover font-semibold text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
			)}
		>
			{icon}
			{label}
		</button>
	);
	return keyId ? (
		<KeyTip id={keyId} side="right">
			{item}
		</KeyTip>
	) : (
		item
	);
}
