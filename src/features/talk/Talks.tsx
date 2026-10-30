import { type ReactNode, useEffect, useRef, useState } from "react";
import { CornerDownRight, FolderOpen, MessageSquare, MessageSquarePlus, MoreHorizontal, PanelRight, PanelRightClose, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { type ActionList, attempt, ContextActions, DropdownActions } from "@/components/ActionMenu";
import { Empty, RunDot } from "@/components/bits";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ChatComposer, ChatTab, NO_TALK_DRAFT, SessionBar, useTranscript } from "@/features/issue/ChatTab";
import { AppTalkSettings } from "@/features/project/ProjectHeader";
import { api, errorText } from "@/lib/api";
import { newId, relTime } from "@/lib/format";
import { lastEnded, useMarkSeen, useUnread } from "@/lib/notices";
import { useAppProject, useProjects, useTalks } from "@/lib/queries";
import { useUi } from "@/lib/store";
import { GLOBAL_PID, type Issue } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 대화 목록과 대화 창. 왼쪽에 대화 목록, 오른쪽에 이슈 대화와 같은 화면을 둔다.
 * 대화는 보드에 나오지 않는 이슈라서 보내기 · 중지 · 터미널 · 첨부를 이슈 대화와 함께 쓴다.
 * 프로젝트의 대화 탭은 그 프로젝트 대화만 보인다. 앱 대화와 다른 프로젝트 대화는 사이드바의 「대화」(AllTalks)에서 모아 본다.
 */
export function Talks({ pid, path }: { pid: string; path: string }) {
	const { data: talks = [], isLoading } = useTalks(pid);
	const sel = useUi((s) => s.talk);
	const openTalk = useUi((s) => s.openTalk);
	const [busy, setBusy] = useState(false);
	const talk = sel ? talks.find((t) => t.id === sel.id) : undefined;
	const app = pid === GLOBAL_PID;

	// 연 대화가 이 자리에 없으면(처음 · 지운 뒤 · 다른 자리에서 왔을 때) 가장 최근 대화를 연다.
	useEffect(() => {
		if (!isLoading && !talk && talks.length) openTalk({ projectId: pid, id: talks[0].id });
	}, [isLoading, talk, talks, pid, openTalk]);

	// 아직 묻지 않은 대화가 있으면 그것을 다시 연다. 「새 대화」를 누를 때마다 빈 대화가 쌓이지 않게 한다.
	const create = async () => {
		const blank = talks.find((t) => t.runs.length === 0 && !t.run);
		if (blank) return openTalk({ projectId: pid, id: blank.id });
		setBusy(true);
		try {
			const t = await api.talkCreate(pid, newId());
			openTalk({ projectId: pid, id: t.id });
		} catch (e) {
			toast.error(errorText(e));
		}
		setBusy(false);
	};

	return (
		<div className="flex min-h-0 flex-1 gap-4">
			<aside className="flex w-60 shrink-0 flex-col gap-2">
				<Button variant="outline" disabled={busy} onClick={() => void create()}>
					<MessageSquarePlus />새 대화
				</Button>
				<nav className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
					{talks.map((t) => (
						<TalkRow key={t.id} talk={t} active={t.id === talk?.id} onOpen={() => openTalk({ projectId: pid, id: t.id })} />
					))}
				</nav>
			</aside>

			<section className="surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md">
				{talk ? (
					<TalkSlot key={talk.id} talk={talk} projectPath={path} />
				) : (
					!isLoading && (
						<Empty className="grid flex-1 place-items-center leading-relaxed break-keep">
							<div>
								{app ? (
									<>
										어느 프로젝트에도 묶이지 않고 이 앱 자체를 두고 묻는 대화입니다.
										<br />
										플러그인을 만들거나 설정 · 기록을 살펴 달라고 할 수 있습니다.
									</>
								) : (
									<>
										메모를 쓰지 않고 이 저장소에 대해 바로 물어볼 수 있습니다.
										<br />
										묻다가 「작업 메모로 등록해 줘」라고 하면 보드에 메모를 만듭니다.
									</>
								)}
								<div className="mt-4">
									<Button disabled={busy} onClick={() => void create()}>
										<MessageSquarePlus />새 대화
									</Button>
								</div>
							</div>
						</Empty>
					)
				)}
			</section>
		</div>
	);
}

/**
 * 대화 탭 · 「대화」 화면이 대화를 그리는 자리. 옆 칸에 띄워 둔 대화는 여기서 그리지 않는다 —
 * 같은 대화가 두 곳에 그려지면 스크롤 · 입력칸이 따로 놀아 어디서 보냈는지 헷갈린다.
 */
export function TalkSlot({ talk, projectPath }: { talk: Issue; projectPath: string }) {
	const docked = useUi((s) => s.dock.open && s.dock.talk?.id === talk.id);
	const setDock = useUi((s) => s.setDock);
	if (!docked) return <TalkPane talk={talk} projectPath={projectPath} />;
	return (
		<Empty className="grid flex-1 place-items-center leading-relaxed break-keep">
			<div>
				「{talk.title || "새 대화"}」는 옆 칸에 띄워 둔 대화입니다.
				<div className="mt-4">
					<Button variant="outline" onClick={() => setDock({ open: false })}>
						<PanelRightClose />
						여기로 가져오기
					</Button>
				</div>
			</div>
		</Empty>
	);
}

