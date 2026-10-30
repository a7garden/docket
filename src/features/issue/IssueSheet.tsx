import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, CornerDownRight, MoreHorizontal, RotateCcw, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { DropdownActions, useActionCommands } from "@/components/ActionMenu";
import { Chip } from "@/components/bits";
import { KeyTip } from "@/components/KeyTip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSheetBesideDock } from "@/features/talk/DockPane";
import { api, errorText } from "@/lib/api";
import { clock, relTime } from "@/lib/format";
import { inTyping, keyAnchor, useKey } from "@/lib/keys";
import { lastEnded, useMarkSeen } from "@/lib/notices";
import { useIssues, useProjects } from "@/lib/queries";
import { stateOf } from "@/lib/status";
import { useLive, useUi } from "@/lib/store";
import type { Issue, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useBoardNeighbor } from "../board/boardFocus";
import { totals } from "../board/IssueCard";
import { ChangesTab } from "./ChangesTab";
import { runChatMode } from "@/lib/chatMode";
import { ChatComposer, ChatTab, type Draft, NO_DRAFT, SessionBar, useSendKey, useTranscript } from "./ChatTab";
import { HistoryTab } from "./HistoryTab";
import { RevertConfirm, useIssueActions } from "./issueActions";
import { NoteTab } from "./NoteTab";
import { PlanTab } from "./PlanTab";
import { type Answers, NO_ANSWERS, answeredCount, answersText } from "./Questions";

type Tab = "note" | "plan" | "changes" | "chat" | "history";

/** 화면에 놓인 탭 순서. Alt 1–5 가 이 순서를 따른다. Ctrl 숫자는 프로젝트 화면 전환이 쓴다. */
const TABS: [Tab, string][] = [
	["note", "메모"],
	["chat", "대화"],
	["plan", "계획"],
	["changes", "변경"],
	["history", "기록"],
];

function tabFor(i: Issue): Tab {
	if (i.run?.kind === "chat") return "chat";
	if (i.run) return i.run.kind === "plan" && !i.plan ? "plan" : i.run.kind === "implement" ? "changes" : "history";
	if (i.status === "planned") return "plan";
	if (i.status === "review" || (i.status === "done" && i.result)) return "changes";
	return "note";
}

export function IssueSheet({ project }: { project: Project }) {
	const issueId = useUi((s) => s.issueId);
	const openIssue = useUi((s) => s.openIssue);
	const { data: issues } = useIssues(project.id);
	const issue = issues?.find((i) => i.id === issueId);
	// 열어 본 이슈의 계획 · 결과 · 답은 알림함에서 뺀다.
	useMarkSeen(issue?.id, issue ? lastEnded(issue.runs) : 0);
	const beside = useSheetBesideDock();

	return (
		<Sheet open={!!issue} onOpenChange={(o) => !o && openIssue(null)} modal={beside.modal}>
			<SheetContent
				side="right"
				data-region="sheet"
				showCloseButton={false}
				onInteractOutside={beside.onInteractOutside}
				// 열리자마자 첫 단추(더 보기)에 초점 테두리가 생기면 부차적인 메뉴가 가장 먼저 눈에 띈다. 창 자체에 초점을 둔다.
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					(e.currentTarget as HTMLElement | null)?.focus();
				}}
				// 입력칸 · 편집기 안의 Esc 는 칸에서 빠져나오기만 한다. 글을 쓰다 Esc 한 번에 창이 닫히면 보던 자리를 잃는다.
				// 초점은 한 박자 뒤에 옮긴다. Radix 는 이 키를 칸보다 먼저 받는데, 여기서 바로 blur 하면 제목 칸의 Esc(취소)보다 onBlur(저장)가 먼저 돈다.
				onEscapeKeyDown={(e) => {
					const from = document.activeElement as HTMLElement | null;
					if (!inTyping(from)) return;
					e.preventDefault();
					const sheet = from?.closest<HTMLElement>('[role="dialog"]');
					setTimeout(() => {
						const now = document.activeElement as HTMLElement | null;
						if (now && inTyping(now)) now.blur();
						sheet?.focus();
					});
				}}
				// 옆 칸 대화를 띄웠으면 그 칸을 비켜 본문 칸 안에서 열린다(--dock-right · --dock-w 는 DockPane 이 정한다).
				className="pop gap-0 overflow-hidden rounded-none p-0 outline-none data-[side=right]:top-9 data-[side=right]:right-[var(--dock-right,0px)] data-[side=right]:bottom-0 data-[side=right]:h-auto data-[side=right]:w-[min(860px,calc((100vw_-_var(--dock-w,0px))*0.64))] data-[side=right]:border-y-0 data-[side=right]:border-r-0 data-[side=right]:sm:max-w-none"
			>
				{issue && <IssueDetail key={issue.id} issue={issue} projectPath={project.path} onClose={() => openIssue(null)} />}
			</SheetContent>
		</Sheet>
	);
}

