import { type ClipboardEvent, type KeyboardEvent, memo, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Clock, Copy, History, Image as ImageIcon, ImagePlus, MessagesSquare, Square, SquareTerminal, StickyNote, X } from "lucide-react";
import { toast } from "sonner";
import { copy } from "@/components/ActionMenu";
import { AttachmentThumbs, DropOverlay } from "@/components/AttachmentThumbs";
import { Chip } from "@/components/bits";
import { RunEvents, RunLog } from "@/components/RunLog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText } from "@/lib/api";
import { canEdit, CHAT_MODES, chatModeInfo, mergeChatModes, useChatMode } from "@/lib/chatMode";
import { useDropZone } from "@/lib/drop";
import { attachmentPath, clock, cost, duration, newId, relTime, tokens } from "@/lib/format";
import { forkOf, useForkedTalk, useIssues, useProjects, useSettings, useTerminalPlugin } from "@/lib/queries";
import { RUN_KIND_LABEL } from "@/lib/status";
import { useLive, useUi } from "@/lib/store";
import type { ChatMode, HistoryEntry, Issue, QueuedChat, RunRecord, Turn } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 쓰다 만 질문은 탭을 오가도 남는다. 그래서 상태를 상세 창이 들고 있다. */
export interface Draft {
	text: string;
	/** 붙여 넣거나 끌어 놓은 파일. 올리는 즉시 이슈 첨부 폴더에 들어가고, 보낼 때 이름만 넘긴다. */
	images: string[];
}

export const NO_DRAFT: Draft = { text: "", images: [] };

/** 작은따옴표로 감싸면 PowerShell · bash 어느 쪽에 붙여도 경로의 $ · 빈칸이 풀리지 않는다. */
function resumeCommand(path: string, sessionId: string) {
	return `cd '${path.replace(/'/g, "''")}'; claude --resume ${sessionId}`;
}


/**
 * 터미널에서 이어 간 차례. 읽으면서 그 차례들이 고친 파일을 이슈의 변경에 담는다.
 * 상세 창이 열려 있으면 어느 탭에 있든 읽는다 — 터미널에서 고치고 돌아와 변경 탭부터 봐도 거기 있어야 한다.
 */
export function useTranscript(issue: Issue) {
	return useQuery({
		queryKey: ["transcript", issue.projectId, issue.id, issue.sessionId, issue.runs.length],
		queryFn: () => api.issueTranscript(issue.projectId, issue.id),
		enabled: !!issue.sessionId,
		staleTime: 0,
	});
}

/** 입력칸과 대화 목록은 형제라 서로를 모른다. 보낸 질문이 그 대화를 맨 아래로 데려가도록 이슈 id 로 잇는다. */
const toBottom = new Map<string, () => void>();

/** 질문을 보낸 사람은 답을 보려는 것이다. 위를 읽던 중이어도 맨 아래로 데려간다. 대기열이 저절로 나갈 때는 부르지 않는다. */
function scrollChatToBottom(issueId: string) {
	toBottom.get(issueId)?.();
}

/**
 * 대화 칸이 바닥에 붙어 있는지를 한 곳에서 정한다. 들어오면 붙은 채로 시작하고, 위로 올리면 떨어지며, 바닥 가까이 내리면 다시 붙는다.
 * 붙어 있으면 내용 높이가 바뀔 때마다 내린다. 지난 기록 · 세션 기록 · 그림은 처음 그린 뒤에 읽혀 높이가 자란다 —
 * 처음 한 번만 내리면 대화를 열었을 때 중간에서 멈춘다.
 */
