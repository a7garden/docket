import { useEffect, useState } from "react";
import { Check, Copy, CornerDownRight, Hash, PanelRight, Paperclip, Square } from "lucide-react";
import { toast } from "sonner";
import { type ActionList, ContextActions, copy } from "@/components/ActionMenu";
import { Chip, Diffstat, RunDot } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { primaryAction, primaryItem, useIssueActions } from "@/features/issue/issueActions";
import { errorText } from "@/lib/api";
import { relTime } from "@/lib/format";
import { needsDecision, stateOf } from "@/lib/status";
import { useLive, useUi } from "@/lib/store";
import type { Issue } from "@/lib/types";
import { cn } from "@/lib/utils";

function useNow(active: boolean, ms = 1000) {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!active) return;
		const t = setInterval(() => setNow(Date.now()), ms);
		return () => clearInterval(t);
	}, [active, ms]);
	return now;
}

/** 카드에서는 마크다운 표시만 걷어 낸다. 글자 자체(LOG_LEVEL 의 밑줄 같은)는 건드리지 않는다. */
function plain(s: string) {
	return s.replace(/`/g, "").replace(/\*\*(.+?)\*\*/g, "$1");
}

/** 메모 본문에서 제목 줄 다음의 글 줄을 꺼낸다. 그림 · 코드 줄은 건너뛴다. */
function noteSnippet(note: string) {
	const lines = note.split("\n").map((l) => l.trim());
	const first = lines.findIndex((l) => l && !l.startsWith("!["));
	const body = lines
		.slice(first + 1)
		.filter((l) => l && !l.startsWith("![") && !l.startsWith("```"))
		.map((l) => l.replace(/^(#+|[-*>]|\d+\.)\s+/, ""))
		.join(" ");
	return plain(body).slice(0, 200);
}

export function totals(issue: Issue) {
	let added = 0;
	let removed = 0;
	for (const c of issue.changes)
		for (const h of c.hunks)
			for (const l of h.lines) {
				if (l.startsWith("+")) added++;
				else if (l.startsWith("-")) removed++;
			}
	return { added, removed, files: new Set(issue.changes.map((c) => c.rel)).size };
}

/** 보드 검색이 카드 제목 밖에서 찾았을 때 그 자리. 제목에서 찾았거나 찾는 중이 아니면 비어 있다. */
export interface Hit {
	where?: string;
	snippet?: string;
}

/** 찾는 낱말을 칠한다. 색은 쓰지 않는다 — 보드에서 색은 「결정할 것」 · 「실패」만 뜻한다. */
function Marked({ text, words }: { text: string; words: string[] }) {
	const ws = words.filter((w) => !/^#?\d+$/.test(w));
	if (ws.length === 0) return <>{text}</>;
	const re = new RegExp(`(${ws.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
	return (
		<>
			{text.split(re).map((part, n) =>
				n % 2 ? (
					<mark key={n} className="rounded-[3px] bg-[var(--selection)] px-px text-inherit">
						{part}
					</mark>
				) : (
					part
				),
			)}
		</>
	);
}

/** 실행 중 카드의 Ctrl+Enter 는 이 안에 한 번 더 눌러야 멈춘다. 키 한 번에 돌던 구현이 멈추면 안 된다. */
const STOP_CONFIRM_MS = 1500;

export function IssueCard({
	issue,
	delaySec,
	words = [],
	hit,
	followCount = 0,
	tabbable = true,
	selected = false,
	onPick,
	onOpen,
	bulk,
}: {
	issue: Issue;
	delaySec: number;
	words?: string[];
	hit?: Hit;
	/** 이 메모에서 이어진 후속 메모 수. 보드가 목록에서 거꾸로 세어 넘긴다. */
	followCount?: number;
	/** 보드에서 Tab 이 멈추는 카드인지. 나머지 카드는 방향키로 간다. */
	tabbable?: boolean;
	/** 여러 개 고르기에 들어 있는지. */
	selected?: boolean;
	/** 주면 Ctrl(맥은 Cmd) · Shift 클릭이 상세 창을 여는 대신 카드를 고른다. */
	onPick?: (e: React.MouseEvent) => void;
	/** 그냥 클릭 · Enter 로 열 때 먼저 부른다. 탐색기처럼 고른 것을 푼다. */
	onOpen?: () => void;
	/** 고른 카드를 우클릭했을 때 맨 위에 붙일 「고른 N개」 항목. */
	bulk?: ActionList;
}) {
	const openIssue = useUi((s) => s.openIssue);
	const open = () => {
		onOpen?.();
		openIssue(issue.id);
	};
	const activity = useLive((s) => (issue.run ? s.byTarget[issue.id]?.activity : undefined));
	const waitingAuto = issue.status === "inbox" && issue.autoPlan && !issue.run && !issue.error;
	const now = useNow(waitingAuto);
	const state = stateOf(issue);
	const [busy, setBusy] = useState(false);

	const secondary =
		issue.status === "planned" || issue.status === "planning"
			? issue.plan?.summary
			: issue.status === "review" || issue.status === "done"
				? (issue.result?.summary ?? issue.plan?.summary)
				: noteSnippet(issue.note);
	const decide = needsDecision(issue);

	const act = async (fn: () => Promise<unknown>) => {
		setBusy(true);
		try {
			await fn();
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const questions = issue.plan?.questions.length ?? 0;
	const t = totals(issue);
	const remain = Math.max(0, Math.ceil((issue.noteUpdatedAt + delaySec * 1000 - now) / 1000));

	// 카드 단추와 우클릭 메뉴가 같은 주 동작을 부른다. 단추를 누르면 카드가 열리지 않게 이벤트를 멈춘다.
	const primary = primaryAction(issue);
	const press = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (primary) void act(primary.call);
	};
	// 상태 줄에 단추가 보이는 경우. 아래 상태 줄의 갈래와 같다 — 단추가 없으면(완료 · 보류의 다시 열기, 자동 계획 대기) Ctrl+Enter 도 아무것도 하지 않는다.
	// 우클릭 메뉴에만 있는 동작이 키 한 번에 보이지 않게 실행되면 안 된다.
	const button =
		issue.run || (!issue.error && ((issue.status === "planned" && questions === 0) || issue.status === "review" || (issue.status === "inbox" && !waitingAuto)))
			? primary
			: null;
	const [armed, setArmed] = useState(0);
	useEffect(() => {
		if (!armed) return;
		const t = setTimeout(() => setArmed(0), STOP_CONFIRM_MS);
		return () => clearTimeout(t);
	}, [armed]);
	const pressKey = () => {
		if (!button || busy || button.disabled) return;
		if (issue.run && !armed) {
			setArmed(Date.now());
			toast(`한 번 더 누르면 ${issue.run.phase === "queued" ? "줄에서 뺍니다" : "중지합니다"}`, { id: `stop:${issue.id}`, duration: STOP_CONFIRM_MS });
			return;
		}
		setArmed(0);
		toast.dismiss(`stop:${issue.id}`);
		void act(button.call);
	};
	// 키보드로 초점이 간 카드에서만 주 단추에 테두리를 켠다. 「Ctrl+Enter 가 이 단추를 누른다」는 표시다.
	// 글자 줄을 끼우면 카드 높이가 바뀌어 아래 카드가 밀리므로 자리를 차지하지 않는 ring(box-shadow)만 쓴다. 마우스로 누를 때는 :focus-visible 이 아니라 켜지지 않는다.
	const cue = "group-focus-visible:ring-2 group-focus-visible:ring-ring";
	const { items, dialogs } = useIssueActions(issue);
	const menu: ActionList = [
		...(bulk ?? []),
		"sep",
		{ label: "열기", icon: <PanelRight />, onSelect: open },
		primaryItem(primary, (fn) => void act(fn), busy),
		"sep",
		{ label: "번호 복사", icon: <Hash />, onSelect: () => void copy(`#${issue.number}`, "번호") },
		{ label: "제목 복사", icon: <Copy />, onSelect: () => void copy(issue.title || "제목 없는 메모", "제목") },
		"sep",
		...items,
	];

	const card = (
		<div
			role="button"
			tabIndex={tabbable ? 0 : -1}
			data-issue-id={issue.id}
			aria-selected={onPick ? selected : undefined}
			onMouseDown={(e) => {
				// Shift 클릭으로 범위를 고를 때 카드 사이 글자가 끌려 선택되지 않게 한다.
				if (onPick && e.shiftKey) e.preventDefault();
			}}
			onClick={(e) => {
				if (onPick && (e.ctrlKey || e.metaKey || e.shiftKey)) onPick(e);
				else open();
			}}
			onKeyDown={(e) => {
				// 카드 안 단추에서 누른 키는 그 단추의 것이다.
				if (e.target !== e.currentTarget || e.nativeEvent.isComposing || e.altKey) return;
				const mod = e.ctrlKey || e.metaKey;
				if (e.key === "Enter") {
					// Ctrl+Enter 는 단추가 없어도 카드를 열지 않는다 — 단추를 누르려던 키로 창이 열리면 헷갈린다.
					e.preventDefault();
					if (!mod) open();
					else if (!e.shiftKey && !e.repeat) pressKey();
					return;
				}
				// 한글 입력 상태에서도 되도록 글자(e.key)가 아니라 자판 자리(e.code)로 본다.
				if (e.code === "KeyC" && !mod && !e.shiftKey && !e.repeat) {
					e.preventDefault();
					void copy(`#${issue.number}`, "번호");
				}
			}}
			className={cn(
				"surface group flex flex-col gap-1.5 rounded-xl p-3 text-left transition-[border-color,background-color] outline-none hover:border-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-ring",
				issue.status === "dropped" && "opacity-60",
				issue.error && !issue.run && "border-danger/30",
				// 결정할 차례인 카드만 노랗게 띄운다. 보드에서 사용자가 먼저 봐야 할 것은 이 카드들이다.
				decide && "border-brand/90 hover:border-brand",
				// 고른 카드는 무채색으로 띄운다. 노랑 · 빨강은 결정할 것 · 실패만 뜻한다.
				selected && "border-foreground/70 bg-secondary shadow-[inset_0_0_0_1px_var(--foreground)] hover:border-foreground/70",
			)}
		>
			<div className="flex items-center gap-2 text-[11.5px] text-subtle">
				{selected && <Check aria-hidden className="-mr-1 size-3 text-foreground" />}
				<span className="mono tabular">#{issue.number}</span>
				<span>{relTime(issue.updatedAt)}</span>
				{/* 앞선 메모로 가는 꼬리표. 누르면 이 카드가 아니라 그 메모를 연다. 높이가 바뀌지 않게 머리 줄 안에만 둔다. */}
				{issue.follows && (
					<button
						type="button"
						tabIndex={-1}
						title={`#${issue.follows.number} ${issue.follows.title} 에서 이어짐`}
						onClick={(e) => {
							e.stopPropagation();
							onOpen?.();
							openIssue(issue.follows!.id);
						}}
						className="flex items-center gap-0.5 rounded-sm hover:text-foreground"
					>
						<CornerDownRight className="size-3" />
						<span className="mono tabular">#{issue.follows.number}</span>
					</button>
				)}
				{followCount > 0 && <span title={`이 메모에서 이어진 후속 메모 ${followCount}개`}>후속 {followCount}</span>}
				<div className="flex-1" />
				{issue.attachments.length > 0 && (
					<span className="flex items-center gap-0.5" title={`첨부 ${issue.attachments.length}개`}>
						<Paperclip className="size-3" />
						<span className="tabular">{issue.attachments.length}</span>
					</span>
				)}
			</div>
			<div className="line-clamp-2 text-[14px] leading-snug font-medium break-keep text-foreground">
				<Marked text={issue.title || "제목 없는 메모"} words={words} />
			</div>
			{hit?.where ? (
				<p className="line-clamp-2 text-[12.5px] leading-relaxed break-keep text-muted-foreground">
					<span className="mr-1.5 text-[11.5px] font-medium text-subtle">{hit.where}</span>
					<Marked text={plain(hit.snippet ?? "")} words={words} />
				</p>
			) : (
				secondary && <p className="line-clamp-2 text-[12.5px] leading-relaxed break-keep text-muted-foreground">{plain(secondary)}</p>
			)}

			{/* 완료 칸의 카드에는 상태 줄을 두지 않는다. 칸 이름이 이미 「완료」다. */}
			<div className={cn("mt-1 flex min-h-6 items-center gap-2", issue.status === "done" && !issue.error && "hidden")}>
				{issue.run ? (
					<>
						<Chip tone={state?.tone}>{state?.label}</Chip>
						{/* 줄 서 있으면 무엇을 기다리는지 보인다. 파일이 겹친 상대를 알아야 어느 쪽을 먼저 끝낼지 고른다. */}
						{(issue.run.phase === "running" ? activity : issue.run.waitFor) ? (
							<span className="min-w-0 flex-1 truncate text-[12px] text-subtle">{issue.run.phase === "running" ? activity : issue.run.waitFor}</span>
						) : (
							<div className="flex-1" />
						)}
						{/* 카드를 열지 않고 멈춘다. 줄 서 있는 작업은 줄에서 빠진다. */}
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label="중지"
							title={issue.run.phase === "queued" ? "줄에서 빼기" : "중지"}
							disabled={busy}
							tabIndex={-1}
							className={cn(
								"shrink-0 text-subtle hover:text-danger group-focus-visible:ring-2 group-focus-visible:ring-danger/50",
								// 한 번 눌러 두 번째를 기다리는 동안은 빨갛게 — 한 번 더 누르면 멈춘다는 표시다.
								armed > 0 && "text-danger group-focus-visible:ring-danger",
							)}
							onClick={press}
						>
							<Square className="size-2.5 fill-current" />
						</Button>
					</>
				) : issue.error ? (
					<>
						<Chip tone="danger">실패</Chip>
						<span className="min-w-0 flex-1 truncate text-[12px] text-danger/90">{issue.error.split("\n")[0]}</span>
					</>
				) : issue.status === "planned" ? (
					<>
						<Chip tone="brand">승인 대기</Chip>
						{questions > 0 ? (
							<span className="text-[12px] text-brand-text">확인할 것 {questions}</span>
						) : (
							issue.plan && issue.plan.files.length > 0 && <span className="min-w-0 truncate text-[12px] text-subtle">파일 {issue.plan.files.length}개</span>
						)}
						<div className="flex-1" />
						{button && (
							<Button size="xs" disabled={busy} tabIndex={-1} className={cue} onClick={press}>
								승인하고 구현
							</Button>
						)}
					</>
				) : issue.status === "review" ? (
					<>
						<Chip tone="brand">결과 확인</Chip>
						{t.files > 0 && (
							<span className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[12px] whitespace-nowrap text-subtle">
								파일 {t.files}개 <Diffstat added={t.added} removed={t.removed} />
							</span>
						)}
						<div className="flex-1" />
						<Button size="xs" disabled={busy} tabIndex={-1} className={cue} onClick={press}>
							완료
						</Button>
					</>
				) : waitingAuto ? (
					<span className="flex items-center gap-1.5 text-[12px] text-subtle">
						<RunDot className="bg-subtle" />
						{remain > 0 ? `자동 계획 ${remain}초 뒤` : "곧 계획을 시작합니다"}
					</span>
				) : issue.status === "inbox" ? (
					<Button size="xs" variant="secondary" disabled={busy} tabIndex={-1} className={cue} onClick={press}>
						계획 세우기
					</Button>
				) : (
					state && issue.status !== "done" && <Chip tone={state.tone}>{state.label}</Chip>
				)}
			</div>
		</div>
	);

	// 확인 창은 카드 밖에 둔다. 카드 안에 두면 창의 단추를 누른 것이 카드의 onClick 까지 올라가 상세 창이 열린다.
	return (
		<>
			<ContextActions items={menu}>{card}</ContextActions>
			{dialogs}
		</>
	);
}