const TITLE_CLASS = "text-[19px] leading-snug font-semibold tracking-[-0.02em] break-keep";

/** 누르면 입력칸이 된다. 고친 제목은 메모를 바꿔도 남고, 비우면 다시 Claude 가 짓는다. */
function IssueTitle({ issue }: { issue: Issue }) {
	const [edit, setEdit] = useState<string | null>(null);
	const cancelled = useRef(false);
	const naming = issue.titleMode === "auto" && issue.titledAt < issue.noteUpdatedAt;

	const save = async () => {
		if (edit === null) return;
		const next = edit.trim();
		setEdit(null);
		if (cancelled.current || next === issue.title) return;
		try {
			await api.issueSetTitle(issue.projectId, issue.id, next);
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	if (edit !== null) {
		return (
			<>
				<SheetTitle className="sr-only">{issue.title || "제목 없는 메모"}</SheetTitle>
				<Input
					autoFocus
					value={edit}
					onChange={(e) => setEdit(e.target.value)}
					onBlur={() => void save()}
					onKeyDown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur();
						if (e.key === "Escape") {
							cancelled.current = true;
							setEdit(null);
						}
					}}
					placeholder="비우면 Claude 가 다시 짓습니다"
					aria-label="제목"
					className={cn("h-auto px-2 py-1 md:text-[19px]", TITLE_CLASS)}
				/>
			</>
		);
	}
	return (
		<SheetTitle className={TITLE_CLASS}>
			<button
				type="button"
				title="눌러서 제목 고치기"
				onClick={() => {
					cancelled.current = false;
					setEdit(issue.title);
				}}
				className="rounded-sm text-left hover:text-muted-foreground"
			>
				{issue.title || "제목 없는 메모"}
			</button>
			{naming && <span className="ml-2 align-middle text-[12px] font-normal tracking-normal text-subtle">제목 짓는 중</span>}
		</SheetTitle>
	);
}