/** 대화가 도는 자리. 앱 대화는 앱 데이터 폴더에서 돌고 무엇이든 고칠 수 있어, 늘 눈에 띄게 둔다. */
export function TalkTag({ talk }: { talk: Issue }) {
	const { data: projects = [] } = useProjects();
	if (talk.projectId === GLOBAL_PID) {
		return (
			<span title="앱 데이터 폴더에서 돕니다" className="shrink-0 rounded-sm border border-border px-1.5 text-[11px] text-muted-foreground">
				앱
			</span>
		);
	}
	const name = projects.find((p) => p.id === talk.projectId)?.name;
	return name ? <span className="shrink-0 rounded-sm border border-border px-1.5 text-[11px] text-muted-foreground">{name}</span> : null;
}

/** 메모에서 갈라 낸 대화의 출처. 누르면 그 메모를 연다. */
function FromIssue({ talk }: { talk: Issue }) {
	const f = talk.fromIssue;
	if (!f) return null;
	return (
		<button
			type="button"
			title={`메모 #${f.number} ${f.title} 열기`}
			onClick={() => useUi.getState().openTarget({ projectId: talk.projectId, target: "issue", id: f.id })}
			className="flex shrink-0 items-center gap-1 text-[12px] text-subtle hover:text-foreground"
		>
			<CornerDownRight className="size-3.5" />
			메모 #{f.number} 에서 옮김
		</button>
	);
}

/**
 * 대화 하나. 쓰다 만 질문은 대화마다 화면 상태에 둔다 — 대화 탭과 옆 칸을 오가도 남는다.
 * compact 는 옆 칸 꼴이다. 머리는 옆 칸이 그리고, 세션 줄을 줄인다.
 */
export function TalkPane({ talk, projectPath, compact = false }: { talk: Issue; projectPath: string; compact?: boolean }) {
	const draft = useUi((s) => s.talkDrafts[talk.id]) ?? NO_TALK_DRAFT;
	const setDraft = useUi((s) => s.setDraft);
	// 터미널에서 이어 간 차례가 고친 파일을 담는다. 이슈 상세 창과 같다.
	useTranscript(talk);
	// 대화 화면에서 연 대화의 답은 본 것이다. 알림함 · 목록의 점이 꺼진다.
	useMarkSeen(talk.id, lastEnded(talk.runs));
	const pad = compact ? "px-4" : "px-6";
	return (
		<>
			{!compact && (
				<header className="flex items-center gap-2 border-b border-border px-6 py-2.5">
					<TalkTitle talk={talk} />
					<TalkTag talk={talk} />
					<FromIssue talk={talk} />
					{talk.changes.length > 0 && <span className="shrink-0 text-[12px] text-subtle">바뀐 파일 {new Set(talk.changes.map((c) => c.rel)).size}</span>}
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="옆에 띄우기"
						title="옆에 띄우기 — 띄워 둔 채 보드 · 설정을 쓸 수 있습니다"
						onClick={() => useUi.getState().dockTalk({ projectId: talk.projectId, id: talk.id })}
					>
						<PanelRight />
					</Button>
					<TalkMenu talk={talk} />
				</header>
			)}
			{compact && talk.fromIssue && (
				<div className="border-b border-border px-4 py-1">
					<FromIssue talk={talk} />
				</div>
			)}
			<SessionBar issue={talk} projectPath={projectPath} compact={compact} />
			<div data-scroll className={cn("min-h-0 flex-1 overflow-y-auto py-5", pad)}>
				<ChatTab issue={talk} projectPath={projectPath} />
			</div>
			{talk.projectId === GLOBAL_PID && draft.edit && (
				<div className={cn("border-t border-brand/30 bg-brand/10 py-1.5 text-[12px] break-keep text-brand-text", pad)}>
					설정 · 이슈 기록까지 고칠 수 있습니다 · 보내기 전에 설정 파일을 백업합니다
				</div>
			)}
			<ChatComposer issue={talk} draft={draft} onDraft={(d) => setDraft(talk.id, d)} />
		</>
	);
}

/** 제목 모델이 첫 답 뒤에 지을 차례인지. 짓기 전에는 첫 질문이 임시 제목이다. */
const naming = (t: Issue) => t.titleMode === "auto" && t.titledAt === 0 && t.runs.some((r) => r.status === "ok");

