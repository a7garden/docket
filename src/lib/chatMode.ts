import { useUi } from "./store";
import type { ChatMode, Issue, RunRecord } from "./types";

interface ChatModeInfo {
	value: ChatMode;
	label: string;
	/** 좁은 옆 칸에서 보이는 이름. 권한 무시는 잊지 않게 줄이지 않는다. */
	short: string;
	desc: string;
	/** 색 점 */
	dot: string;
	/** 아직 고를 수 없으면 까닭 */
	unavailable?: string;
}

export const CHAT_MODES: ChatModeInfo[] = [
	{ value: "read", label: "읽기 전용", short: "읽기", desc: "읽기 도구와 이력 조회만 엽니다", dot: "bg-run" },
	{ value: "ask", label: "수동 승인", short: "수동", desc: "허용 목록 밖의 도구는 실행 전에 묻습니다", dot: "bg-ok", unavailable: "준비 중" },
	{ value: "auto", label: "자동 승인", short: "자동", desc: "편집과 허용 목록은 묻지 않고, 목록 밖의 명령은 막습니다", dot: "bg-brand" },
	{ value: "bypass", label: "권한 무시", short: "권한 무시", desc: "명령 · 웹 · 스킬도 묻지 않습니다. 거부 규칙은 지키고, 앱을 다시 켜도 유지됩니다", dot: "bg-danger" },
];

export function chatModeInfo(mode: ChatMode) {
	return CHAT_MODES.find((m) => m.value === mode) ?? CHAT_MODES[0];
}

export const canEdit = (mode: ChatMode) => mode === "auto" || mode === "bypass";

/** 그 차례가 돈 모드. 모드가 생기기 전의 기록은 권한 이름으로 안다. */
export function runChatMode(run: RunRecord): ChatMode {
	return run.chatMode ?? (run.mode.startsWith("읽기") ? "read" : "auto");
}

/** 지금 입력칸의 모드. 고른 적 없는 대화는 지난 차례를, 처음이면 마지막에 쓴 모드를, 그것도 없으면 대화 종류의 기본값을 따른다. */
export function useChatMode(issue: Issue): ChatMode {
	const saved = useUi((s) => s.chatModes[issue.id]);
	const last = useUi((s) => s.lastChatMode);
	if (saved) return saved;
	const prev = [...issue.runs].reverse().find((r) => r.kind === "chat");
	if (prev) return runChatMode(prev);
	return last ?? (issue.talk ? "read" : "auto");
}

/** 대기열로 되돌린 질문과 지금 모드를 합친다. 넓은 쪽을 따르되 권한 무시는 둘 다 그럴 때만 남긴다. 백엔드의 묶음 규칙과 같다. */
export function mergeChatModes(a: ChatMode, b: ChatMode): ChatMode {
	if (a === b) return a;
	return canEdit(a) || canEdit(b) ? "auto" : "read";
}