function IssueDetail({ issue, projectPath, onClose }: { issue: Issue; projectPath: string; onClose: () => void }) {
	const [tab, setTab] = useState<Tab>(() => tabFor(issue));
	// 단계가 넘어가면 그 단계에서 볼 탭으로 옮긴다. 계획이 나오면 계획 탭, 구현이 끝나면 변경 탭.
	// 대화로 설계가 정해지거나 파일을 고쳐 단계가 넘어가도, 대화하던 사람을 대화 탭에서 끌어내지 않는다.
	useEffect(() => {
		setTab((cur) => (cur === "chat" && issue.run?.kind !== "plan" && issue.run?.kind !== "implement" ? cur : tabFor(issue)));
	}, [issue.status, issue.run?.kind, !!issue.run]); // eslint-disable-line react-hooks/exhaustive-deps
	const [draft, setDraft] = useState<Draft>(NO_DRAFT);
	useTranscript(issue);
	const state = stateOf(issue);
	const chats = issue.runs.filter((r) => r.kind === "chat").length;
	const t = totals(issue);
	// 질문에 단 답은 탭을 오가도 남아야 하고, 계획이 새로 나오면 버린다. 질문 번호가 새 계획과 맞지 않는다.
	const [answers, setAnswers] = useState<Answers>(NO_ANSWERS);
	useEffect(() => setAnswers(NO_ANSWERS), [issue.plan?.runId]);
	for (const [i, [v, label]] of TABS.entries()) {
		// 목록이 고정이라 훅 순서가 바뀌지 않는다. 숫자 패드의 Alt 조합은 Windows 의 Alt 코드 입력이라 숫자 줄만 받는다.
		useKey({ id: `issue.tab.${v}`, combo: `Alt+${i + 1}`, code: `Digit${i + 1}`, label, group: "상세 창", series: "issue.tab", run: () => setTab(v) });
	}
	const count: Partial<Record<Tab, number>> = { chat: chats, changes: t.files };
	const flow = useIssueFlow(issue, answers, tab, setTab);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex flex-col gap-2 px-6 pt-5 pb-3">
				<div className="flex items-center gap-2 text-[12px] text-subtle">
					<span className="mono tabular">#{issue.number}</span>
					{state && <Chip tone={state.tone}>{state.label}</Chip>}
					<span title={clock(issue.updatedAt)}>{relTime(issue.updatedAt)}</span>
					<div className="flex-1" />
					<IssueNav issue={issue} />
					<IssueMenu issue={issue} />
					<Button size="icon-sm" variant="ghost" aria-label="닫기" onClick={onClose}>
						<X />
					</Button>
				</div>
				<IssueTitle issue={issue} />
				<IssueLinks issue={issue} />
				<SheetDescription className="sr-only">이슈 상세</SheetDescription>
			</header>

			<Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 flex-1 gap-0">
				<div className="border-b border-border px-6">
					{/* 대화로도 설계하고 고친다. 단계 탭들 사이에 묻히지 않게 메모 바로 뒤에 둔다(TABS 순서). */}
					<TabsList variant="line" className="h-9 gap-4 p-0">
						{TABS.map(([v, label]) => (
							<KeyTip key={v} id={`issue.tab.${v}`}>
								{/* 툴팁 트리거가 data-state(열림 · 닫힘)를 덮어 써 탭의 선택 표시가 사라지지 않게 탭 것을 직접 준다. */}
								<TabsTrigger value={v} data-state={tab === v ? "active" : "inactive"} className="px-0" {...keyAnchor(`issue.tab.${v}`)}>
									{label}
									{!!count[v] && <span className="tabular text-subtle">{count[v]}</span>}
								</TabsTrigger>
							</KeyTip>
						))}
					</TabsList>
				</div>
				{/* 스크롤 칸 안에 두면 대화가 길어질수록 맨 위까지 올려야 닿는다. 밖에 두어 늘 보이게 한다. */}
				{tab === "chat" && <SessionBar issue={issue} projectPath={projectPath} />}
				<div data-scroll className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					<TabsContent value="note">
						<NoteTab issue={issue} />
					</TabsContent>
					<TabsContent value="plan">
						<PlanTab issue={issue} projectPath={projectPath} answers={answers} onAnswers={setAnswers} />
					</TabsContent>
					<TabsContent value="changes">
						<ChangesTab issue={issue} projectPath={projectPath} />
					</TabsContent>
					<TabsContent value="chat">
						<ChatTab issue={issue} projectPath={projectPath} />
					</TabsContent>
					<TabsContent value="history">
						<HistoryTab issue={issue} />
					</TabsContent>
				</div>
			</Tabs>

			<ErrorBar issue={issue} />
			{tab === "chat" ? <ChatComposer issue={issue} draft={draft} onDraft={setDraft} /> : <ActionBar issue={issue} flow={flow} />}
		</div>
	);
}

async function run(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (e) {
		toast.error(errorText(e));
	}
}

/** 실패한 실행을 같은 요청으로 다시 보낸다. 다시 계획 · 수정 요청이었다면 그때 적은 글을 그대로 쓴다. */
function retry(issue: Issue) {
	const last = [...issue.history].reverse().find((h) => ["plan", "replan", "approve", "rework", "chat", "revert"].includes(h.kind));
	const { projectId: p, id } = issue;
	switch (last?.kind) {
		// 흐름에는 앞 300자만 남는다. 긴 질문이었다면 대화 탭의 원문을 다시 보낸다. 권한은 그 차례의 모드를 그대로 쓴다.
		case "chat": {
			const prev = [...issue.runs].reverse().find((r) => r.kind === "chat");
			return api.issueChat(p, id, prev?.prompt || last.text, prev ? runChatMode(prev) : "auto");
		}
		case "replan":
			return api.issuePlan(p, id, last.text);
		case "approve":
			return issue.status === "review" ? api.issueRework(p, id, "지난 구현이 중간에 끊겼다. 계획에서 남은 부분을 마저 구현하라.") : api.issueApprove(p, id, last.text);
		case "rework":
			return api.issueRework(p, id, last.text);
		case "revert":
			return api.issueRevert(p, id);
		default:
			return api.issuePlan(p, id);
	}
}

