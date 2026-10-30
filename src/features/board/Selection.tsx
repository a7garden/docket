import { type MouseEvent, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { api, errorText } from "@/lib/api";
import { useUi } from "@/lib/store";
import type { Issue } from "@/lib/types";

/**
 * 보드 카드 여러 개 고르기. Ctrl(맥은 Cmd) 클릭은 하나를 넣거나 빼고, Shift 클릭은 마지막으로 누른 카드부터 범위를 고른다.
 * `order` 는 보드가 그리는 순서 그대로다(열 왼쪽→오른쪽, 열 안에서 위→아래). 범위를 이 순서로 잘라야 화면에서 본 대로 골라진다.
 * 거르기 · 지우기로 `order` 에서 빠진 카드는 고른 목록에서도 저절로 빠진다 — 안 보이는 카드가 함께 지워지면 안 된다.
 */
export function useBoardSelection(order: Issue[]) {
	const [raw, setRaw] = useState<string[]>([]);
	const [anchor, setAnchor] = useState("");
	const ids = useMemo(() => order.map((i) => i.id), [order]);
	const picked = useMemo(() => {
		const shown = new Set(ids);
		return raw.filter((id) => shown.has(id));
	}, [raw, ids]);
	const set = useMemo(() => new Set(picked), [picked]);

	const toggle = (id: string, e: Pick<MouseEvent, "shiftKey">) => {
		const from = ids.indexOf(anchor);
		const to = ids.indexOf(id);
		if (e.shiftKey && from >= 0 && to >= 0) {
			setRaw([...new Set([...picked, ...ids.slice(Math.min(from, to), Math.max(from, to) + 1)])]);
		} else {
			setRaw(set.has(id) ? picked.filter((x) => x !== id) : [...picked, id]);
			setAnchor(id);
		}
	};
	const all = () => setRaw(ids);
	const clear = () => {
		setRaw([]);
		setAnchor("");
	};
	return { issues: order.filter((i) => set.has(i.id)), count: picked.length, has: (id: string) => set.has(id), toggle, all, clear };
}

/** 실행 중인 이슈는 지우지 않는다. 백엔드도 거절하지만 미리 빼야 실패로 보이지 않는다. */
export const deletable = (i: Issue) => !i.run;
/** 하나짜리 메뉴의 「보류」와 같은 조건이다 (issueActions). */
export const droppable = (i: Issue) => !i.run && i.status !== "dropped" && i.status !== "done";

/** 하나씩 차례로 부른다. 동시에 부르면 같은 프로젝트 파일을 한꺼번에 고쳐 서로 덮을 수 있다. */
async function each(issues: Issue[], fn: (i: Issue) => Promise<unknown>) {
	const failed: string[] = [];
	for (const i of issues) {
		try {
			await fn(i);
		} catch (e) {
			failed.push(`#${i.number} ${errorText(e)}`);
		}
	}
	return failed;
}

const WORDS = {
	drop: { done: "보류했습니다", fail: "보류하지 못했습니다", none: "보류할 수 있는 메모가 없습니다" },
	delete: { done: "지웠습니다", fail: "지우지 못했습니다", none: "지울 수 있는 메모가 없습니다" },
};

/** 끝난 뒤 한 번만 알린다. 카드마다 토스트를 띄우면 수십 개가 쌓인다. */
function report(what: keyof typeof WORDS, done: number, skipped: string, failed: string[]) {
	const w = WORDS[what];
	if (failed.length) toast.error(`${failed.length}개를 ${w.fail}`, { description: failed.slice(0, 5).join("\n") });
	if (done) toast(`${done}개를 ${w.done}`, { description: skipped || undefined });
	else if (!failed.length) toast(w.none, { description: skipped || undefined });
}

export async function dropMany(issues: Issue[]) {
	const targets = issues.filter(droppable);
	const skipped = issues.length - targets.length;
	const failed = await each(targets, (i) => api.issueDrop(i.projectId, i.id));
	report("drop", targets.length - failed.length, skipped ? `실행 중 · 완료 · 이미 보류한 ${skipped}개는 뺐습니다.` : "", failed);
}

async function deleteMany(issues: Issue[]) {
	const failed = await each(issues, async (i) => {
		await api.issueDelete(i.projectId, i.id);
		// 지운 이슈의 상세 창이 열려 있으면 닫는다. 하나짜리 지우기와 같다.
		const ui = useUi.getState();
		if (ui.issueId === i.id) ui.openIssue(null);
	});
	return failed;
}

/** 여러 개 지우기 확인 창. 하나짜리 지우기 창과 같은 말을 쓰고, 빼는 것이 있으면 그 수를 덧붙인다. */
export function BulkDeleteConfirm({ issues, open, onOpenChange, onDone }: { issues: Issue[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
	const targets = issues.filter(deletable);
	const running = issues.length - targets.length;
	const numbers = targets.map((i) => `#${i.number}`);
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="pop">
				<AlertDialogHeader>
					<AlertDialogTitle>메모 {targets.length}개를 지울까요?</AlertDialogTitle>
					<AlertDialogDescription>
						메모 · 계획 · 첨부 · 실행 기록을 앱 데이터의 휴지통 폴더로 옮깁니다. 이미 고친 코드는 그대로 남습니다.
						{running > 0 && ` 실행 중인 ${running}개는 빼고 지웁니다.`}
					</AlertDialogDescription>
					<p className="mono text-[12px] leading-relaxed break-all text-subtle">
						{numbers.slice(0, 20).join(" · ")}
						{numbers.length > 20 && ` 외 ${numbers.length - 20}개`}
					</p>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>취소</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={targets.length === 0}
						onClick={() =>
							void deleteMany(targets).then((failed) => {
								report("delete", targets.length - failed.length, running ? `실행 중인 ${running}개는 뺐습니다.` : "", failed);
								onDone();
							})
						}
					>
						지우기
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