function useStickToBottom(box: RefObject<HTMLDivElement | null>, issueId: string) {
	const stick = useRef(true);
	const [away, setAway] = useState(false);
	const go = useRef<() => void>(() => {});

	useLayoutEffect(() => {
		const inner = box.current;
		const el = inner?.closest("[data-scroll]") as HTMLElement | null;
		if (!inner || !el) return;
		// 부드럽게 내리는 동안의 중간 위치를 「올렸다」로 읽지 않는다. 사용자가 휠을 올리면 그만둔다.
		let gliding = false;
		const pin = () => {
			if (stick.current) el.scrollTop = el.scrollHeight;
		};
		const onScroll = () => {
			const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
			if (gliding && !near) return;
			gliding = false;
			stick.current = near;
			setAway(!near);
		};
		const onWheel = (e: WheelEvent) => {
			if (e.deltaY < 0) gliding = false;
		};
		const onEnd = () => {
			gliding = false;
			onScroll();
		};
		go.current = () => {
			stick.current = true;
			gliding = true;
			setAway(false);
			el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
		};
		pin();
		// 대화 목록이 자라거나, 입력칸 · 첨부가 커져 스크롤 칸이 줄어도 붙어 있던 자리를 지킨다.
		const ro = new ResizeObserver(pin);
		ro.observe(inner);
		ro.observe(el);
		el.addEventListener("scroll", onScroll);
		el.addEventListener("scrollend", onEnd);
		el.addEventListener("wheel", onWheel, { passive: true });
		return () => {
			ro.disconnect();
			el.removeEventListener("scroll", onScroll);
			el.removeEventListener("scrollend", onEnd);
			el.removeEventListener("wheel", onWheel);
		};
	}, [box]);

	useLayoutEffect(() => {
		const fn = () => go.current();
		toBottom.set(issueId, fn);
		return () => {
			if (toBottom.get(issueId) === fn) toBottom.delete(issueId);
		};
	}, [issueId]);

	return { away, toBottom: () => go.current() };
}

/**
 * 이슈의 Claude 세션을 대화로 보여 준다. 계획 · 구현도 같은 세션의 한 차례라 함께 늘어놓고, 접어 둔다.
 * 질문은 그 세션을 이어(--resume) 보내므로 Claude 가 지금까지 읽고 고친 것을 기억한 채 답한다.
 * 세션 막대(SessionBar)는 여기서 그리지 않는다. 상세 창이 스크롤 칸 밖에 둔다.
 * 초안은 상위가 들고 있어 글자마다 상위가 다시 그려진다. memo 로 감싸 그때 대화 기록까지 다시 그리지 않는다.
 */
export const ChatTab = memo(function ChatTab({ issue, projectPath }: { issue: Issue; projectPath: string }) {
	const box = useRef<HTMLDivElement>(null);
	// 따라 내려갈지는 대화 칸이 정한다. 안의 RunLog 는 follow 를 꺼 스스로 내리지 않는다.
	const { away, toBottom } = useStickToBottom(box, issue.id);
	// 터미널에서 이어 간 차례는 세션 기록에만 있다. 터미널에서 돌아와 창에 초점이 오면 다시 읽는다.
	const { data: turns = [] } = useTranscript(issue);
	const items: ({ at: number; run: RunRecord } | { at: number; turn: Turn })[] = [
		...issue.runs.map((run) => ({ at: run.startedAt, run })),
		...turns.map((turn) => ({ at: turn.at, turn })),
	].sort((a, b) => a.at - b.at);

	return (
		<div ref={box} className="flex flex-col gap-5">
			{items.length === 0 && issue.talk && (
				<p className="text-[13px] leading-relaxed break-keep text-subtle">
					이 저장소에 대해 무엇이든 물어보세요. Claude 가 코드를 읽고 답합니다. 묻다가 「작업 메모로 등록해 줘」라고 하면 보드에 메모를 만듭니다.
				</p>
			)}
			{items.length === 0 && !issue.talk && (
				<p className="text-[13px] leading-relaxed text-subtle">
					아직 Claude 와 나눈 말이 없습니다. 아래에 적으면 메모{issue.plan ? " · 계획" : ""}을 읽고 새 세션을 엽니다. 묻기만 할 수도, 바로 고치게 할 수도 있고 고친 파일은 변경 탭에
					쌓입니다.
				</p>
			)}
			{items.map((x) =>
				"turn" in x ? (
					<TerminalTurn key={`t${x.at}`} issue={issue} root={projectPath} turn={x.turn} />
				) : x.run.kind === "chat" ? (
					<ChatTurn key={x.run.id} issue={issue} root={projectPath} run={x.run} memos={memosOf(issue, x.run)} />
				) : (
					<StepTurn key={x.run.id} issue={issue} root={projectPath} run={x.run} />
				),
			)}
			{issue.history
				.filter((h) => h.kind === "promoted")
				.map((h) => (
					<PromotedLine key={h.at} projectId={issue.projectId} entry={h} />
				))}
			{/* 위로 올라가 있는 동안 늘 띄운다. 칸 바닥에 붙는 높이 0 의 줄이라 상위 화면을 고치지 않고 두 화면에 함께 생긴다. -mt-5 로 목록의 gap 을 지운다. */}
			<div className="pointer-events-none sticky bottom-0 -mt-5 h-0">
				<Button
					size="icon-sm"
					variant="outline"
					aria-label="맨 아래로"
					title="맨 아래로"
					tabIndex={away ? 0 : -1}
					onClick={toBottom}
					className={cn(
						"absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-popover/90 shadow-md backdrop-blur transition-[opacity,translate] duration-150",
						away ? "pointer-events-auto opacity-100" : "translate-y-1.5 opacity-0",
					)}
				>
					<ArrowDown />
				</Button>
			</div>
		</div>
	);
});

