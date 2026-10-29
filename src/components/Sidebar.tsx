import { useQueries, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { BookMarked, FolderPlus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { projectActions } from "@/features/project/ProjectHeader";
import { api, errorText } from "@/lib/api";
import { qk, useProjects } from "@/lib/queries";
import { needsDecision } from "@/lib/status";
import { useUi } from "@/lib/store";
import type { Issue, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ContextActions } from "./ActionMenu";
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

	return (
		<aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar p-2">
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
			<nav className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
				{projects.map((p, i) => (
					<ProjectItem
						key={p.id}
						project={p}
						issues={lists[i]?.data ?? []}
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
				<NavItem icon={<Settings2 />} label="설정" active={view === "settings"} onClick={() => setView("settings")} />
			</div>
		</aside>
	);
}

function ProjectItem({ project, issues, active, onClick }: { project: Project; issues: Issue[]; active: boolean; onClick: () => void }) {
	const decide = issues.filter(needsDecision).length;
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
			{decide > 0 && (
				<span className="tabular grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-brand-ink" title={`결정할 이슈 ${decide}건`}>
					{decide}
				</span>
			)}
		</button>
	);
	return <ContextActions items={projectActions(project, true)}>{item}</ContextActions>;
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
				active ? "bg-hover font-semibold text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
			)}
		>
			{icon}
			{label}
		</button>
	);
}
