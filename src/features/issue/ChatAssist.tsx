import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookMarked, FileText, Hand, MessageCircleQuestion, SquareSlash, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorText } from "@/lib/api";
import { tokens } from "@/lib/format";

const count = (n: number) => tokens({ input: n, output: 0, cacheCreate: 0, cacheRead: 0 });
import { toolLabel } from "@/lib/store";
import { GLOBAL_PID, type Issue, type PendingAsk, type Question, type RunRecord, type SlashItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { type Answers, isAnswered, NO_ANSWERS, Questions } from "./Questions";

/* ---------- 승인 · 되묻기 카드 ---------- */

/** AskUserQuestion 의 입력. CLI 가 넘기는 꼴 그대로다. */
interface AskInput {
	questions?: { question: string; header?: string; multiSelect?: boolean; options?: { label: string; description?: string }[] }[];
}

function questionsOf(ask: PendingAsk): Question[] {
	return ((ask.input as AskInput)?.questions ?? []).map((q) => ({
		header: q.header ?? "",
		question: q.question,
		options: (q.options ?? []).map((o) => ({ label: o.label, description: o.description ?? "", recommended: false })),
		multi: !!q.multiSelect,
	}));
}

/** 고른 답을 AskUserQuestion 의 answers 로 묶는다. 질문 글이 열쇠이고, 여럿 고른 답은 쉼표로 잇는다. */
function answersInput(ask: PendingAsk, qs: Question[], a: Answers) {
	const answers: Record<string, string> = {};
	qs.forEach((q, i) => {
		const ans = a.byQuestion[i];
		if (!isAnswered(ans)) return;
		const picked = ans.picked.map((n) => q.options[n]?.label).filter(Boolean);
		if (ans.other.trim()) picked.push(ans.other.trim());
		answers[q.question] = picked.join(", ");
	});
	return { ...(ask.input as object), answers };
}

/**
 * Claude 가 기다리는 물음을 입력칸 위에 카드로 보인다. 도구 허락이면 허락 · 이 대화 내내 허락 · 거부, 되묻기면 고르기다.
 * 카드가 떠 있는 동안 실행은 멈춰 있다 — 답하거나 중지해야 다음으로 간다.
 */
export function AskCards({ issue }: { issue: Issue }) {
	const asks = issue.run?.asks ?? [];
	if (!asks.length) return null;
	return (
		<div className="flex flex-col gap-2">
			{asks.map((a) => (a.tool === "AskUserQuestion" ? <QuestionCard key={a.requestId} issue={issue} ask={a} /> : <PermissionCard key={a.requestId} issue={issue} ask={a} />))}
		</div>
	);
}

function useAnswer(issue: Issue, ask: PendingAsk) {
	const [busy, setBusy] = useState(false);
	const send = async (allow: boolean, opts: { updatedInput?: unknown; remember?: boolean } = {}) => {
		setBusy(true);
		try {
			await api.issueChatAnswer(issue.projectId, issue.id, ask.requestId, allow, opts);
		} catch (e) {
			toast.error(errorText(e));
			setBusy(false);
		}
	};
	return { busy, send };
}

/** 편집 · 쓰기는 무엇을 고치려는지, 명령은 명령 글 전체를 보인다. 터미널의 허락 창과 같은 정보다. */
function askDetail(ask: PendingAsk) {
	const input = (ask.input ?? {}) as Record<string, unknown>;
	if (typeof input.command === "string") return input.command;
	if (typeof input.old_string === "string" && typeof input.new_string === "string") return `- ${input.old_string}\n+ ${input.new_string}`;
	if (typeof input.content === "string") return input.content;
	if (typeof input.url === "string") return input.url;
	return "";
}

function PermissionCard({ issue, ask }: { issue: Issue; ask: PendingAsk }) {
	const { busy, send } = useAnswer(issue, ask);
	const detail = askDetail(ask);
	const first = useRef<HTMLButtonElement>(null);
	// 카드가 뜨면 허락 단추에 초점을 둔다. 입력칸에서 쓰던 글이 있으면 빼앗지 않는다.
	useEffect(() => {
		const a = document.activeElement as HTMLTextAreaElement | null;
		if (!a || a.tagName !== "TEXTAREA" || !a.value.trim()) first.current?.focus({ preventScroll: true });
	}, []);
	return (
		<section role="alertdialog" aria-label="허락을 묻습니다" className="flex flex-col gap-2 rounded-lg border border-brand/70 bg-card px-3.5 py-3">
			<div className="flex items-center gap-2 text-[13px]">
				<Hand className="size-4 shrink-0 text-brand-text" />
				<span className="font-medium">Claude 가 허락을 묻습니다 · {toolLabel(ask.tool)}</span>
				<span className="mono min-w-0 flex-1 truncate text-[12px] text-subtle" title={ask.summary}>
					{ask.summary}
				</span>
			</div>
			{detail && <pre className="mono max-h-40 overflow-auto rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground selectable">{detail}</pre>}
			<div className="flex flex-wrap items-center gap-1.5">
				<Button ref={first} size="sm" disabled={busy} onClick={() => void send(true)}>
					허락
				</Button>
				{ask.suggest.length > 0 && (
					<Button size="sm" variant="outline" disabled={busy} title={`이 대화에서는 다시 묻지 않습니다: ${ask.suggest.join(", ")}`} onClick={() => void send(true, { remember: true })}>
						이 대화 내내 허락
					</Button>
				)}
				<Button size="sm" variant="ghost" disabled={busy} onClick={() => void send(false)}>
					거부
				</Button>
				{ask.suggest.length > 0 && <span className="mono min-w-0 truncate text-[11.5px] text-subtle">{ask.suggest.join(" · ")}</span>}
			</div>
		</section>
	);
}

function QuestionCard({ issue, ask }: { issue: Issue; ask: PendingAsk }) {
	const { busy, send } = useAnswer(issue, ask);
	const qs = useMemo(() => questionsOf(ask), [ask]);
	const [answers, setAnswers] = useState<Answers>(NO_ANSWERS);
	const done = qs.filter((_, i) => isAnswered(answers.byQuestion[i])).length;
	return (
		<div className="flex flex-col gap-2">
			<Questions questions={qs} answers={answers} onChange={setAnswers} noteless />
			<div className="flex items-center gap-1.5">
				<MessageCircleQuestion className="size-4 text-subtle" />
				<span className="flex-1 text-[12px] text-subtle">답하지 않은 질문은 Claude 의 판단에 맡깁니다</span>
				<Button size="sm" variant="ghost" disabled={busy} onClick={() => void send(false)}>
					답하지 않기
				</Button>
				<Button size="sm" disabled={busy || done === 0} onClick={() => void send(true, { updatedInput: answersInput(ask, qs, answers) })}>
					답 보내기
				</Button>
			</div>
		</div>
	);
}

/* ---------- 컨텍스트 ---------- */

/** 마지막 대화 차례가 읽은 문맥. 창 크기를 모르면(옛 기록) 20만으로 어림한다. */
export function contextOf(issue: Issue): { used: number; window: number } | null {
	const last = [...issue.runs].reverse().find((r: RunRecord) => r.kind === "chat" && (r.contextTokens ?? 0) > 0);
	if (!last?.contextTokens) return null;
	return { used: last.contextTokens, window: last.contextWindow || 200_000 };
}

/** 「컨텍스트 N%」. 누르면 /compact 로 지난 대화를 줄인다. 70% 를 넘으면 노란색(앱의 주의 색), 90% 를 넘으면 빨간색이다. */
export function ContextMeter({ issue, onCompact, disabled }: { issue: Issue; onCompact: () => void; disabled: boolean }) {
	const c = contextOf(issue);
	if (!c) return null;
	const pct = Math.min(100, Math.round((c.used / c.window) * 100));
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onCompact}
			title={`컨텍스트 ${count(c.used)} / ${count(c.window)} — 누르면 /compact 로 지난 대화를 요약해 줄입니다`}
			className={cn(
				"tabular shrink-0 rounded px-1.5 text-[12px] transition-colors hover:bg-hover disabled:pointer-events-none",
				pct >= 90 ? "text-danger" : pct >= 70 ? "text-brand-text" : "text-subtle",
			)}
		>
			컨텍스트 {pct}%
		</button>
	);
}