function ErrorBar({ issue }: { issue: Issue }) {
	if (!issue.error || issue.run) return null;
	return (
		<div className="mx-6 mb-3 flex gap-3 rounded-lg border border-danger/30 bg-danger/8 px-3.5 py-2.5">
			<div className="min-w-0 flex-1">
				<div className="text-[13px] font-semibold text-danger">실패</div>
				<pre className="mt-1 max-h-28 overflow-y-auto font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-danger/90 selectable">{issue.error}</pre>
			</div>
			<div className="flex shrink-0 flex-col gap-1.5">
				<Button size="sm" variant="outline" onClick={() => void run(() => retry(issue))}>
					다시 시도
				</Button>
				<Button size="sm" variant="ghost" onClick={() => void run(() => api.issueClearError(issue.projectId, issue.id))}>
					닫기
				</Button>
			</div>
		</div>
	);
}

type Ask = { kind: "replan" | "rework" | "follow"; text: string } | null;

const ASK_TEXT = {
	replan: { placeholder: "계획에서 바꿀 것이나 Claude 가 물은 것에 대한 답", send: "다시 계획" },
	rework: { placeholder: "구현 결과에서 고칠 것", send: "수정 요청" },
	follow: { placeholder: "이 메모에서 이어서 할 일. 새 메모로 보드에 올라가고, 계획할 때 이 메모의 요약을 함께 넘깁니다", send: "후속 메모 만들기" },
};

/** 후속 메모 입력칸의 처음 글. 구현 결과의 「이어서 할 일」을 목록으로 넣어 둔다 — 지우거나 고쳐서 보내면 된다. */
function followDraft(issue: Issue) {
	const items = issue.result?.followups ?? [];
	return items.map((f) => `- ${f}`).join("\n");
}

/** 「후속 메모」 단추. 결과 확인 · 완료 · 보류 칸에 둔다 — 그 전 단계는 이 메모를 고치면 된다. */
function FollowButton({ issue, disabled, onAsk }: { issue: Issue; disabled: boolean; onAsk: (a: Ask) => void }) {
	return (
		<Button variant="outline" disabled={disabled} title="이 메모에서 이어지는 새 메모를 만듭니다. 이 메모는 그대로 둡니다." {...keyAnchor("issue.follow")} onClick={() => onAsk({ kind: "follow", text: followDraft(issue) })}>
			<CornerDownRight />
			후속 메모
		</Button>
	);
}

/**
 * 앞선 메모와 후속 메모를 잇는 줄. 연결은 후속 메모 쪽(follows)에만 있어 후속 메모는 목록에서 거꾸로 찾는다.
 * 제목 · 상태는 목록의 지금 값을 쓴다. 앞선 메모를 지웠으면 만들 때 찍어 둔 제목을 흐리게 보인다.
 */
function IssueLinks({ issue }: { issue: Issue }) {
	const { data: issues } = useIssues(issue.projectId);
	const openIssue = useUi((s) => s.openIssue);
	const prior = issue.follows ? issues?.find((i) => i.id === issue.follows?.id) : undefined;
	const next = (issues ?? []).filter((i) => i.follows?.id === issue.id).sort((a, b) => a.number - b.number);
	// 갈 곳이 없어도 키는 받는다. 넘기면 Alt ← 가 웹뷰의 뒤로 가기가 된다.
	useKey({ id: "issue.prior", combo: "Alt+ArrowLeft", label: "앞선 메모", group: "상세 창", series: "issue.link", inInput: "skip", run: () => prior && openKeeping(prior.id) });
	useKey({ id: "issue.follower", combo: "Alt+ArrowRight", label: "후속 메모로 가기", group: "상세 창", series: "issue.link", inInput: "skip", run: () => next[0] && openKeeping(next[0].id) });
	if (!issue.follows && next.length === 0) return null;
	const link = "rounded-sm text-subtle hover:text-foreground";
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-subtle">
			{issue.follows &&
				(prior ? (
					<button type="button" className={cn("flex items-center gap-1", link)} title={`#${prior.number} ${prior.title} 열기`} onClick={() => openIssue(prior.id)}>
						<CornerDownRight className="size-3.5" />#{prior.number} 에서 이어짐
					</button>
				) : (
					<span className="flex items-center gap-1 opacity-60" title="지운 메모입니다">
						<CornerDownRight className="size-3.5" />#{issue.follows.number} {issue.follows.title} 에서 이어짐
					</span>
				))}
			{next.length > 0 && (
				<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
					후속
					{next.map((n) => (
						<button key={n.id} type="button" className={cn("flex items-center gap-1", link)} title={`#${n.number} ${n.title} 열기`} onClick={() => openIssue(n.id)}>
							<span className="mono tabular">#{n.number}</span>
							<span>{stateOf(n)?.label ?? "메모"}</span>
						</button>
					))}
				</span>
			)}
		</div>
	);
}

