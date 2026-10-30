import { type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react";
import { ArrowLeftRight, ChevronDown, Maximize2, X } from "lucide-react";
import { Empty, RunDot } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MAIN_MIN, SIDEBAR_RAIL, useDockLayout } from "@/lib/layout";
import { useAllTalks, useAppProject, useProjects } from "@/lib/queries";
import { DOCK_WIDTH, useUi } from "@/lib/store";
import { GLOBAL_PID, type Issue } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TalkPane, TalkTag } from "./Talks";

/**
 * 옆 칸 대화. 본문 옆의 레이아웃 칸이라 보드 · 산출물 · 설정을 쓰는 동안 그대로 남는다.
 * 이슈 · 산출물 상세 창은 본문 칸 안에서만 열려 이 칸을 가리지 않는다(useSheetBesideDock).
 * 띄울 수 있는 것은 앱 대화와 프로젝트 대화다. 메모의 대화는 「대화로 이어 가기」로 갈라 낸 뒤 띄운다.
 */
export function DockPane() {
	const dock = useUi((s) => s.dock);
	const setDock = useUi((s) => s.setDock);
	const { shown, width } = useDockLayout();
	const { data: projects = [] } = useProjects();
	const { data: app } = useAppProject();
	const { app: appTalks, byProject, loading } = useAllTalks(projects);
	const talk = [...appTalks, ...byProject.flatMap((g) => g.talks)].find((t) => t.id === dock.talk?.id);
	const path = talk?.projectId === GLOBAL_PID ? (app?.path ?? "") : (projects.find((p) => p.id === talk?.projectId)?.path ?? "");

	// 이슈 · 산출물 상세 창이 이 칸을 피해 열리도록 칸이 차지한 폭을 CSS 변수로 알린다. 상세 창은 body 에 그려져 이 칸의 조상이 아니다.
	useEffect(() => {
		const root = document.documentElement.style;
		root.setProperty("--dock-w", shown ? `${width + 1}px` : "0px");
		root.setProperty("--dock-right", shown && dock.side === "right" ? `${width + 1}px` : "0px");
	}, [shown, width, dock.side]);

	if (!shown) return null;
	const right = dock.side === "right";
	return (
		<aside
			data-dock
			aria-label="옆 칸 대화"
			style={{ width }}
			className={cn("relative flex shrink-0 flex-col bg-background", right ? "border-l border-border" : "border-r border-border")}
		>
			<Resizer side={dock.side} width={width} />
			<header className="flex h-10 shrink-0 items-center gap-1 border-b border-border pr-1.5 pl-3">
				<TalkPicker talk={talk} />
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label="좌우 바꾸기"
					title={right ? "왼쪽으로 옮기기" : "오른쪽으로 옮기기"}
					onClick={() => setDock({ side: right ? "left" : "right" })}
				>
					<ArrowLeftRight />
				</Button>
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label="대화 탭으로 펼치기"
					title="대화 탭으로 펼치기"
					disabled={!talk}
					onClick={() => {
						if (!talk) return;
						const ui = useUi.getState();
						ui.openTalk({ projectId: talk.projectId, id: talk.id });
						ui.setView(talk.projectId === GLOBAL_PID ? "allTalks" : "talks");
					}}
				>
					<Maximize2 />
				</Button>
				<Button size="icon-sm" variant="ghost" aria-label="옆 칸 닫기" title="옆 칸 닫기 (Ctrl+J)" onClick={() => setDock({ open: false })}>
					<X />
				</Button>
			</header>
			{talk ? (
				<TalkPane key={talk.id} talk={talk} projectPath={path} compact />
			) : (
				!loading && <Empty className="grid flex-1 place-items-center px-6 break-keep">띄워 둔 대화를 찾지 못했습니다. 위에서 다른 대화를 고르세요.</Empty>
			)}
		</aside>
	);
}

/** 머리의 제목이 곧 대화 고르기다. 대화 탭 목록과 같이 앱 · 프로젝트별로 묶어 보인다. */
function TalkPicker({ talk }: { talk: Issue | undefined }) {
	const { data: projects = [] } = useProjects();
	const { app, byProject } = useAllTalks(projects);
	const dockTalk = useUi((s) => s.dockTalk);
	const groups = [{ key: GLOBAL_PID, label: "앱", talks: app }, ...byProject.filter((g) => g.talks.length).map((g) => ({ key: g.project.id, label: g.project.name, talks: g.talks }))];
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-hover" title="띄울 대화 고르기">
					{talk && <TalkTag talk={talk} />}
					<span className="min-w-0 truncate text-[13px] font-semibold">{talk ? talk.title || "새 대화" : "대화 고르기"}</span>
					{talk?.run && <RunDot />}
					<ChevronDown className="size-3.5 shrink-0 text-subtle" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="pop max-h-[60vh] w-72 overflow-y-auto">
				{groups.map((g, i) => (
					<div key={g.key}>
						{i > 0 && <DropdownMenuSeparator />}
						<DropdownMenuLabel className="text-[12px] font-normal text-subtle">{g.label}</DropdownMenuLabel>
						{g.talks.length === 0 && <div className="px-2 pb-1.5 text-[12px] text-subtle">아직 대화가 없습니다</div>}
						{g.talks.map((t) => (
							<DropdownMenuItem key={t.id} disabled={t.id === talk?.id} onSelect={() => dockTalk({ projectId: t.projectId, id: t.id })}>
								<span className="min-w-0 flex-1 truncate">{t.title || "새 대화"}</span>
								{t.run && <RunDot />}
							</DropdownMenuItem>
						))}
					</div>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** 본문 쪽 가장자리를 끌어 폭을 바꾼다. 본문이 MAIN_MIN 아래로 줄지 않게 막는다. */
function Resizer({ side, width }: { side: "left" | "right"; width: number }) {
	const setDock = useUi((s) => s.setDock);
	const start = useRef<{ x: number; w: number } | null>(null);
	const down = (e: ReactPointerEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.currentTarget.setPointerCapture(e.pointerId);
		start.current = { x: e.clientX, w: width };
	};
	const move = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!start.current) return;
		const d = e.clientX - start.current.x;
		const room = window.innerWidth - SIDEBAR_RAIL - MAIN_MIN;
		const next = start.current.w + (side === "right" ? -d : d);
		setDock({ width: Math.round(Math.max(DOCK_WIDTH.min, Math.min(DOCK_WIDTH.max, room, next))) });
	};
	const up = () => {
		start.current = null;
	};
	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="옆 칸 폭"
			title="끌어서 폭 바꾸기 · 두 번 눌러 처음 폭으로"
			onPointerDown={down}
			onPointerMove={move}
			onPointerUp={up}
			onPointerCancel={up}
			onDoubleClick={() => setDock({ width: DOCK_WIDTH.start })}
			className={cn("absolute inset-y-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-border-strong", side === "right" ? "-left-1" : "-right-1")}
		/>
	);
}

/**
 * 이슈 · 산출물 상세 창이 옆 칸과 함께 쓰일 때의 속성. 옆 칸을 띄우면 상세 창은 겹침 막 · 초점 가두기 없이(modal 끔) 열려
 * 옆 칸에 글을 쓰고 보낼 수 있다. 옆 칸을 누른 것은 「창 밖을 눌렀다」로 치지 않아 상세 창이 닫히지 않는다.
 */
export function useSheetBesideDock() {
	const docked = useDockLayout().shown;
	return {
		modal: !docked,
		onInteractOutside: (e: Event) => {
			if ((e.target as HTMLElement | null)?.closest?.("[data-dock]")) e.preventDefault();
		},
	};
}