function Bubble({ text, from, issue, images = [] }: { text: string; from?: string; issue?: Issue; images?: string[] }) {
	return (
		<div className="flex flex-col items-end gap-1">
			{from && <span className="text-[11.5px] text-subtle">{from}</span>}
			{issue && images.length > 0 && <AttachmentThumbs className="max-w-[85%] justify-end" names={images} pathOf={(n) => attachmentPath(issue, n)} />}
			{text.trim() && (
				<div className="max-w-[85%] rounded-lg bg-secondary px-3.5 py-2.5 text-[13.5px] leading-relaxed break-keep whitespace-pre-wrap text-foreground selectable">
					{text}
				</div>
			)}
		</div>
	);
}

/** 터미널에서 나눈 차례. 이 앱이 돌린 것이 아니라 끝 줄(시간 · 비용)이 없다. */
function TerminalTurn({ issue, root, turn }: { issue: Issue; root: string; turn: Turn }) {
	return (
		<div className="flex flex-col gap-2">
			<Bubble text={turn.prompt} from={`터미널 · ${clock(turn.at)}`} />
			<div className="pl-1">
				<RunLog events={turn.events} base={issue.dir} root={root} follow={false} />
			</div>
		</div>
	);
}

/** 대화 탭 위에 늘 보이는 한 줄. 대화가 쌓여도 이 단추를 쓰려고 맨 위까지 올리지 않게 스크롤 칸 밖에 둔다. */
export function SessionBar({ issue, projectPath, compact = false }: { issue: Issue; projectPath: string; compact?: boolean }) {
	const id = issue.sessionId;
	const plugin = useTerminalPlugin();
	if (!id) return null;
	const openTitle = plugin
		? (plugin.contributes.terminal?.attach.length ?? 0) > 0
			? `켜 둔 ${plugin.name} 에 새 탭으로 붙입니다. 없으면 새로 띄웁니다`
			: `프로젝트 폴더에서 ${plugin.name} 를 띄웁니다`
		: "프로젝트 폴더에서 claude --resume 으로 엽니다";
	const terminalLabel = plugin ? `${plugin.name} 에서 잇기` : "터미널에서 잇기";
	// 좁은 옆 칸에서는 ID 를 줄이고 단추를 아이콘으로만 둔다. 이름은 툴팁으로 보인다.
	const size = compact ? "icon-sm" : "sm";
	return (
		<div className={cn("flex items-center gap-3 border-b border-border py-1.5", compact ? "px-4" : "px-6")}>
			<div className="flex min-w-0 flex-1 items-baseline gap-2">
				<span className="shrink-0 text-[12px] font-semibold text-muted-foreground">세션</span>
				<span className="mono min-w-0 truncate text-[12px] text-foreground selectable" title={id}>
					{compact ? `${id.slice(0, 8)}…` : id}
				</span>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				{!issue.talk && <PromoteButton issue={issue} />}
				{!compact && <SessionPicker issue={issue} />}
				<Button size={size} variant="ghost" title="세션 ID 복사" aria-label="세션 ID 복사" onClick={() => void copy(id, "세션 ID")}>
					<Copy />
					{!compact && "ID"}
				</Button>
				{!compact && (
					<Button size="sm" variant="ghost" title={resumeCommand(projectPath, id)} onClick={() => void copy(resumeCommand(projectPath, id), "터미널 명령")}>
						<Copy />
						명령
					</Button>
				)}
				{/* 앱이 이 세션을 돌리는 동안 터미널에서도 이으면 대화가 두 갈래로 갈라진다. */}
				<Button
					size={size}
					variant={compact ? "ghost" : "outline"}
					disabled={!!issue.run}
					aria-label={terminalLabel}
					title={issue.run ? "실행이 끝나면 열 수 있습니다" : compact ? `${terminalLabel} — ${openTitle}` : openTitle}
					onClick={() => void api.issueOpenTerminal(issue.projectId, issue.id).catch((e) => toast.error(errorText(e)))}
				>
					<SquareTerminal />
					{!compact && terminalLabel}
				</Button>
			</div>
		</div>
	);
}

