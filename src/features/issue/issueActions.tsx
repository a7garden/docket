import { type ReactNode, useState } from "react";
import { Archive, Check, FileStack, FolderOpen, MessagesSquare, Play, RotateCcw, Square, Trash2, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { type Action, type ActionList, attempt } from "@/components/ActionMenu";
import { pluginActions } from "@/components/PluginResult";
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
import { api } from "@/lib/api";
import { useForkedTalk, usePluginMenus } from "@/lib/queries";
import { useUi } from "@/lib/store";
import type { Issue } from "@/lib/types";
import { promoteTalk } from "./ChatTab";

/** 단계를 넘기는 동작 하나. `call` 은 부르는 곳이 바쁨 표시 · 오류 처리를 감싸 부른다. */
export interface Primary {
	label: string;
	icon: ReactNode;
	call: () => Promise<unknown>;
	disabled?: boolean;
	destructive?: boolean;
}

/**
 * 카드 단추와 우클릭 메뉴가 함께 쓰는 단계별 주 동작. 조건을 한 곳에 두어 둘이 어긋나지 않게 한다.
 * 실패한 이슈는 비운다 — 무엇을 다시 할지는 상세 창의 「다시 시도」가 지난 요청을 보고 정한다.
 */
export function primaryAction(issue: Issue): Primary | null {
	const { projectId: p, id } = issue;
	if (issue.run)
		return { label: issue.run.phase === "queued" ? "줄에서 빼기" : "중지", icon: <Square className="fill-current" />, call: () => api.issueStop(p, id), destructive: true };
	if (issue.error) return null;
	switch (issue.status) {
		case "inbox":
			return { label: "계획 세우기", icon: <Wand2 />, call: () => api.issuePlan(p, id), disabled: !issue.note.trim() };
		// 확인할 것이 있으면 답을 골라야 하므로 상세 창에서만 승인한다.
		case "planned":
			return (issue.plan?.questions.length ?? 0) === 0 ? { label: "승인하고 구현", icon: <Play />, call: () => api.issueApprove(p, id) } : null;
		case "review":
			return { label: "완료", icon: <Check />, call: () => api.issueComplete(p, id) };
		case "done":
		case "dropped":
			return { label: "다시 열기", icon: <RotateCcw />, call: () => api.issueReopen(p, id) };
		default:
			return null;
	}
}

/** 되돌리기는 저장소를 고치므로 한 번 묻는다. 무엇이 어떻게 되는지를 그 자리에서 알려 준다. */
export function RevertConfirm({ issue, open, onOpenChange }: { issue: Issue; open: boolean; onOpenChange: (o: boolean) => void }) {
	const files = new Set(issue.changes.map((c) => c.rel)).size;
	const created = new Set(issue.changes.filter((c) => c.kind === "create").map((c) => c.rel)).size;
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="pop">
				<AlertDialogHeader>
					<AlertDialogTitle>#{issue.number} 의 구현을 되돌릴까요?</AlertDialogTitle>
					<AlertDialogDescription>
						{issue.worktree ? (
							<>워크트리에서 고친 것을 반영하지 않고 워크트리를 지웁니다. 본 작업트리는 건드리지 않습니다. 계획 단계로 돌아가 다시 승인하거나 다시 계획할 수 있습니다.</>
						) : (
							<>
								Claude 가 이 이슈에서 바꾼 파일 {files}개를 기록한 변경분대로 거꾸로 고칩니다. 그 뒤에 직접 고친 줄은 지키라고 지시합니다.
								{created > 0 && ` 새로 만든 파일 ${created}개는 앱 데이터의 휴지통 폴더로 옮깁니다.`} 끝나면 계획 단계로 돌아가 다시 승인하거나 다시 계획할 수 있습니다.
							</>
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>취소</AlertDialogCancel>
					<AlertDialogAction onClick={() => void attempt(() => api.issueRevert(issue.projectId, issue.id))}>되돌리기</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

/**
 * 이슈 관리 동작(산출물 · 폴더 · 보류 · 되돌리기 · 지우기)과 그 확인 창. 상세 창의 「더 보기」와 카드 우클릭이 같이 쓴다.
 * 확인 창을 메뉴 밖에 두는 것은 메뉴가 닫혀도 창이 남아야 해서다. `dialogs` 는 카드처럼 누르면 열리는 요소 밖에 둔다 —
 * 포털로 그려져도 React 이벤트는 트리를 따라 올라가므로, 안에 두면 확인 창을 누를 때 카드가 열린다.
 */
export function useIssueActions(issue: Issue): { items: ActionList; dialogs: ReactNode } {
	const [confirm, setConfirm] = useState(false);
	const [revert, setRevert] = useState(false);
	const setView = useUi((s) => s.setView);
	const openDeliverable = useUi((s) => s.openDeliverable);
	const menus = usePluginMenus("issue");
	const forked = useForkedTalk(issue);
	const { projectId: p, id } = issue;

	const items: ActionList = [
		{
			label: "산출물로 남기기",
			icon: <FileStack />,
			onSelect: () =>
				void attempt(async () => {
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
				}),
		},
		// 대화 탭 세션 줄의 「대화로 이어 가기」와 같다. 세션이 있어야 이어 갈 것이 있다.
		!!issue.sessionId && { label: forked ? "갈라 낸 대화 열기" : "대화로 이어 가기", icon: <MessagesSquare />, disabled: !forked && !!issue.run, onSelect: () => void promoteTalk(issue) },
		{ label: "이슈 폴더 열기", icon: <FolderOpen />, onSelect: () => void attempt(() => api.reveal(issue.dir)) },
		!issue.run && issue.status !== "dropped" && issue.status !== "done" && { label: "보류", icon: <Archive />, onSelect: () => void attempt(() => api.issueDrop(p, id)) },
		// 결과 확인 · 완료 단계는 상세 창 아래 칸에도 단추가 있다. 승인 대기 중 대화로 고친 것처럼 그 밖의 단계는 메뉴에서만 되돌린다.
		!issue.run && issue.changes.length > 0 && { label: "구현 되돌리기", icon: <Undo2 />, onSelect: () => setRevert(true) },
		"sep",
		...pluginActions(menus, { projectId: p, issueId: id, changes: issue.changes.length > 0, session: !!issue.sessionId }),
		"sep",
		{ label: "지우기", icon: <Trash2 />, destructive: true, disabled: !!issue.run, onSelect: () => setConfirm(true) },
	];

	const dialogs = (
		<>
			<RevertConfirm issue={issue} open={revert} onOpenChange={setRevert} />
			<AlertDialog open={confirm} onOpenChange={setConfirm}>
				<AlertDialogContent className="pop">
					<AlertDialogHeader>
						<AlertDialogTitle>#{issue.number} 를 지울까요?</AlertDialogTitle>
						<AlertDialogDescription>메모 · 계획 · 첨부 · 실행 기록을 앱 데이터의 휴지통 폴더로 옮깁니다. 이미 고친 코드는 그대로 남습니다.{issue.worktree && " 반영하지 않은 워크트리는 함께 지웁니다."}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>취소</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() =>
								void attempt(async () => {
									await api.issueDelete(p, id);
									// 카드에서 지웠어도 그 이슈의 상세 창이 열려 있으면 닫는다.
									const ui = useUi.getState();
									if (ui.issueId === id) ui.openIssue(null);
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

/** 주 동작을 메뉴 항목으로. 부르는 곳의 바쁨 표시(`act`)로 감싼다. */
export function primaryItem(primary: Primary | null, act: (fn: () => Promise<unknown>) => void, busy: boolean): Action | false {
	return primary ? { label: primary.label, icon: primary.icon, destructive: primary.destructive, disabled: busy || primary.disabled, onSelect: () => act(primary.call) } : false;
}