/* ---------- / · @ 자동완성 ---------- */

interface Suggest {
	kind: "slash" | "file";
	start: number;
	end: number;
	query: string;
}

interface Item {
	value: string;
	label: string;
	hint: string;
	icon: "app" | "cli" | "skill" | "command" | "file";
}

/** 글자 앞부분으로 무엇을 고르는 중인지 본다. `/` 는 글 맨 앞에서만(그래야 명령으로 읽힌다), `@` 는 낱말 첫머리에서다. */
function detect(text: string, caret: number): Suggest | null {
	const before = text.slice(0, caret);
	const slash = /^\/([^\s/]*)$/.exec(before);
	if (slash) return { kind: "slash", start: 0, end: caret, query: slash[1] };
	const at = /(^|\s)@([^\s]*)$/.exec(before);
	if (at) return { kind: "file", start: caret - at[2].length - 1, end: caret, query: at[2] };
	return null;
}

const ICON = {
	app: SquareTerminal,
	cli: SquareSlash,
	skill: BookMarked,
	command: SquareSlash,
	file: FileText,
} as const;

/**
 * 입력칸 자동완성. `/` 로 슬래시 명령 · 스킬을, `@` 로 프로젝트 파일을 고른다.
 * 열려 있는 동안 ↑ ↓ 는 고르기, Enter · Tab 은 넣기, Esc 는 닫기다. onKeyDown 이 true 를 돌려주면 입력칸은 그 키를 쓰지 않는다.
 */
