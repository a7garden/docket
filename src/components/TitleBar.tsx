import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PanelRight, Square } from "lucide-react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { type Job, useJobs } from "@/lib/jobs";
import { useLive, useUi } from "@/lib/store";
import { type ActionList, ContextActions } from "./ActionMenu";
import { RunDot } from "./bits";
import { NoticeCenter } from "./NoticeCenter";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { UsageMeter } from "./UsageMeter";

const win = getCurrentWindow();

/** 창틀을 직접 그린다. 기본 창틀은 유리 배경과 따로 놀아 앱 위에 회색 띠가 얹힌다. */
export function TitleBar() {
	const [max, setMax] = useState(false);
	useEffect(() => {
		void win.isMaximized().then(setMax);
		const un = win.onResized(() => void win.isMaximized().then(setMax));
		return () => void un.then((f) => f());
	}, []);

	const jobs = useJobs();
	const running = jobs.filter((j) => j.phase === "running").length;
	const queued = jobs.length - running;

	// 실행 중에 닫으면 묻는다. ✕ 단추 · Alt+F4 · 작업 표시줄 닫기가 모두 이 사건으로 온다.
	// 묻고 나서는 destroy 로 닫는다. close 를 다시 부르면 이 사건이 또 와서 창이 닫히지 않는다.
	const [closing, setClosing] = useState(false);
	const count = useRef(0);
	count.current = jobs.length;
	useEffect(() => {
		const un = win.onCloseRequested((e) => {
			if (count.current === 0) return;
			e.preventDefault();
			setClosing(true);
		});
		return () => void un.then((f) => f());
	}, []);

	return (
		<header data-tauri-drag-region className="flex h-9 shrink-0 items-center bg-sidebar pl-3.5 select-none">
			<div data-tauri-drag-region className="flex items-center gap-2.5">
				<Mark />
				<span data-tauri-drag-region className="text-[12.5px] font-semibold">
					docket
				</span>
			</div>
			<div data-tauri-drag-region className="flex-1 self-stretch" />
			<UsageMeter />
			<NoticeCenter />
			{jobs.length > 0 && (
				<Popover>
					<PopoverTrigger asChild>
						<button
							type="button"
							title="실행 중인 작업 보기 · 중지"
							className="mr-2 flex h-7 items-center gap-2 rounded-md px-2.5 text-[12px] text-muted-foreground transition-colors outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-hover data-[state=open]:text-foreground"
						>
							<RunDot />
							<span className="tabular">
								Claude 실행 {running}
								{queued > 0 && ` · 대기 ${queued}`}
							</span>
						</button>
					</PopoverTrigger>
					<PopoverContent align="end" className="pop w-96 p-0">
						<JobList jobs={jobs} />
					</PopoverContent>
				</Popover>
			)}
			<div className="flex h-full">
				<WinButton label="최소화" onClick={() => void win.minimize()}>
					<path d="M1 5.5h9" />
				</WinButton>
				<WinButton label={max ? "이전 크기로" : "최대화"} onClick={() => void win.toggleMaximize()}>
					{max ? (
						<>
							<rect x="1" y="3" width="7" height="7" rx="1" />
							<path d="M3.5 3V2a1 1 0 0 1 1-1H9a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H8" />
						</>
					) : (
						<rect x="1" y="1" width="9" height="9" rx="1.2" />
					)}
				</WinButton>
				<WinButton label="닫기" danger onClick={() => void win.close()}>
					<path d="M1.5 1.5l8 8M9.5 1.5l-8 8" />
				</WinButton>
			</div>
			<AlertDialog open={closing} onOpenChange={setClosing}>
				<AlertDialogContent className="pop">
					<AlertDialogHeader>
						<AlertDialogTitle>Claude 작업 {jobs.length}개가 아직 돌고 있습니다</AlertDialogTitle>
						<AlertDialogDescription>
							닫으면 모두 멈춥니다. 이미 고친 파일은 남고 변경 탭에 기록돼 있습니다. 다시 열면 끊긴 작업을 「다시 시도」로 이어 갈 수 있습니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-[13px]">
						{jobs.map((j) => (
							<li key={j.key} className="flex items-center gap-2">
								<RunDot className={j.phase === "queued" ? "bg-subtle" : undefined} />
								<span className="min-w-0 flex-1 truncate">{j.label}</span>
								<span className="shrink-0 text-[12px] text-subtle">{j.what}</span>
							</li>
						))}
					</ul>
					<AlertDialogFooter>
						<AlertDialogCancel>닫지 않기</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() =>
								void (async () => {
									// 멈추라고 알린 뒤 닫는다. 미처 못 멈춘 claude 는 앱이 끝날 때 작업 개체가 끈다.
									await api.runsStopAll().catch(() => 0);
									await win.destroy();
								})()
							}
						>
							중지하고 닫기
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</header>
	);
}

