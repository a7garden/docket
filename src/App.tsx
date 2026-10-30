import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { CommandPalette } from "@/components/CommandPalette";
import { KeyBadges } from "@/components/KeyBadges";
import { KeyHelp } from "@/components/KeyHelp";
import { Sidebar, pickProject } from "@/components/Sidebar";
import { Mark, TitleBar } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import { PluginResultDialog } from "@/components/PluginResult";
import { Toaster } from "@/components/ui/sonner";
import { Board } from "@/features/board/Board";
import { IssueSheet } from "@/features/issue/IssueSheet";
import { goProject, PROJECT_TABS, ProjectHeader } from "@/features/project/ProjectHeader";
import { Settings } from "@/features/settings/Settings";
import { UpdateConfirm } from "@/features/settings/UpdateConfirm";
import { DockPane } from "@/features/talk/DockPane";
import { Talks } from "@/features/talk/Talks";
import { useDocketEvents } from "@/lib/events";
import { useKey } from "@/lib/keys";
import { useDockLayout } from "@/lib/layout";
import { useUpdater } from "@/lib/updater";
import { qk, useAppInfo, useProjects, useSettings } from "@/lib/queries";
import { useUi, type View } from "@/lib/store";
import { GLOBAL_PID, type Issue } from "@/lib/types";
import { cn } from "@/lib/utils";

// 첫 화면(보드 · 대화) 밖의 화면은 따로 묶어 늦게 불러온다. 첫 화면이 그려진 뒤 한가할 때 미리 받아 두므로 처음 열 때도 거의 기다리지 않는다.
// 설정 화면은 Ctrl+K 가 그 목차를 가져다 쓰므로 첫 묶음에 남는다.
const screens = {
	ClaudeConfig: () => import("@/features/claude/ClaudeConfig").then((m) => ({ default: m.ClaudeConfig })),
	Deliverables: () => import("@/features/deliverables/Deliverables").then((m) => ({ default: m.Deliverables })),
	Glossary: () => import("@/features/glossary/Glossary").then((m) => ({ default: m.Glossary })),
	Knowledge: () => import("@/features/knowledge/Knowledge").then((m) => ({ default: m.Knowledge })),
	AllTalks: () => import("@/features/talk/AllTalks").then((m) => ({ default: m.AllTalks })),
};
const ClaudeConfig = lazy(screens.ClaudeConfig);
const Deliverables = lazy(screens.Deliverables);
const Glossary = lazy(screens.Glossary);
const Knowledge = lazy(screens.Knowledge);
const AllTalks = lazy(screens.AllTalks);

function preloadScreens() {
	const go = () => Object.values(screens).forEach((load) => void load().catch(() => {}));
	if ("requestIdleCallback" in window) requestIdleCallback(go, { timeout: 3000 });
	else setTimeout(go, 1000);
}

/** 늦게 불러오는 화면 자리. 받는 동안은 비워 둔다 — 대개 한 순간이라 도는 표시가 더 거슬린다. */
function Later({ children }: { children: ReactNode }) {
	return <Suspense fallback={null}>{children}</Suspense>;
}

/** index.html 이 첫 화면 전에 읽는 키다. */
const THEME_KEY = "docket.theme";
/** --background 를 sRGB 로 옮긴 값. 창 크기를 바꿀 때 화면보다 먼저 드러나는 창 바탕이다. lib.rs 의 시작 색과 같다. */
const WINDOW_BG = { dark: "#161616", light: "#f7f7f7" };

