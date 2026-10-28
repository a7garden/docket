import { useEffect, useState } from "react";
import { Copy, Hash, PanelRight, Paperclip, Square } from "lucide-react";
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

export function IssueCard({ issue, delaySec, words = [], hit }: { issue: Issue; delaySec: number; words?: string[]; hit?: Hit }) {
	const openIssue = useUi((s) => s.openIssue);
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
	const { items, dialogs } = useIssueActions(issue);
	const menu: ActionList = [
		{ label: "열기", icon: <PanelRight />, onSelect: () => openIssue(issue.id) },
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
			tabIndex={0}
			onClick={() => openIssue(issue.id)}
			onKeyDown={(e) => {
				if (e.key === "Enter") openIssue(issue.id);
			}}
			className={cn(
				"surface group flex flex-col gap-1.5 rounded-xl p-3 text-left transition-[border-color,background-color] outline-none hover:border-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-ring",
				issue.status === "dropped" && "opacity-60",
				issue.error && !issue.run && "border-danger/30",
				// 결정할 차례인 카드만 노랗게 띄운다. 보드에서 사용자가 먼저 봐야 할 것은 이 카드들이다.
				decide && "border-brand/90 hover:border-brand",
			)}
		>
			<div className="flex items-center gap-2 text-[11.5px] text-subtle">
				<span className="mono tabular">#{issue.number}</span>
				<span>{relTime(issue.updatedAt)}</span>
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
						{issue.run.phase === "running" && activity ? <span className="min-w-0 flex-1 truncate text-[12px] text-subtle">{activity}</span> : <div className="flex-1" />}
						{/* 카드를 열지 않고 멈춘다. 줄 서 있는 작업은 줄에서 빠진다. */}
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label="중지"
							title={issue.run.phase === "queued" ? "줄에서 빼기" : "중지"}
							disabled={busy}
							className="shrink-0 text-subtle hover:text-danger"
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
						{questions === 0 && (
							<Button size="xs" disabled={busy} onClick={press}>
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
						<Button size="xs" disabled={busy} onClick={press}>
							완료
						</Button>
					</>
				) : waitingAuto ? (
					<span className="flex items-center gap-1.5 text-[12px] text-subtle">
						<RunDot className="bg-subtle" />
						{remain > 0 ? `자동 계획 ${remain}초 뒤` : "곧 계획을 시작합니다"}
					</span>
				) : issue.status === "inbox" ? (
					<Button size="xs" variant="secondary" disabled={busy} onClick={press}>
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
