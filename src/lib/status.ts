import type { Issue } from "./types";

export type Stage = "memo" | "plan" | "build" | "done";
export type Tone = "brand" | "run" | "danger" | "ok" | "muted";

export const STAGES: { id: Stage; label: string }[] = [
	{ id: "memo", label: "메모" },
	{ id: "plan", label: "계획" },
	{ id: "build", label: "구현" },
	{ id: "done", label: "완료" },
];

export function stageOf(i: Issue): Stage | "dropped" {
	switch (i.status) {
		case "inbox":
			return "memo";
		case "planning":
		case "planned":
			return "plan";
		case "implementing":
		case "review":
			return "build";
		case "done":
			return "done";
		case "dropped":
			return "dropped";
	}
}

/** 카드 · 상세 머리에 붙는 상태 한 줄. 사용자가 결정할 차례면 brand 다. */
export function stateOf(i: Issue): { label: string; tone: Tone } | null {
	if (i.run) {
		if (i.run.phase === "queued") return { label: "대기 중", tone: "muted" };
		const label = { plan: "계획 세우는 중", chat: "답하는 중", revert: "되돌리는 중" }[i.run.kind as string] ?? "구현 중";
		return { label, tone: "run" };
	}
	if (i.error) return { label: "실패", tone: "danger" };
	switch (i.status) {
		case "planned":
			return { label: "승인 대기", tone: "brand" };
		case "review":
			return { label: "결과 확인", tone: "brand" };
		case "done":
			return { label: "완료", tone: "muted" };
		case "dropped":
			return { label: "보류", tone: "muted" };
		default:
			return null;
	}
}

export function needsDecision(i: Issue) {
	return !i.run && !i.error && (i.status === "planned" || i.status === "review");
}

export const HISTORY_LABEL: Record<string, string> = {
	created: "메모를 붙임",
	titled: "제목 지음",
	plan: "계획 요청",
	replan: "다시 계획 요청",
	planned: "계획 나옴",
	approve: "승인",
	implemented: "구현 끝",
	rework: "수정 요청",
	chat: "질문",
	session: "세션 바꿈",
	revert: "되돌리기 요청",
	reverted: "되돌림",
	done: "완료",
	drop: "보류",
	reopen: "다시 엶",
	stop: "중지",
	overlap: "파일 겹침",
	worktree: "워크트리",
	merged: "반영",
	"merge-conflict": "반영 못 함",
	error: "실패",
	memo: "메모 등록",
	deliverable: "산출물 자동 갱신",
};

export const RUN_KIND_LABEL: Record<string, string> = {
	plan: "계획",
	implement: "구현",
	document: "문서 작성",
	chat: "대화",
	revert: "되돌리기",
};