export function useAssist(issue: Issue, text: string, setText: (t: string, caret: number) => void) {
	const [caret, setCaret] = useState(0);
	const [active, setActive] = useState(0);
	const [dismissed, setDismissed] = useState<string | null>(null);
	const s = detect(text, caret);
	const key = s ? `${s.kind}:${s.start}` : null;
	const open = !!s && key !== dismissed;
	const files = issue.projectId !== GLOBAL_PID;

	const slash = useQuery({ queryKey: ["slash", issue.projectId], queryFn: () => api.slashCommands(issue.projectId), enabled: open && s?.kind === "slash", staleTime: 60_000 });
	const found = useQuery({
		queryKey: ["files", issue.projectId, s?.kind === "file" ? s.query : ""],
		queryFn: () => api.projectFiles(issue.projectId, s?.query ?? ""),
		enabled: open && s?.kind === "file" && files,
		staleTime: 30_000,
		placeholderData: (prev) => prev,
	});

	const items: Item[] = useMemo(() => {
		if (!s || !open) return [];
		if (s.kind === "file") return (found.data ?? []).map((f) => ({ value: f, label: f, hint: "", icon: "file" as const }));
		const q = s.query.toLowerCase();
		const list = (slash.data ?? []) as SlashItem[];
		return list
			.filter((x) => x.name.toLowerCase().includes(q))
			.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
			.slice(0, 40)
			.map((x) => ({ value: x.name, label: `/${x.name}`, hint: x.description, icon: x.source }));
	}, [s?.kind, s?.query, open, found.data, slash.data]);

	useEffect(() => setActive(0), [key, s?.query]);

	const apply = (it: Item) => {
		if (!s) return;
		const insert = s.kind === "slash" ? `/${it.value} ` : `@${it.value} `;
		const next = text.slice(0, s.start) + insert + text.slice(s.end);
		setText(next, s.start + insert.length);
		setCaret(s.start + insert.length);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
		if (!open || !items.length || e.nativeEvent.isComposing) {
			if (open && e.key === "Escape") {
				setDismissed(key);
				return true;
			}
			return false;
		}
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			setActive((a) => (a + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
			return true;
		}
		if ((e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) || e.key === "Tab") {
			e.preventDefault();
			apply(items[Math.min(active, items.length - 1)]);
			return true;
		}
		if (e.key === "Escape") {
			setDismissed(key);
			return true;
		}
		return false;
	};

	const track = (el: HTMLTextAreaElement) => setCaret(el.selectionStart ?? el.value.length);

	const popup =
		open && items.length > 0 ? (
			<div role="listbox" aria-label={s?.kind === "slash" ? "슬래시 명령" : "파일"} className="pop absolute right-0 bottom-full left-0 z-20 mb-1.5 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
				{items.map((it, i) => {
					const Icon = ICON[it.icon];
					return (
						<button
							key={it.value}
							type="button"
							role="option"
							aria-selected={i === active}
							// 누르는 동안 입력칸이 초점을 잃지 않게 한다.
							onMouseDown={(e) => e.preventDefault()}
							onMouseEnter={() => setActive(i)}
							onClick={() => apply(it)}
							className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]", i === active && "bg-hover")}
						>
							<Icon className="size-3.5 shrink-0 text-subtle" />
							<span className={cn("shrink-0 text-foreground", it.icon === "file" ? "mono min-w-0 truncate" : "font-medium")}>{it.label}</span>
							{it.hint && <span className="min-w-0 flex-1 truncate text-subtle">{it.hint}</span>}
							{it.icon === "app" && <span className="shrink-0 text-[11px] text-subtle">앱</span>}
							{it.icon === "skill" && <span className="shrink-0 text-[11px] text-subtle">스킬</span>}
						</button>
					);
				})}
			</div>
		) : null;

	return { open: open && items.length > 0, onKeyDown, track, popup };
}