/**
 * 아래 칸의 상태와 동작, 그 키. 아래 칸은 대화 탭에서 그려지지 않아 거기 두면 대화 탭에서 키가 듣지 않으므로 상세 창에 둔다.
 * 입력칸을 여는 키는 대화 탭에서 눌러도 아래 칸이 보이는 탭으로 옮긴다. 실행을 시작 · 끝내는 키는 두 번 눌러야 하고, 이슈 동작 키는 글을 쓰는 중에는 받지 않는다.
 */
function useIssueFlow(issue: Issue, answers: Answers, tab: Tab, setTab: (t: Tab) => void) {
	const [ask, setAsk] = useState<Ask>(null);
	const [busy, setBusy] = useState(false);
	const [once, setOnce] = useState(false);
	const { projectId: p, id } = issue;
	const questions = issue.plan?.questions ?? [];
	const answered = answeredCount(questions, answers);

	const go = async (fn: () => Promise<unknown>) => {
		setBusy(true);
		await run(fn);
		setBusy(false);
	};
	const send = () => {
		if (!ask || !ask.text.trim()) return;
		const text = ask.text;
		void go(async () => {
			if (ask.kind === "follow") {
				// 이 창에 머문다. 새 메모는 머리의 연결 줄에 바로 생기고, 알림에서 열 수 있다.
				const v = await api.issueFollowUp(p, id, text);
				toast(`후속 메모 #${v.number} 를 만들었습니다`, { action: { label: "열기", onClick: () => useUi.getState().openIssue(v.id) } });
			} else await (ask.kind === "replan" ? api.issuePlan(p, id, text) : api.issueRework(p, id, text, once));
			setAsk(null);
		});
	};

	// 답이 없으면 「묻지 말고 승인」이다. 단추로는 누를 수 있어도 단축키로는 부르지 않는다 — 키 한 번에 구현이 시작되면 안 된다.
	const implementWithAnswers = () => void go(() => (answered ? api.issueApprove(p, id, answersText(questions, answers), once) : api.issueApprove(p, id, undefined, once)));
	const replanWithAnswers = () => void go(() => api.issuePlan(p, id, answersText(questions, answers)));

	// 계획의 질문에 답한 뒤 Ctrl+Enter 는 다시 계획, Ctrl+Shift+Enter 는 답대로 구현이다.
	// 질문 칸에서 맨 Enter 는 이미 「다음 질문」이라 보내기 키 설정과 상관없이 Ctrl 조합으로 둔다.
	// 대화 탭에서는 켜지 않는다. 그 탭의 Ctrl+Enter 는 대화 보내기다.
	const hotkeys = !issue.run && !ask && tab !== "chat" && issue.status === "planned" && questions.length > 0;
	const answerKey = (e: KeyboardEvent) => {
		if (e.repeat || e.defaultPrevented) return false;
		// 메모 편집기 · 제목 칸에서 누른 키는 그 칸의 것이다. 메모를 고치다 계획이 돌면 안 된다.
		const t = e.target as HTMLElement | null;
		if (t?.closest(".cm-editor, input")) return false;
		return !busy && answered > 0;
	};
	useKey({
		id: "issue.replan",
		combo: "Mod+Enter",
		label: "답하고 다시 계획",
		group: "상세 창",
		enabled: hotkeys,
		run: (e) => answerKey(e) && (replanWithAnswers(), true),
	});
	useKey({
		id: "issue.implement",
		combo: "Mod+Shift+Enter",
		label: "답대로 구현",
		group: "상세 창",
		enabled: hotkeys,
		run: (e) => answerKey(e) && (implementWithAnswers(), true),
	});

	const idle = !issue.run && !ask;
	const opening = (a: Ask) => {
		if (tab === "chat") setTab(tabFor(issue));
		setAsk(a);
	};
	const noQuestions = questions.length === 0;
	const canRework = idle && (issue.status === "review" || (issue.status === "planned" && noQuestions));
	const action = { group: "상세 창", inInput: "skip", command: true, disabled: busy } as const;
	useKey({
		...action,
		id: "issue.follow",
		combo: "Alt+F",
		label: "후속 메모 쓰기",
		enabled: idle && (issue.status === "review" || issue.status === "done" || issue.status === "dropped"),
		run: () => opening({ kind: "follow", text: followDraft(issue) }),
	});
	useKey({
		...action,
		id: "issue.ask",
		combo: "Alt+R",
		label: issue.status === "review" ? "수정 요청" : "다시 계획",
		enabled: canRework,
		run: () => opening({ kind: issue.status === "review" ? "rework" : "replan", text: "" }),
	});
	useKey({
		...action,
		id: "issue.plan",
		combo: "Alt+P",
		label: "계획 세우기",
		enabled: idle && issue.status === "inbox" && !!issue.note.trim(),
		run: (e) => void (e.repeat || go(() => api.issuePlan(p, id))),
	});
	// 답하지 않은 질문이 남았으면 받지 않는다. 「묻지 말고 승인」은 단추로만 누른다.
	useKey({
		...action,
		id: "issue.approve",
		combo: "Alt+A",
		label: noQuestions ? "승인하고 구현" : "답대로 구현",
		enabled: idle && issue.status === "planned" && (noQuestions || answered > 0),
		confirm: { key: id, text: "구현을 시작합니다" },
		run: implementWithAnswers,
	});
	useKey({
		...action,
		id: "issue.finish",
		combo: "Alt+D",
		label: issue.worktree ? "반영" : "완료",
		enabled: idle && issue.status === "review",
		confirm: { key: id, text: issue.worktree ? "본 작업트리에 반영합니다" : "완료합니다" },
		run: () => void go(() => (issue.worktree ? api.issueMerge(p, id) : api.issueComplete(p, id))),
	});
	useKey({
		...action,
		id: "issue.stop",
		combo: "Alt+S",
		label: issue.run?.phase === "queued" ? "줄에서 빼기" : "중지",
		enabled: !!issue.run,
		confirm: { key: id, text: issue.run?.phase === "queued" ? "줄에서 뺍니다" : "중지합니다" },
		run: () => void go(() => api.issueStop(p, id)),
	});

	return { ask, setAsk, busy, go, send, once, setOnce, implementWithAnswers, replanWithAnswers, questions, answered };
}