/** 설정의 테마를 html 의 dark 클래스로 옮기고, 실제로 입힌 쪽을 돌려준다. 「시스템」이면 OS 설정이 바뀌는 대로 따라간다. */
function useTheme(theme: string | undefined): "dark" | "light" {
	const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
	useEffect(() => {
		// 설정이 오기 전에는 index.html 이 입힌 지난번 테마를 그대로 둔다.
		if (theme === undefined) return;
		try {
			localStorage.setItem(THEME_KEY, theme);
		} catch {
			// 저장소를 못 쓰면 다음에 켤 때 한 번 번쩍일 뿐이다.
		}
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const d = theme === "dark" || (theme === "system" && mq.matches);
			document.documentElement.classList.toggle("dark", d);
			setDark(d);
			getCurrentWindow()
				.setBackgroundColor(d ? WINDOW_BG.dark : WINDOW_BG.light)
				.catch(() => {});
		};
		apply();
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, [theme]);
	return dark ? "dark" : "light";
}

/** 어디서나 쓰는 화면 전환 키. 입력칸 안에서도 받는다 — Ctrl 조합이라 글자를 먹지 않는다. */
function GlobalKeys() {
	const { data: projects = [] } = useProjects();
	const setView = useUi((s) => s.setView);
	const qc = useQueryClient();
	// 사이드바와 같은 순서로 옮긴다. 끝에서는 멈춘다 — 돌아 들어가면 맨 아래에서 ↓ 를 눌렀을 때 어디로 갔는지 놓친다.
	const step = (d: number) => {
		if (!projects.length) return false;
		const i = projects.findIndex((p) => p.id === useUi.getState().projectId);
		const next = projects[i < 0 ? 0 : i + d];
		if (next) goProject(next.id);
	};
	useKey({ id: "project.prev", combo: "Mod+Alt+ArrowUp", label: "이전 프로젝트", group: "어디서나", series: "project", run: () => step(-1) });
	useKey({ id: "project.next", combo: "Mod+Alt+ArrowDown", label: "다음 프로젝트", group: "어디서나", series: "project", run: () => step(1) });
	useKey({ id: "view.settings", combo: "Mod+,", label: "설정", group: "어디서나", run: () => setView("settings") });
	useKey({ id: "dock.toggle", combo: "Mod+J", label: "옆 칸 대화 열고 닫기", group: "어디서나", run: () => toggleDock(qc) });
	return (
		<>
			{PROJECT_TABS.map(([v, label], i) => (
				<ViewKey key={v} view={v} label={label} n={i + 1} />
			))}
		</>
	);
}

/**
 * 옆 칸을 열고 닫는다. 닫았다 열면 마지막 대화가 다시 뜬다. 띄운 적이 없으면 지금 프로젝트의 가장 최근 대화를,
 * 그것도 없으면 가장 최근 앱 대화를 띄운다. 둘 다 없으면 대화 탭으로 가 고르게 한다.
 */
function toggleDock(qc: QueryClient) {
	const { dock, setDock, dockTalk, setView, projectId } = useUi.getState();
	if (dock.open && dock.talk) return setDock({ open: false });
	if (dock.talk) return setDock({ open: true });
	for (const pid of [projectId, GLOBAL_PID]) {
		const recent = pid ? qc.getQueryData<Issue[]>(qk.talks(pid))?.[0] : undefined;
		if (recent && pid) return dockTalk({ projectId: pid, id: recent.id });
	}
	setView("talks");
	toast("띄울 대화를 고르세요", { description: "대화 머리의 「옆에 띄우기」로 띄웁니다" });
}

function ViewKey({ view, label, n }: { view: View; label: string; n: number }) {
	const setView = useUi((s) => s.setView);
	useKey({ id: `view.${view}`, combo: `Mod+${n}`, label, group: "어디서나", series: "views", run: () => setView(view) });
	return null;
}