/**
 * 메모의 대화를 프로젝트 대화로 갈라 낸다. 한 사안을 길게 이어 가고 싶다는 생각은 대화를 보다가 들어서 이 줄에 둔다.
 * 메모는 그대로 남고, 새 대화는 이 세션을 이어 받아 갈라진 세션으로 간다. 갈라 낸 대화는 옆 칸에 띄운다.
 */
export function PromoteButton({ issue }: { issue: Issue }) {
	const [busy, setBusy] = useState(false);
	const forked = useForkedTalk(issue);
	return (
		<Button
			size="sm"
			variant="ghost"
			disabled={busy || (!forked && !!issue.run)}
			title={forked ? "이 메모에서 갈라 낸 대화를 옆 칸에 띄웁니다" : issue.run ? "실행이 끝나면 갈라 낼 수 있습니다" : "메모는 그대로 두고 이 대화를 프로젝트 대화로 갈라 내 옆 칸에 띄웁니다"}
			onClick={() => void promoteTalk(issue, setBusy)}
		>
			<MessagesSquare />
			{forked ? "갈라 낸 대화 열기" : "대화로 이어 가기"}
		</Button>
	);
}

export async function promoteTalk(issue: Issue, setBusy: (b: boolean) => void = () => {}) {
	setBusy(true);
	try {
		// 화면에 보인 이름과 상관없이 목록을 새로 읽어 고른다. 낡은 값으로 고르면 같은 메모의 대화가 늘어난다.
		const t = forkOf(await api.talks(issue.projectId), issue.id) ?? (await api.talkPromote(issue.projectId, issue.id, newId()));
		useUi.getState().dockTalk({ projectId: t.projectId, id: t.id });
	} catch (e) {
		toast.error(errorText(e));
	}
	setBusy(false);
}

/**
 * CLI 판에 따라 터미널에서 이으면 새 세션 ID 로 갈라진다. 그때 같은 프로젝트 폴더의 최근 세션 중에서 골라 다시 잡는다.
 * 목록은 열 때만 읽는다. 세션 기록 파일이 커서 늘 읽어 둘 것은 아니다.
 */