function ActionBar({ issue, flow }: { issue: Issue; flow: ReturnType<typeof useIssueFlow> }) {
	const { ask, setAsk, busy, go, send, once, setOnce, implementWithAnswers, replanWithAnswers, questions, answered } = flow;
	const activity = useLive((s) => (issue.run ? s.byTarget[issue.id]?.activity : undefined));
	const { projectId: p, id } = issue;
	// 프로젝트가 「편집 · 허용 목록」일 때만 고른다. 「모두 허용」 프로젝트에서는 늘 모두 허용이다.
	const { data: projects } = useProjects();
	const limited = projects?.find((x) => x.id === p)?.implMode !== "bypassPermissions";
	const allowOnce = limited && (
		<label
			className="flex items-center gap-2 text-[12.5px] text-muted-foreground"
			title="이번 구현만 명령 · 웹 · 스킬을 묻지 않고 허용합니다. 거부 목록은 지킵니다. 프로젝트 설정은 바뀌지 않습니다."
		>
			<Switch size="sm" checked={once} onCheckedChange={setOnce} />
			이번만 모두 허용
		</label>
	);
	const sendKey = useSendKey();

	const bar ="flex items-center gap-2 border-t border-border px-6 py-3.5";

	if (issue.run) {
		return (
			<div className={bar}>
				<span className="min-w-0 flex-1 truncate text-[12.5px] text-subtle">{issue.run.phase === "queued" ? issue.run.waitFor || "앞선 작업을 기다리는 중" : activity}</span>
				<KeyTip id="issue.stop">
					<Button variant="outline" disabled={busy} onClick={() => void go(() => api.issueStop(p, id))} {...keyAnchor("issue.stop")}>
						중지
					</Button>
				</KeyTip>
			</div>
		);
	}

	if (ask) {
		return (
			<div className="flex flex-col gap-2.5 border-t border-border px-6 py-4">
				<Textarea
					autoFocus
					value={ask.text}
					onChange={(e) => setAsk({ ...ask, text: e.target.value })}
					onKeyDown={(e) => {
						if (sendKey.isSend(e)) send();
						if (e.key === "Escape") setAsk(null);
					}}
					placeholder={ASK_TEXT[ask.kind].placeholder + sendKey.hint}
					className="min-h-24 resize-none bg-transparent text-[13.5px] leading-relaxed"
				/>
				<div className="flex items-center justify-end gap-2">
					{ask.kind === "rework" && allowOnce}
					<div className="flex-1" />
					<Button variant="ghost" onClick={() => setAsk(null)}>
						취소
					</Button>
					<Button disabled={busy || !ask.text.trim()} onClick={send}>
						{ASK_TEXT[ask.kind].send}
						<Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground">{sendKey.label}</Kbd>
					</Button>
				</div>
			</div>
		);
	}

	switch (issue.status) {
		case "inbox":
			return (
				<div className={bar}>
					<Button variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => void go(() => api.issueDrop(p, id))}>
						보류
					</Button>
					<div className="flex-1" />
					<KeyTip id="issue.plan">
						<Button disabled={busy || !issue.note.trim()} onClick={() => void go(() => api.issuePlan(p, id))} {...keyAnchor("issue.plan")}>
							계획 세우기
						</Button>
					</KeyTip>
				</div>
			);
		case "planned":
			return (
				<div className={bar}>
					<Button variant="ghost" className="text-muted-foreground" disabled={busy} onClick={() => void go(() => api.issueDrop(p, id))}>
						보류
					</Button>
					<div className="flex-1" />
					{allowOnce}
					{questions.length > 0 ? (
						<>
							<span className="tabular text-[12.5px] text-subtle">
								{answered}/{questions.length} 답함
							</span>
							{/* 답이 정해졌으면 계획을 다시 세우지 않고 답을 지시로 붙여 바로 구현할 수도 있다. 답이 없으면 그냥 승인이다. */}
							<Button variant="outline" disabled={busy} onClick={implementWithAnswers} {...keyAnchor("issue.approve")}>
								{answered ? "답대로 구현" : "묻지 말고 승인"}
								{answered > 0 && <Kbd className="ml-1">Ctrl ⇧ ↵</Kbd>}
							</Button>
							<Button disabled={busy || !answered} onClick={replanWithAnswers}>
								답하고 다시 계획
								<Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground">Ctrl ↵</Kbd>
							</Button>
						</>
					) : (
						<>
							<KeyTip id="issue.ask">
								<Button variant="outline" disabled={busy} onClick={() => setAsk({ kind: "replan", text: "" })} {...keyAnchor("issue.ask")}>
									다시 계획
								</Button>
							</KeyTip>
							<KeyTip id="issue.approve">
								<Button disabled={busy} onClick={() => void go(() => api.issueApprove(p, id, undefined, once))} {...keyAnchor("issue.approve")}>
									승인하고 구현
								</Button>
							</KeyTip>
						</>
					)}
				</div>
			);
		case "review":
			return (
				<div className={bar}>
					<RevertButton issue={issue} disabled={busy} />
					<div className="flex-1" />
					<FollowButton issue={issue} disabled={busy} onAsk={setAsk} />
					<KeyTip id="issue.ask">
						<Button variant="outline" disabled={busy} onClick={() => setAsk({ kind: "rework", text: "" })} {...keyAnchor("issue.ask")}>
							수정 요청
						</Button>
					</KeyTip>
					{/* 워크트리에서 돈 구현은 반영해야 본 작업트리에 들어간다. 반영 전에 완료하면 수정이 잊힌다. */}
					{issue.worktree ? (
						<Button disabled={busy} title={issue.worktree.path} onClick={() => void go(() => api.issueMerge(p, id))} {...keyAnchor("issue.finish")}>
							반영
						</Button>
					) : (
						<KeyTip id="issue.finish">
							<Button disabled={busy} onClick={() => void go(() => api.issueComplete(p, id))} {...keyAnchor("issue.finish")}>
								완료
							</Button>
						</KeyTip>
					)}
				</div>
			);
		case "done":
		case "dropped":
			return (
				<div className={bar}>
					{issue.changes.length > 0 && <RevertButton issue={issue} disabled={busy} />}
					<div className="flex-1" />
					<FollowButton issue={issue} disabled={busy} onAsk={setAsk} />
					<Button variant="outline" disabled={busy} onClick={() => void go(() => api.issueReopen(p, id))}>
						<RotateCcw />
						다시 열기
					</Button>
				</div>
			);
		default:
			return null;
	}
}

