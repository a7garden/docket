import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { joinPath } from "./format";
import { useAppInfo } from "./queries";
import { draftBlank, useUi } from "./store";
import { GLOBAL_PID, type Issue } from "./types";

/**
 * 첫 질문을 보내기 전의 대화. 디스크에 없어도 이슈 대화와 같은 화면을 쓰도록 빈 대화 꼴로 만든다.
 * 첨부는 저장 전에도 이 id 의 폴더에 들어가므로 dir 은 저장된 뒤의 자리와 같아야 한다.
 */
function blankTalk(projectId: string, id: string, dataRoot: string): Issue {
	const now = Date.now();
	return {
		id,
		projectId,
		number: 0,
		status: "inbox",
		autoPlan: false,
		model: "",
		effort: "",
		title: "",
		titleMode: "firstLine",
		titledAt: 0,
		createdAt: now,
		updatedAt: now,
		noteUpdatedAt: 0,
		plan: null,
		result: null,
		changes: [],
		sessionId: "",
		run: null,
		runs: [],
		history: [],
		error: "",
		talk: true,
		queue: [],
		note: "",
		attachments: [],
		dir: projectId === GLOBAL_PID ? joinPath(dataRoot, "global", "issues", id) : joinPath(dataRoot, "projects", projectId, "issues", id),
	};
}

/**
 * 대화 목록 맨 앞에 저장 전 대화를 끼우는 함수를 돌려준다. 지금 열려 있거나 쓰다 만 글 · 그림이 있을 때만 끼운다 —
 * 아무것도 쓰지 않고 다른 대화로 옮기면 줄이 저절로 사라진다.
 */
export function useWithNewTalk() {
	const { data: info } = useAppInfo();
	const shown = useUi(useShallow((s) => Object.fromEntries(Object.entries(s.newTalks).filter(([, id]) => s.talk?.id === id || !draftBlank(s.talkDrafts[id])))));
	const dataRoot = info?.dataRoot ?? "";
	const made = useMemo(() => Object.fromEntries(Object.entries(shown).map(([pid, id]) => [pid, blankTalk(pid, id, dataRoot)])), [shown, dataRoot]);
	return (pid: string, talks: Issue[]) => (made[pid] ? [made[pid], ...talks] : talks);
}

/** 아직 저장하지 않은 대화인가. 옆에 띄우기 · 지우기처럼 저장된 대화를 다루는 동작을 가린다. */
export function useIsNewTalk(talk: Issue) {
	return useUi((s) => s.newTalks[talk.projectId] === talk.id);
}