export default function App() {
	useDocketEvents();
	useEffect(preloadScreens, []);
	const { data: settings } = useSettings();
	useUpdater(settings?.autoUpdateCheck);
	const theme = useTheme(settings?.theme);
	const { data: projects, isLoading } = useProjects();
	const { projectId, view, setProject } = useUi();
	const project = projects?.find((p) => p.id === projectId);

	// 기억해 둔 프로젝트가 목록에서 빠졌으면 첫 프로젝트로 옮긴다.
	useEffect(() => {
		if (projects && !project && projects.length) setProject(projects[0].id);
	}, [projects, project, setProject]);

	const projectView = view === "board" || view === "deliverables" || view === "talks" || view === "knowledge" || view === "glossary";
	const dock = useUi((s) => s.dock.side);
	const { rail } = useDockLayout();
	return (
		<div className="flex h-full flex-col">
			<GlobalKeys />
			<KeyBadges />
			<KeyHelp />
			<CommandPalette />
			<TitleBar />
			<div className="flex min-h-0 flex-1 border-t border-border">
				<Sidebar rail={rail} />
				{/* 사이드바는 늘 맨 왼쪽이다. 옆 칸 대화는 본문의 오른쪽 또는 왼쪽 칸이고, 좌우를 바꾸면 이 줄의 순서만 뒤집는다. */}
				<div className={cn("flex min-w-0 flex-1", dock === "left" && "flex-row-reverse")}>
					<main className="flex min-w-0 flex-1 flex-col gap-5 px-6 pt-5 pb-4">
						{view === "allTalks" ? (
							<Later>
								<AllTalks />
							</Later>
						) : view === "claude" ? (
							<>
								<h1 className="text-[18px] font-semibold tracking-[-0.02em]">Claude 설정</h1>
								<Later>
									<ClaudeConfig />
								</Later>
							</>
						) : view === "settings" ? (
							// 설정은 제목을 스스로 그린다. 가운데로 모은 목차 · 본문과 왼쪽 끝을 맞추려면 같은 덩어리 안에 있어야 한다.
							<Settings />
						) : !isLoading && !project ? (
							<Welcome />
						) : project && projectView ? (
							<>
								<ProjectHeader project={project} />
								{view === "board" ? (
									<Board project={project} />
								) : view === "talks" ? (
									<Talks pid={project.id} path={project.path} />
								) : (
									<Later>
										{view === "knowledge" ? (
											<Knowledge project={project} />
										) : view === "glossary" ? (
											<Glossary project={project} />
										) : (
											<Deliverables project={project} />
										)}
									</Later>
								)}
								<IssueSheet project={project} />
							</>
						) : null}
					</main>
					<DockPane />
				</div>
			</div>
			{/* 2026.10.29 : 오른쪽 아래 → 위 가운데. 오른쪽 아래의 진행 버튼을 가렸다. 제목 줄(h-9 · 36px)을 덮지 않게 8px 아래에 띄운다. */}
			<PluginResultDialog />
			<UpdateConfirm />
			<Toaster position="top-center" offset={{ top: 44 }} mobileOffset={{ top: 44 }} theme={theme} />
		</div>
	);
}

function Welcome() {
	const qc = useQueryClient();
	const { data: info } = useAppInfo();
	return (
		<div className="grid flex-1 place-items-center">
			<div className="flex max-w-md flex-col items-center gap-5 text-center">
				<Mark size={40} />
				<div className="flex flex-col gap-2">
					<h1 className="text-[22px] font-semibold tracking-[-0.025em]">개발할 폴더를 고르세요</h1>
					<p className="text-[14px] leading-relaxed break-keep text-muted-foreground">
						메모를 붙이면 Claude 가 그 폴더의 코드를 읽고 계획을 세웁니다. 계획을 승인하면 구현합니다.
					</p>
				</div>
				<Button size="lg" onClick={() => void pickProject(qc)}>
					<FolderPlus />
					폴더 고르기
				</Button>
				{info && (
					<p className="text-[12.5px] leading-relaxed break-keep text-subtle">
						이슈 · 계획 · 산출물은 <span className="mono">{info.dataRoot}</span> 에 저장합니다. 프로젝트 폴더에는 아무것도 쓰지 않습니다.
					</p>
				)}
				{info && !info.claudePath && <p className="text-[12.5px] text-danger">claude 실행 파일을 찾지 못했습니다. 설정에서 경로를 지정하세요.</p>}
			</div>
		</div>
	);
}