function RevertButton({ issue, disabled }: { issue: Issue; disabled: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button variant="ghost" className="text-muted-foreground" disabled={disabled} onClick={() => setOpen(true)}>
				<Undo2 />
				되돌리기
			</Button>
			<RevertConfirm issue={issue} open={open} onOpenChange={setOpen} />
		</>
	);
}

/**
 * 창을 닫지 않고 다른 이슈로 넘어간다.
 * 메모 단계 이슈는 편집기가 열리며 초점을 가져가, 그대로 두면 다음 Alt ↑↓ 가 편집기의 줄 옮기기가 된다.
 * 넘겨 보는 중에는 창에 초점을 돌려 이어 누를 수 있게 한다. 편집기는 마운트 뒤 효과에서 초점을 잡으므로 두 프레임 뒤에 본다.
 */
function openKeeping(id: string) {
	const sheet = document.querySelector<HTMLElement>('[data-slot="sheet-content"]');
	useUi.getState().openIssue(id);
	requestAnimationFrame(() => requestAnimationFrame(() => sheet?.isConnected && sheet.focus()));
}

/**
 * 창을 닫지 않고 보드의 이전 · 다음 이슈를 연다. 순서는 지금 보드에 보이는 그대로다(걸러 보기 · 정렬 · 완료 숨기기 · 열 순서).
 * 단추는 늘 같은 자리에 두고, 넘어갈 곳이 없으면(끝 · 보드에 없는 이슈 · 산출물 화면) 흐리게만 한다 — 나타났다 사라지면 옆 단추가 밀린다.
 * 입력칸 · 편집기 안에서는 받지 않는다. 대화 입력칸에서 이슈가 바뀌면 안 되고, 편집기에서 Alt ↑↓ 는 줄 옮기기다.
 */
