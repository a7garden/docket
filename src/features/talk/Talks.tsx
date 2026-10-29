import { type ReactNode, useEffect, useState } from "react";
import { FolderOpen, MessageSquare, MessageSquarePlus, MoreHorizontal, Trash2 } from "lucide-react";
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
import { ChatComposer, ChatTab, type Draft, NO_TALK_DRAFT, SessionBar, useTranscript } from "@/features/issue/ChatTab";
import { api, errorText } from "@/lib/api";
import { newId, relTime } from "@/lib/format";
import { lastEnded, useMarkSeen, useUnread } from "@/lib/notices";
import { useTalks } from "@/lib/queries";
import { useUi } from "@/lib/store";
import type { Issue, Project } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * 메모 없이 프로젝트에서 바로 여는 대화. 왼쪽에 대화 목록, 오른쪽에 이슈 대화와 같은 화면을 둔다.
 * 대화는 보드에 나오지 않는 이슈라서 보내기 · 중지 · 터미널 · 첨부를 이슈 대화와 함께 쓴다.
 */
export function Talks({ project }: { project: Project }) {
	const { data: talks = [], isLoading } = useTalks(project.id);
	const talkId = useUi((s) => s.talkId);
	const openTalk = useUi((s) => s.openTalk);
	const [busy, setBusy] = useState(false);
	const talk = talks.find((t) => t.id === talkId);

	// 연 대화가 없으면(처음 · 지운 뒤) 가장 최근 대화를 연다.
	useEffect(() => {
		if (!isLoading && !talk && talks.length) openTalk(talks[0].id);
	}, [isLoading, talk, talks, openTalk]);

	// 아직 묻지 않은 대화가 있으면 그것을 다시 연다. 「새 대화」를 누를 때마다 빈 대화가 쌓이지 않게 한다.
	const create = async () => {
		const blank = talks.find((t) => t.runs.length === 0 && !t.run);
		if (blank) return openTalk(blank.id);
		setBusy(true);
		try {
			const t = await api.talkCreate(project.id, newId());
			openTalk(t.id);
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
						<TalkRow key={t.id} talk={t} active={t.id === talk?.id} onOpen={() => openTalk(t.id)} />
					))}
				</nav>
			</aside>

			<section className="surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md">
				{talk ? (
					<TalkPane key={talk.id} talk={talk} projectPath={project.path} />
				) : (
					!isLoading && (
						<Empty className="grid flex-1 place-items-center leading-relaxed break-keep">
							<div>
								메모를 쓰지 않고 이 저장소에 대해 바로 물어볼 수 있습니다.
								<br />
								묻다가 「작업 메모로 등록해 줘」라고 하면 보드에 메모를 만듭니다.
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

/** 대화 하나. 쓰다 만 질문은 대화마다 따로 둔다 — key 로 대화가 바뀌면 새로 만든다. */
function TalkPane({ talk, projectPath }: { talk: Issue; projectPath: string }) {
	const [draft, setDraft] = useState<Draft>(NO_TALK_DRAFT);
	// 터미널에서 이어 간 차례가 고친 파일을 담는다. 이슈 상세 창과 같다.
	useTranscript(talk);
	// 대화 화면에서 연 대화의 답은 본 것이다. 알림함 · 목록의 점이 꺼진다.
	useMarkSeen(talk.id, lastEnded(talk.runs));
	return (
		<>
			<header className="flex items-center gap-2 border-b border-border px-6 py-2.5">
				<h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{talk.title || "새 대화"}</h2>
				{talk.changes.length > 0 && <span className="text-[12px] text-subtle">바뀐 파일 {new Set(talk.changes.map((c) => c.rel)).size}</span>}
				<TalkMenu talk={talk} />
			</header>
			<SessionBar issue={talk} projectPath={projectPath} />
			<div data-scroll className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
				<ChatTab issue={talk} projectPath={projectPath} />
			</div>
			<ChatComposer issue={talk} draft={draft} onDraft={setDraft} />
		</>
	);
}

/** 대화 폴더 · 지우기와 그 확인 창. 대화 머리의 「더 보기」와 목록 줄의 우클릭이 같이 쓴다. */
function useTalkActions(talk: Issue): { items: ActionList; dialogs: ReactNode } {
	const [confirm, setConfirm] = useState(false);
	const items: ActionList = [
		{ label: "대화 폴더 열기", icon: <FolderOpen />, onSelect: () => void attempt(() => api.reveal(talk.dir)) },
		"sep",
		{ label: "지우기", icon: <Trash2 />, destructive: true, disabled: !!talk.run, onSelect: () => setConfirm(true) },
	];
	const dialogs = (
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
								if (ui.talkId === talk.id) ui.openTalk(null);
							})
						}
					>
						지우기
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
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

function TalkRow({ talk, active, onOpen }: { talk: Issue; active: boolean; onOpen: () => void }) {
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
					<span className="text-[11.5px] text-subtle">{relTime(talk.updatedAt)}</span>
				</button>
			</ContextActions>
			{dialogs}
		</>
	);
}