function JobList({ jobs }: { jobs: Job[] }) {
	const [busy, setBusy] = useState(false);
	const stop = async (fn: () => Promise<unknown>) => {
		try {
			await fn();
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	return (
		<div className="flex flex-col">
			<ul className="flex max-h-80 flex-col overflow-y-auto py-1">
				{jobs.map((j) => (
					<JobRow key={j.key} job={j} onStop={() => void stop(() => (j.target === "issue" ? api.issueStop(j.project.id, j.id) : api.deliverableStop(j.project.id, j.id)))} />
				))}
			</ul>
			<div className="flex items-center justify-between border-t border-border px-3 py-2">
				<span className="text-[12px] text-subtle">고친 파일은 멈춰도 남습니다</span>
				<Button
					size="xs"
					variant="outline"
					disabled={busy}
					onClick={() =>
						void (async () => {
							setBusy(true);
							await stop(() => api.runsStopAll());
							setBusy(false);
						})()
					}
				>
					모두 중지
				</Button>
			</div>
		</div>
	);
}

function JobRow({ job, onStop }: { job: Job; onStop: () => void }) {
	const activity = useLive((s) => (job.phase === "running" ? s.byTarget[job.id]?.activity : undefined));
	const go = () => useUi.getState().openTarget({ projectId: job.project.id, target: job.target, id: job.id, talk: job.talk });
	const menu: ActionList = [
		{ label: job.talk ? "대화 열기" : job.target === "issue" ? "이슈 열기" : "산출물 열기", icon: <PanelRight />, onSelect: go },
		"sep",
		{ label: job.phase === "queued" ? "줄에서 빼기" : "중지", icon: <Square className="fill-current" />, destructive: true, onSelect: onStop },
	];
	return (
		<ContextActions items={menu} className="w-44">
			<li className="group flex items-center gap-2 px-3 py-1.5 hover:bg-hover">
				<RunDot className={job.phase === "queued" ? "bg-subtle [animation:none]" : undefined} />
				<button type="button" onClick={go} className="flex min-w-0 flex-1 flex-col text-left outline-none focus-visible:underline">
					<span className="flex items-baseline gap-2">
						<span className="min-w-0 truncate text-[13px] font-medium">{job.label}</span>
						<span className="shrink-0 text-[11.5px] text-subtle">
							{job.what}
							{job.phase === "queued" && " · 대기"}
						</span>
					</span>
					<span className="truncate text-[11.5px] text-subtle">{activity || job.project.name}</span>
				</button>
				<Button size="icon-sm" variant="ghost" aria-label={`${job.label} 중지`} title="중지" className="text-muted-foreground hover:text-danger" onClick={onStop}>
					<Square className="size-3 fill-current" />
				</Button>
			</li>
		</ContextActions>
	);
}

function WinButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className={
				"grid w-11 place-items-center text-muted-foreground transition-colors hover:text-foreground " +
				(danger ? "hover:bg-[oklch(0.58_0.21_25)] hover:text-white" : "hover:bg-hover")
			}
		>
			<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
				{children}
			</svg>
		</button>
	);
}

/** 접힌 귀퉁이 하나. 포스트잇을 가리키는 표지다. */
export function Mark({ size = 16 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
			<path d="M3 2.5h10a.5.5 0 0 1 .5.5v6.8L9.8 13.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" fill="currentColor" />
			<path d="M13.5 9.8H10.3a.5.5 0 0 0-.5.5v3.2z" fill="var(--background)" opacity=".45" />
		</svg>
	);
}