/** 누르면 입력칸이 된다. 고친 제목은 그대로 남고, 비우면 첫 문답으로 다시 짓는다. 메모 상세 창의 제목과 같은 동작이다. */
function TalkTitle({ talk }: { talk: Issue }) {
	const [edit, setEdit] = useState<string | null>(null);
	const cancelled = useRef(false);

	const save = async () => {
		if (edit === null) return;
		const next = edit.trim();
		setEdit(null);
		if (cancelled.current || next === talk.title) return;
		try {
			await api.issueSetTitle(talk.projectId, talk.id, next);
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	if (edit !== null) {
		return (
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
				aria-label="대화 제목"
				className="h-7 min-w-0 flex-1 px-2 text-[14px] font-semibold md:text-[14px]"
			/>
		);
	}
	return (
		<h2 className="flex min-w-0 flex-1 items-baseline gap-2 text-[14px] font-semibold">
			<button
				type="button"
				title="눌러서 제목 고치기"
				disabled={talk.runs.length === 0}
				onClick={() => {
					cancelled.current = false;
					setEdit(talk.title);
				}}
				className="min-w-0 truncate rounded-sm text-left hover:text-muted-foreground disabled:hover:text-foreground"
			>
				{talk.title || "새 대화"}
			</button>
			{naming(talk) && <span className="shrink-0 text-[12px] font-normal text-subtle">제목 짓는 중</span>}
		</h2>
	);
}

/** 대화 폴더 · 지우기와 그 확인 창. 대화 머리의 「더 보기」와 목록 줄의 우클릭이 같이 쓴다. */
export function useTalkActions(talk: Issue): { items: ActionList; dialogs: ReactNode } {
	const [confirm, setConfirm] = useState(false);
	const [perm, setPerm] = useState(false);
	const isApp = talk.projectId === GLOBAL_PID;
	const { data: app } = useAppProject();
	const items: ActionList = [
		{ label: "옆에 띄우기", icon: <PanelRight />, onSelect: () => useUi.getState().dockTalk({ projectId: talk.projectId, id: talk.id }) },
		{ label: "대화 폴더 열기", icon: <FolderOpen />, onSelect: () => void attempt(() => api.reveal(talk.dir)) },
		// 앱 대화는 프로젝트 설정이 없다. 명령 허용 · 막을 목록과 앱 데이터 폴더를 대화 메뉴에서 연다.
		isApp && !!app && { label: "앱 대화 권한", icon: <ShieldCheck />, onSelect: () => setPerm(true) },
		isApp && !!app && { label: "앱 데이터 폴더 열기", icon: <FolderOpen />, onSelect: () => void attempt(() => api.open(app.path)) },
		"sep",
		{ label: "지우기", icon: <Trash2 />, destructive: true, disabled: !!talk.run, onSelect: () => setConfirm(true) },
	];
	const dialogs = (
		<>
		{isApp && app && <AppTalkSettings project={app} open={perm} onOpenChange={setPerm} />}
		<AlertDialog open={confirm} onOpenChange={setConfirm}>
			<AlertDialogContent className="pop">
				<AlertDialogHeader>
					<AlertDialogTitle>이 대화를 지울까요?</AlertDialogTitle>
					<AlertDialogDescription>
						대화 · 첨부 · 실행 기록을 앱 데이터의 휴지통 폴더로 옮깁니다. 대화에서 등록한 메모와 고친 코드는 그대로 남습니다.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>취소</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						onClick={() =>
							void attempt(async () => {
								await api.issueDelete(talk.projectId, talk.id);
								// 목록에서 다른 대화를 지웠으면 보던 대화는 그대로 둔다. 보던 것을 지웠으면 가장 최근 대화가 열린다.
								const ui = useUi.getState();
								if (ui.talk?.id === talk.id) ui.openTalk(null);
								if (ui.dock.talk?.id === talk.id) ui.setDock({ open: false, talk: null });
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
	return { items, dialogs };
}

function TalkMenu({ talk }: { talk: Issue }) {
	const { items, dialogs } = useTalkActions(talk);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="icon-sm" variant="ghost" aria-label="더 보기">
						<MoreHorizontal />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="pop w-48">
					<DropdownActions items={items} />
				</DropdownMenuContent>
			</DropdownMenu>
			{dialogs}
		</>
	);
}

export function TalkRow({ talk, active, onOpen }: { talk: Issue; active: boolean; onOpen: () => void }) {
	const { items, dialogs } = useTalkActions(talk);
	const unread = useUnread(talk.id, lastEnded(talk.runs)) && !talk.run;
	return (
		<>
			<ContextActions items={[{ label: "열기", icon: <MessageSquare />, onSelect: onOpen }, "sep", ...items]}>
				<button
					type="button"
					onClick={onOpen}
					className={cn("flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover", active && "bg-secondary hover:bg-secondary")}
				>
					<span className="flex items-center gap-2">
						{talk.run && <RunDot />}
						<span className="min-w-0 flex-1 truncate text-[13px] font-medium">{talk.title || "새 대화"}</span>
						{unread && <span aria-label="읽지 않은 답" title="읽지 않은 답" className={cn("size-1.5 shrink-0 rounded-full", talk.error ? "bg-danger" : "bg-brand")} />}
					</span>
					<span className="text-[11.5px] text-subtle">
						{relTime(talk.updatedAt)}
						{talk.fromIssue && ` · 메모 #${talk.fromIssue.number} 에서`}
						{naming(talk) && " · 제목 짓는 중"}
					</span>
				</button>
			</ContextActions>
			{dialogs}
		</>
	);
}