function IssueNav({ issue }: { issue: Issue }) {
	const prev = useBoardNeighbor(issue.projectId, issue.id, -1);
	const next = useBoardNeighbor(issue.projectId, issue.id, 1);
	const go = (id: string | null) => {
		if (id) openKeeping(id);
	};
	// 옆 칸에 초점이 있으면 옆 칸 대화가 넘어간다.
	const inDock = (e: KeyboardEvent) => !!(e.target as HTMLElement | null)?.closest?.("[data-dock]");
	useKey({ id: "issue.prev", combo: "Alt+ArrowUp", label: "이전 이슈", group: "상세 창", series: "issue.nav", inInput: "skip", run: (e) => (inDock(e) ? false : go(prev)) });
	useKey({ id: "issue.next", combo: "Alt+ArrowDown", label: "다음 이슈", group: "상세 창", series: "issue.nav", inInput: "skip", run: (e) => (inDock(e) ? false : go(next)) });
	return (
		<>
			<KeyTip id="issue.prev">
				<Button size="icon-sm" variant="ghost" aria-label="이전 이슈" disabled={!prev} onClick={() => go(prev)} {...keyAnchor("issue.prev")}>
					<ChevronUp />
				</Button>
			</KeyTip>
			<KeyTip id="issue.next">
				<Button size="icon-sm" variant="ghost" aria-label="다음 이슈" disabled={!next} onClick={() => go(next)} {...keyAnchor("issue.next")}>
					<ChevronDown />
				</Button>
			</KeyTip>
		</>
	);
}

/** 항목과 확인 창은 보드 카드의 우클릭 메뉴와 같이 쓴다. 지우면 훅이 이 창을 닫는다. */
function IssueMenu({ issue }: { issue: Issue }) {
	const { items, dialogs } = useIssueActions(issue);
	useActionCommands(items, `#${issue.number}`);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="icon-sm" variant="ghost" aria-label="더 보기">
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="pop w-52">
					<DropdownActions items={items} />
				</DropdownMenuContent>
			</DropdownMenu>
			{dialogs}
		</>
	);
}
