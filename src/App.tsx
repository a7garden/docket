import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FolderPlus } from "lucide-react";
import { Sidebar, pickProject } from "@/components/Sidebar";
import { Mark, TitleBar } from "@/components/TitleBar";
import { Button } from "@/components/ui/button";
import { PluginResultDialog } from "@/components/PluginResult";
import { Toaster } from "@/components/ui/sonner";
import { Board } from "@/features/board/Board";
import { ClaudeConfig } from "@/features/claude/ClaudeConfig";
import { Deliverables } from "@/features/deliverables/Deliverables";
import { Glossary } from "@/features/glossary/Glossary";
import { IssueSheet } from "@/features/issue/IssueSheet";
import { Knowledge } from "@/features/knowledge/Knowledge";
import { ProjectHeader } from "@/features/project/ProjectHeader";
import { Settings } from "@/features/settings/Settings";
import { UpdateConfirm } from "@/features/settings/UpdateConfirm";
import { Talks } from "@/features/talk/Talks";
import { useDocketEvents } from "@/lib/events";
import { useUpdater } from "@/lib/updater";
import { useAppInfo, useProjects, useSettings } from "@/lib/queries";
import { useUi } from "@/lib/store";

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

export default function App() {
	useDocketEvents();
	useUpdater();
	const { data: settings } = useSettings();
	const theme = useTheme(settings?.theme);
	const { data: projects, isLoading } = useProjects();
	const { projectId, view, setProject } = useUi();
	const project = projects?.find((p) => p.id === projectId);

	// 기억해 둔 프로젝트가 목록에서 빠졌으면 첫 프로젝트로 옮긴다.
	useEffect(() => {
		if (projects && !project && projects.length) setProject(projects[0].id);
	}, [projects, project, setProject]);

	const projectView = view === "board" || view === "deliverables" || view === "talks" || view === "knowledge" || view === "glossary";
	return (
		<div className="flex h-full flex-col">
			<TitleBar />
			<div className="flex min-h-0 flex-1 border-t border-border">
				<Sidebar />
				<main className="flex min-w-0 flex-1 flex-col gap-5 px-6 pt-5 pb-4">
					{view === "claude" ? (
						<>
							<h1 className="text-[18px] font-semibold tracking-[-0.02em]">Claude 설정</h1>
							<ClaudeConfig />
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
								<Talks project={project} />
							) : view === "knowledge" ? (
								<Knowledge project={project} />
							) : view === "glossary" ? (
								<Glossary project={project} />
							) : (
								<Deliverables project={project} />
							)}
							<IssueSheet project={project} />
						</>
					) : null}
				</main>
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