function SessionPicker({ issue }: { issue: Issue }) {
	const [open, setOpen] = useState(false);
	const { data, isFetching } = useQuery({
		queryKey: ["sessions", issue.projectId],
		queryFn: () => api.issueSessions(issue.projectId),
		enabled: open,
		staleTime: 0,
	});
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button size="sm" variant="ghost" disabled={!!issue.run} title="터미널에서 이으며 세션이 바뀌었으면 여기서 다시 잡습니다">
					<History />
					바꾸기
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="pop w-96">
				<DropdownMenuLabel className="text-[12px] font-normal text-subtle">이 프로젝트 폴더의 최근 세션</DropdownMenuLabel>
				{!data && isFetching && <div className="px-2 py-3 text-[12.5px] text-subtle">읽는 중</div>}
				{data?.length === 0 && <div className="px-2 py-3 text-[12.5px] text-subtle">세션 기록이 없습니다</div>}
				{data?.map((s) => (
					<DropdownMenuItem
						key={s.id}
						disabled={s.id === issue.sessionId}
						onSelect={() =>
							void api
								.issueSetSession(issue.projectId, issue.id, s.id)
								.then(() => toast("세션을 바꿨습니다"))
								.catch((e) => toast.error(errorText(e)))
						}
						className="flex flex-col items-start gap-0.5"
					>
						<span className="flex w-full items-center gap-2 text-[12px] text-subtle">
							<span className="mono">{s.id.slice(0, 8)}</span>
							<span>{relTime(s.modified)}</span>
							<span className="tabular">{s.turns}차례</span>
							<span className="flex-1" />
							{s.id === issue.sessionId && <Check className="size-3.5" aria-label="지금 세션" />}
						</span>
						<span className="line-clamp-2 text-[12.5px] text-foreground">{s.lastPrompt}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * 그 차례가 보드에 등록한 메모. 앱은 실행이 끝난 뒤에 메모를 만들므로 기록 시각이 실행 끝보다 늦다.
 * 그래서 이 차례의 시작부터 다음 실행의 시작 전까지를 이 차례 것으로 본다.
 */
function memosOf(issue: Issue, run: RunRecord): HistoryEntry[] {
	const next = Math.min(...issue.runs.filter((r) => r.startedAt > run.startedAt).map((r) => r.startedAt), Number.POSITIVE_INFINITY);
	return issue.history.filter((h) => h.kind === "memo" && h.at >= run.startedAt && h.at < next);
}

function ChatTurn({ issue, root, run, memos }: { issue: Issue; root: string; run: RunRecord; memos: HistoryEntry[] }) {
	const live = run.status === "running";
	return (
		<div className="flex flex-col gap-2">
			<Bubble text={run.prompt} issue={issue} images={run.images} />
			<div className="pl-1">
				<RunEvents projectId={issue.projectId} target="issue" targetId={issue.id} runId={run.id} live={live} base={issue.dir} root={root} follow={false} />
				{/* Claude 가 결과를 내기 전에 죽으면 기록에 끝 줄이 없다. 그때 남은 오류를 여기 보인다. */}
				{run.status === "error" && run.error && !run.numTurns && (
					<div className="mt-1 text-[12px] whitespace-pre-wrap text-danger/90 selectable">{run.error}</div>
				)}
				{run.status === "stopped" && <div className="mt-1 text-[12px] text-subtle">중지했습니다</div>}
				{memos.map((m) => (
					<MemoLine key={m.at + m.text} projectId={issue.projectId} entry={m} />
				))}
			</div>
		</div>
	);
}

/**
 * 대화가 보드에 만든 메모 한 건. 기록 글은 `#번호 제목`, 실패했으면 `실패 · 까닭` 이다.
 * 앱 대화는 다른 프로젝트의 보드에 남기므로 `@<프로젝트 id> #번호 제목` 꼴이다. 그때는 어느 보드인지 앞에 보인다.
 */
function MemoLine({ projectId, entry }: { projectId: string; entry: HistoryEntry }) {
	const m = /^@(\S+) (.*)$/s.exec(entry.text);
	const pid = m?.[1] ?? projectId;
	const text = m?.[2] ?? entry.text;
	const { data: issues = [] } = useIssues(pid);
	const { data: projects = [] } = useProjects();
	const n = /^#(\d+)\s/.exec(text)?.[1];
	if (!n) return <div className="mt-2 text-[12.5px] break-keep text-danger/90 selectable">메모를 등록하지 못했습니다 · {text.replace(/^실패 · /, "")}</div>;
	const target = issues.find((i) => i.number === Number(n));
	const board = m ? `${projects.find((p) => p.id === pid)?.name ?? "다른 프로젝트"} 보드에` : "보드에";
	return (
		<div className="mt-2 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12.5px]">
			<StickyNote className="size-3.5 shrink-0 text-subtle" />
			<span className="min-w-0 flex-1 truncate">
				<span className="text-subtle">{board} 메모를 등록했습니다 · </span>
				<span className="font-medium text-foreground">{text}</span>
			</span>
			{target && (
				<Button size="xs" variant="outline" onClick={() => useUi.getState().openTarget({ projectId: pid, target: "issue", id: target.id })}>
					열기
				</Button>
			)}
		</div>
	);
}

/** 메모 대화 탭 끝에 보이는 「갈라 낸 대화」 줄. 기록 글은 `<대화 id> <제목>` 이다. */
function PromotedLine({ projectId, entry }: { projectId: string; entry: HistoryEntry }) {
	const [id, ...rest] = entry.text.split(" ");
	const title = rest.join(" ") || "새 대화";
	return (
		<div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[12.5px]">
			<MessagesSquare className="size-3.5 shrink-0 text-subtle" />
			<span className="min-w-0 flex-1 truncate">
				<span className="text-subtle">「{title}」 대화로 갈라 냈습니다 · </span>
				<span className="text-subtle">{relTime(entry.at)}</span>
			</span>
			<Button size="xs" variant="outline" onClick={() => useUi.getState().openTarget({ projectId, target: "issue", id, talk: true })}>
				열기
			</Button>
			<Button size="xs" variant="ghost" onClick={() => useUi.getState().dockTalk({ projectId, id })}>
				옆에 띄우기
			</Button>
		</div>
	);
}

/** 계획 · 구현 차례. 결과는 계획 · 변경 탭에 정리돼 있으니 여기서는 한 줄로 접어 둔다. */
function StepTurn({ issue, root, run }: { issue: Issue; root: string; run: RunRecord }) {
	const live = run.status === "running";
	const [open, setOpen] = useState(live);
	const status = { running: "실행 중", ok: "끝", error: "실패", stopped: "중지" }[run.status];
	return (
		<div className="flex flex-col">
			<button type="button" onClick={() => setOpen((v) => !v)} className="flex h-8 items-center gap-2 text-left text-[12.5px] text-subtle">
				<ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
				<span className="font-medium text-muted-foreground">{RUN_KIND_LABEL[run.kind] ?? run.kind}</span>
				<Chip tone={live ? "run" : run.status === "error" ? "danger" : "muted"}>{status}</Chip>
				<span className="h-px flex-1 bg-border" />
				<span className="tabular text-[12px]">
					{[clock(run.startedAt), duration(run.durationMs), tokens(run.tokens) && `토큰 ${tokens(run.tokens)}`, cost(run.costUsd)].filter(Boolean).join(" · ")}
				</span>
			</button>
			{open && (
				<div className="pt-1 pl-5.5">
					<RunEvents projectId={issue.projectId} target="issue" targetId={issue.id} runId={run.id} live={live} base={issue.dir} root={root} follow={false} />
				</div>
			)}
		</div>
	);
}

/**
 * 설정의 보내기 키로 입력칸의 키를 가린다. 대화 · 다시 계획 · 수정 요청 입력칸이 같은 판정을 쓴다.
 * Enter 방식이어도 Ctrl+Enter 는 보낸다. 두 방식을 오가는 손버릇이 섞여도 헛누르지 않게 하려는 것이다.
 */
export function useSendKey() {
	const { data: settings } = useSettings();
	const enter = settings?.sendKey === "enter";
	return {
		label: enter ? "↵" : "Ctrl ↵",
		hint: enter ? " · Shift+Enter 로 줄바꿈" : "",
		isSend: (e: KeyboardEvent) => {
			if (e.key !== "Enter") return false;
			if (e.ctrlKey || e.metaKey) return true;
			// 한글 조합 중의 Enter 는 글자를 확정하는 것이다. 보내면 마지막 글자가 빠지거나 두 번 나간다.
			if (!enter || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return false;
			e.preventDefault();
			return true;
		},
	};
}

/**
 * 실행이 끝나기를 기다리는 질문. 끝나면 한 차례로 묶여 나가고, 중지했으면 남아 있다.
 * 「고치기」는 그 질문을 입력칸으로 되돌린다. 첨부는 초안이 이어 쓰므로 남긴다.
 */
function QueueList({ issue, onEdit, disabled }: { issue: Issue; onEdit: (q: QueuedChat) => void; disabled: boolean }) {
	const queue = issue.queue ?? [];
	if (!queue.length) return null;
	return (
		<div className="flex flex-col gap-1">
			{queue.map((q) => (
				<div key={q.id} className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-[12.5px]">
					<Clock className="size-3.5 shrink-0 text-subtle" aria-label="대기" />
					{q.images.length > 0 && (
						<span className="flex shrink-0 items-center gap-0.5 text-subtle" title={q.images.join(", ")}>
							<ImageIcon className="size-3.5" />
							{q.images.length}
						</span>
					)}
					<span className="flex shrink-0 items-center gap-1.5 text-subtle">
						<ModeDot mode={q.mode} />
						{chatModeInfo(q.mode).label} ·
					</span>
					<span className="min-w-0 flex-1 truncate text-foreground" title={q.text}>
						{q.text.trim() || "첨부만"}
					</span>
					<Button size="xs" variant="ghost" disabled={disabled} onClick={() => onEdit(q)}>
						고치기
					</Button>
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="대기열에서 빼기"
						disabled={disabled}
						onClick={() => void api.issueQueueRemove(issue.projectId, issue.id, q.id).catch((e) => toast.error(errorText(e)))}
					>
						<X />
					</Button>
				</div>
			))}
		</div>
	);
}

function ModeDot({ mode }: { mode: ChatMode }) {
	return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", chatModeInfo(mode).dot)} />;
}

/** 입력칸의 권한 모드. 차례마다 권한을 정해 시작하므로 실행 중에 바꾸면 다음 차례부터 적용한다. 좁은 칸에서도 권한 무시는 이름을 줄이지 않는다. */
function ModeMenu({ mode, onMode, compact }: { mode: ChatMode; onMode: (m: ChatMode) => void; compact: boolean }) {
	const cur = chatModeInfo(mode);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button size="sm" variant="ghost" className="shrink-0 gap-1.5 px-2 text-[12.5px] text-muted-foreground" title={`권한 모드 — ${cur.desc}. 바꾸면 다음 차례부터 적용합니다`}>
					<ModeDot mode={mode} />
					{compact ? cur.short : cur.label}
					<ChevronDown className="size-3.5 text-subtle" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="pop w-80">
				<DropdownMenuLabel className="text-[12px] font-normal text-subtle">권한 모드 · 다음 차례부터 적용합니다</DropdownMenuLabel>
				{CHAT_MODES.map((m) => (
					<DropdownMenuItem key={m.value} disabled={!!m.unavailable} onSelect={() => onMode(m.value)} className="flex items-start gap-2.5">
						<span className="flex h-[18px] shrink-0 items-center">
							<ModeDot mode={m.value} />
						</span>
						<span className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="text-[13px] text-foreground">
								{m.label}
								{m.unavailable && <span className="ml-1.5 text-[11.5px] text-subtle">{m.unavailable}</span>}
							</span>
							<span className="text-[12px] leading-snug break-keep text-subtle">{m.desc}</span>
						</span>
						{m.value === mode && <Check className="mt-0.5 size-3.5 shrink-0" aria-label="지금 모드" />}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** 상세 창 아래 칸. 실행 중이면 무엇을 하는지와 중지를 두고, 그 사이 적은 질문은 대기열에 넣는다. */
export function ChatComposer({ issue, draft, onDraft, beforeSend, compact = false }: { issue: Issue; draft: Draft; onDraft: (d: Draft) => void; beforeSend?: () => Promise<void>; compact?: boolean }) {
	const [busy, setBusy] = useState(false);
	const sendKey = useSendKey();
	const mode = useChatMode(issue);
	const setChatMode = useUi((s) => s.setChatMode);
	const activity = useLive((s) => (issue.run ? s.byTarget[issue.id]?.activity : undefined));
	const { projectId: p, id } = issue;
	const running = !!issue.run;
	const waiting = issue.queue?.length ?? 0;

	const go = async (fn: () => Promise<unknown>) => {
		setBusy(true);
		try {
			await fn();
		} catch (e) {
			toast.error(errorText(e));
		}
		setBusy(false);
	};
	const empty = !draft.text.trim() && draft.images.length === 0;
	// 실행 중이면 백엔드가 대기열에 넣는다. 실행 중인지는 백엔드가 판정한다 — 막 끝난 순간에 보낸 질문이 튕기지 않게 한다.
	const send = () => {
		if (busy || empty) return;
		void go(async () => {
			await beforeSend?.();
			await api.issueChat(p, id, draft.text, mode, draft.images);
			setChatMode(id, mode);
			onDraft({ ...draft, text: "", images: [] });
			scrollChatToBottom(id);
		});
	};
	// 대기 중인 질문을 입력칸으로 되돌린다. 적던 글이 있으면 그 뒤에 잇는다.
	const editQueued = (q: QueuedChat) =>
		void go(async () => {
			await api.issueQueueRemove(p, id, q.id, true);
			const d = latest.current;
			const blank = !d.text.trim() && d.images.length === 0;
			setChatMode(id, blank ? q.mode : mergeChatModes(mode, q.mode));
			onDraft({
				text: [d.text.trimEnd(), q.text].filter((t) => t.trim()).join("\n\n"),
				images: [...d.images, ...q.images.filter((n) => !d.images.includes(n))],
			});
		});

	// 올리는 동안 draft 가 바뀔 수 있다(글을 더 친다). 끝난 시점의 초안에 이름을 더하도록 최신 값을 잡아 둔다.
	const latest = useRef(draft);
	latest.current = draft;
	const addImages = (names: string[]) => {
		if (names.length) onDraft({ ...latest.current, images: [...latest.current.images, ...names] });
	};
	const importFiles = (paths: string[]) => void go(async () => addImages(await api.attachmentImport(p, id, paths)));
	const [dropRef, over] = useDropZone<HTMLDivElement>(importFiles);
	const paste = (e: ClipboardEvent) => {
		const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
		if (!files.length) return;
		e.preventDefault();
		void go(async () => {
			const names: string[] = [];
			for (const f of files) names.push(await api.attachmentSave(p, id, new Uint8Array(await f.arrayBuffer()), f.type.split("/")[1] ?? "png"));
			addImages(names);
		});
	};
	// 보내지 않고 뺀 첨부는 첨부 폴더에서도 치운다. 남기면 메모 탭에 까닭 모를 그림이 쌓인다.
	const remove = (name: string) => {
		onDraft({ ...draft, images: draft.images.filter((n) => n !== name) });
		void api.attachmentDelete(p, id, name).catch(() => {});
	};

	const keys = ` · ${sendKey.label}${sendKey.hint}`;
	return (
		<div ref={dropRef} className={cn("flex flex-col gap-2 border-t border-border py-3", compact ? "px-4" : "px-6")}>
			<QueueList issue={issue} onEdit={editQueued} disabled={busy} />
			<div className="relative rounded-xl border border-border bg-card transition-colors focus-within:border-border-strong">
				{over && <DropOverlay />}
				{draft.images.length > 0 && <AttachmentThumbs className="px-3 pt-3" names={draft.images} pathOf={(n) => attachmentPath(issue, n)} onRemove={remove} />}
				<Textarea
					data-composer
					value={draft.text}
					onChange={(e) => onDraft({ ...draft, text: e.target.value })}
					onPaste={paste}
					onKeyDown={(e) => {
						if (sendKey.isSend(e)) send();
					}}
					placeholder={
						(canEdit(mode) ? "묻거나 고칠 것" : "물을 것") +
						(running
							? " · 답이 끝나면 대기 중인 질문과 묶어 보냅니다"
							: issue.sessionId
								? ""
								: issue.talk
									? " · 「작업 메모로 등록해 줘」라고 하면 보드에 메모를 만듭니다"
									: " · 메모를 읽고 새 세션을 엽니다")
					}
					className="max-h-48 min-h-16 resize-none rounded-none border-0 bg-transparent px-3 pt-2.5 pb-1 text-[13.5px] leading-relaxed focus-visible:ring-0 dark:bg-transparent"
				/>
				<div className="flex items-center gap-1 px-2 pb-2">
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="파일 첨부"
						title="이미지 · 파일 첨부 — 붙여 넣거나 끌어 놓아도 됩니다"
						disabled={busy}
						onClick={async () => {
							const picked = await openDialog({ multiple: true, title: "대화에 첨부할 파일" });
							if (Array.isArray(picked) && picked.length) importFiles(picked);
						}}
					>
						<ImagePlus />
					</Button>
					<ModeMenu mode={mode} onMode={(m) => setChatMode(id, m)} compact={compact} />
					<span className="mx-1 min-w-0 flex-1 truncate text-right text-[12.5px] text-subtle">
						{running && (issue.run?.phase === "queued" ? issue.run.waitFor || "앞선 작업을 기다리는 중" : activity)}
					</span>
					{/* 중지했거나 앱을 다시 켜서 남은 대기열. 저절로 보내지 않고 사용자가 이어 보낸다. */}
					{!running && waiting > 0 && (
						<Button
							size="sm"
							variant="outline"
							disabled={busy}
							className="shrink-0"
							title="대기 중인 질문을 한 차례로 묶어 보냅니다"
							onClick={() =>
								void go(async () => {
									await api.issueQueueSend(p, id);
									scrollChatToBottom(id);
								})
							}
						>
							대기 {waiting}건 보내기
						</Button>
					)}
					{running ? (
						<>
							{!empty && (
								<Button size="sm" variant="outline" disabled={busy} className="shrink-0" title={`답이 끝나면 대기 중인 질문과 묶어 보냅니다${keys}`} onClick={send}>
									대기열에 넣기
								</Button>
							)}
							<Button size="icon-sm" disabled={busy} className="ml-1 shrink-0 rounded-full" aria-label="중지" title="중지" onClick={() => void go(() => api.issueStop(p, id))}>
								<Square className="size-3 fill-current" />
							</Button>
						</>
					) : (
						<Button
							size="icon-sm"
							disabled={busy || empty}
							className="ml-1 shrink-0 rounded-full"
							aria-label="보내기"
							title={`${waiting > 0 ? "대기 중인 질문 뒤에 붙여 함께 보내기" : "보내기"}${keys}`}
							onClick={send}
						>
							<ArrowUp />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
