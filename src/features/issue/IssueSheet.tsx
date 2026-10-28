import { useEffect, useState } from "react";
import { Archive, FileStack, FolderOpen, MoreHorizontal, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Chip } from "@/components/bits";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText } from "@/lib/api";
import { clock, relTime } from "@/lib/format";
import { useIssues, useProjects } from "@/lib/queries";
import { stateOf } from "@/lib/status";
import { useLive, useUi } from "@/lib/store";
import type { Issue, Project } from "@/lib/types";
import { totals } from "../board/IssueCard";
import { ChangesTab } from "./ChangesTab";
import { ChatComposer, ChatTab, type Draft, NO_DRAFT, SessionBar, useTranscript } from "./ChatTab";
import { HistoryTab } from "./HistoryTab";
import { NoteTab } from "./NoteTab";
import { PlanTab } from "./PlanTab";
import { type Answers, NO_ANSWERS, answeredCount, answersText } from "./Questions";

type Tab = "note" | "plan" | "changes" | "chat" | "history";

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

	return (
		<Sheet open={!!issue} onOpenChange={(o) => !o && openIssue(null)}>
			<SheetContent
				side="right"
				showCloseButton={false}
				// 열리자마자 첫 단추(더 보기)에 초점 테두리가 생기면 부차적인 메뉴가 가장 먼저 눈에 띈다. 창 자체에 초점을 둔다.
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					(e.currentTarget as HTMLElement | null)?.focus();
				}}
				className="pop gap-0 overflow-hidden rounded-none p-0 outline-none data-[side=right]:top-9 data-[side=right]:bottom-0 data-[side=right]:h-auto data-[side=right]:w-[min(860px,64vw)] data-[side=right]:border-y-0 data-[side=right]:border-r-0 data-[side=right]:sm:max-w-none"
			>
				{issue && <IssueDetail key={issue.id} issue={issue} projectPath={project.path} onClose={() => openIssue(null)} />}
			</SheetContent>
		</Sheet>
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

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex flex-col gap-2 px-6 pt-5 pb-3">
				<div className="flex items-center gap-2 text-[12px] text-subtle">
					<span className="mono tabular">#{issue.number}</span>
					{state && <Chip tone={state.tone}>{state.label}</Chip>}
					<span title={clock(issue.updatedAt)}>{relTime(issue.updatedAt)}</span>
					<div className="flex-1" />
					<IssueMenu issue={issue} onDeleted={onClose} />
					<Button size="icon-sm" variant="ghost" aria-label="닫기" onClick={onClose}>
						<X />
					</Button>
				</div>
				<SheetTitle className="text-[19px] leading-snug font-semibold tracking-[-0.02em] break-keep">{issue.title || "제목 없는 메모"}</SheetTitle>
				<SheetDescription className="sr-only">이슈 상세</SheetDescription>
			</header>

			<Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 flex-1 gap-0">
				<div className="border-b border-border px-6">
					<TabsList variant="line" className="h-9 gap-4 p-0">
						<TabsTrigger value="note" className="px-0">
							메모
						</TabsTrigger>
						{/* 대화로도 설계하고 고친다. 단계 탭들 사이에 묻히지 않게 메모 바로 뒤에 둔다. */}
						<TabsTrigger value="chat" className="px-0">
							대화{chats > 0 && <span className="tabular text-subtle">{chats}</span>}
						</TabsTrigger>
						<TabsTrigger value="plan" className="px-0">
							계획
						</TabsTrigger>
						<TabsTrigger value="changes" className="px-0">
							변경{t.files > 0 && <span className="tabular text-subtle">{t.files}</span>}
						</TabsTrigger>
						<TabsTrigger value="history" className="px-0">
							기록
						</TabsTrigger>
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
			{tab === "chat" ? <ChatComposer issue={issue} draft={draft} onDraft={setDraft} /> : <ActionBar issue={issue} answers={answers} />}
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
		// 흐름에는 앞 300자만 남는다. 긴 질문이었다면 대화 탭의 원문을 다시 보낸다. 읽기 전용이었는지는 그때 권한 이름으로 안다.
		case "chat": {
			const prev = [...issue.runs].reverse().find((r) => r.kind === "chat");
			return api.issueChat(p, id, prev?.prompt || last.text, !prev?.mode.startsWith("읽기"));
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

type Ask = { kind: "replan" | "rework"; text: string } | null;

function ActionBar({ issue, answers }: { issue: Issue; answers: Answers }) {
	const [ask, setAsk] = useState<Ask>(null);
	const [busy, setBusy] = useState(false);
	const activity = useLive((s) => (issue.run ? s.byTarget[issue.id]?.activity : undefined));
	const { projectId: p, id } = issue;
	const questions = issue.plan?.questions ?? [];
	const answered = answeredCount(questions, answers);
	// 프로젝트가 「편집 · 허용 목록」일 때만 고른다. 「모두 허용」 프로젝트에서는 늘 모두 허용이다.
	const { data: projects } = useProjects();
	const limited = projects?.find((x) => x.id === p)?.implMode !== "bypassPermissions";
	const [once, setOnce] = useState(false);
	const allowOnce = limited && (
		<label
			className="flex items-center gap-2 text-[12.5px] text-muted-foreground"
			title="이번 구현만 명령 · 웹 · 스킬을 묻지 않고 허용합니다. 거부 목록은 지킵니다. 프로젝트 설정은 바뀌지 않습니다."
		>
			<Switch size="sm" checked={once} onCheckedChange={setOnce} />
			이번만 모두 허용
		</label>
	);

	const go = async (fn: () => Promise<unknown>) => {
		setBusy(true);
		await run(fn);
		setBusy(false);
	};
	const send = () => {
		if (!ask || !ask.text.trim()) return;
		const text = ask.text;
		void go(async () => {
			await (ask.kind === "replan" ? api.issuePlan(p, id, text) : api.issueRework(p, id, text, once));
			setAsk(null);
		});
	};

	const bar = "flex items-center gap-2 border-t border-border px-6 py-3.5";

	if (issue.run) {
		return (
			<div className={bar}>
				<span className="min-w-0 flex-1 truncate text-[12.5px] text-subtle">{issue.run.phase === "queued" ? "앞선 작업을 기다리는 중" : activity}</span>
				<Button variant="outline" disabled={busy} onClick={() => void go(() => api.issueStop(p, id))}>
					중지
				</Button>
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
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
						if (e.key === "Escape") setAsk(null);
					}}
					placeholder={ask.kind === "replan" ? "계획에서 바꿀 것이나 Claude 가 물은 것에 대한 답" : "구현 결과에서 고칠 것"}
					className="min-h-24 resize-none bg-transparent text-[13.5px] leading-relaxed"
				/>
				<div className="flex items-center justify-end gap-2">
					{ask.kind === "rework" && allowOnce}
					<div className="flex-1" />
					<Button variant="ghost" onClick={() => setAsk(null)}>
						취소
					</Button>
					<Button disabled={busy || !ask.text.trim()} onClick={send}>
						{ask.kind === "replan" ? "다시 계획" : "수정 요청"}
						<Kbd className="ml-1 bg-primary-foreground/15 text-primary-foreground">Ctrl ↵</Kbd>
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
					<Button disabled={busy || !issue.note.trim()} onClick={() => void go(() => api.issuePlan(p, id))}>
						계획 세우기
					</Button>
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
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => void go(() => (answered ? api.issueApprove(p, id, answersText(questions, answers), once) : api.issueApprove(p, id, undefined, once)))}
							>
								{answered ? "답대로 구현" : "묻지 말고 승인"}
							</Button>
							<Button disabled={busy || !answered} onClick={() => void go(() => api.issuePlan(p, id, answersText(questions, answers)))}>
								답하고 다시 계획
							</Button>
						</>
					) : (
						<>
							<Button variant="outline" disabled={busy} onClick={() => setAsk({ kind: "replan", text: "" })}>
								다시 계획
							</Button>
							<Button disabled={busy} onClick={() => void go(() => api.issueApprove(p, id, undefined, once))}>
								승인하고 구현
							</Button>
						</>
					)}
				</div>
			);
		case "review":
			return (
				<div className={bar}>
					<RevertButton issue={issue} disabled={busy} />
					<div className="flex-1" />
					<Button variant="outline" disabled={busy} onClick={() => setAsk({ kind: "rework", text: "" })}>
						수정 요청
					</Button>
					<Button disabled={busy} onClick={() => void go(() => api.issueComplete(p, id))}>
						완료
					</Button>
				</div>
			);
		case "done":
		case "dropped":
			return (
				<div className={bar}>
					{issue.changes.length > 0 && <RevertButton issue={issue} disabled={busy} />}
					<div className="flex-1" />
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

/** 되돌리기는 저장소를 고치므로 한 번 묻는다. 무엇이 어떻게 되는지를 그 자리에서 알려 준다. */
function RevertConfirm({ issue, open, onOpenChange }: { issue: Issue; open: boolean; onOpenChange: (o: boolean) => void }) {
	const files = new Set(issue.changes.map((c) => c.rel)).size;
	const created = new Set(issue.changes.filter((c) => c.kind === "create").map((c) => c.rel)).size;
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="pop">
				<AlertDialogHeader>
					<AlertDialogTitle>#{issue.number} 의 구현을 되돌릴까요?</AlertDialogTitle>
					<AlertDialogDescription>
						Claude 가 이 이슈에서 바꾼 파일 {files}개를 기록한 변경분대로 거꾸로 고칩니다. 그 뒤에 직접 고친 줄은 지키라고 지시합니다.
						{created > 0 && ` 새로 만든 파일 ${created}개는 앱 데이터의 휴지통 폴더로 옮깁니다.`} 끝나면 계획 단계로 돌아가 다시 승인하거나 다시 계획할 수 있습니다.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>취소</AlertDialogCancel>
					<AlertDialogAction onClick={() => void run(() => api.issueRevert(issue.projectId, issue.id))}>되돌리기</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
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

function IssueMenu({ issue, onDeleted }: { issue: Issue; onDeleted: () => void }) {
	const [confirm, setConfirm] = useState(false);
	const [revert, setRevert] = useState(false);
	const setView = useUi((s) => s.setView);
	const openDeliverable = useUi((s) => s.openDeliverable);
	const { projectId: p, id } = issue;
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="icon-sm" variant="ghost" aria-label="더 보기">
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="pop w-52">
					<DropdownMenuItem
						onSelect={() =>
							void run(async () => {
								const d = await api.deliverableFromIssue(p, id);
								toast(`산출물 「${d.title}」 로 남겼습니다`, {
									action: {
										label: "보기",
										onClick: () => {
											setView("deliverables");
											openDeliverable(d.id);
										},
									},
								});
							})
						}
					>
						<FileStack />
						산출물로 남기기
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => void run(() => api.reveal(issue.dir))}>
						<FolderOpen />
						이슈 폴더 열기
					</DropdownMenuItem>
					{!issue.run && issue.status !== "dropped" && issue.status !== "done" && (
						<DropdownMenuItem onSelect={() => void run(() => api.issueDrop(p, id))}>
							<Archive />
							보류
						</DropdownMenuItem>
					)}
					{/* 결과 확인 · 완료 단계는 아래 칸에도 단추가 있다. 승인 대기 중 대화로 고친 것처럼 그 밖의 단계는 여기서만 되돌린다. */}
					{!issue.run && issue.changes.length > 0 && (
						<DropdownMenuItem onSelect={() => setRevert(true)}>
							<Undo2 />
							구현 되돌리기
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" disabled={!!issue.run} onSelect={() => setConfirm(true)}>
						<Trash2 />
						지우기
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<RevertConfirm issue={issue} open={revert} onOpenChange={setRevert} />
			<AlertDialog open={confirm} onOpenChange={setConfirm}>
				<AlertDialogContent className="pop">
					<AlertDialogHeader>
						<AlertDialogTitle>#{issue.number} 를 지울까요?</AlertDialogTitle>
						<AlertDialogDescription>메모 · 계획 · 첨부 · 실행 기록을 앱 데이터의 휴지통 폴더로 옮깁니다. 이미 고친 코드는 그대로 남습니다.</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>취소</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() =>
								void run(async () => {
									await api.issueDelete(p, id);
									onDeleted();
								})
							}
						>
							지우기
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
