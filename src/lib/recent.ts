import { useUi } from "./store";

export type RecentKind = "issue" | "talk" | "deliverable";

export interface Recent {
	projectId: string;
	kind: RecentKind;
	id: string;
}

const KEY = "docket.recent";
const MAX = 10;

export function recentItems(): Recent[] {
	try {
		const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		return Array.isArray(v) ? v : [];
	} catch {
		return [];
	}
}

function push(r: Recent) {
	const next = [r, ...recentItems().filter((x) => !(x.kind === r.kind && x.id === r.id))].slice(0, MAX);
	try {
		localStorage.setItem(KEY, JSON.stringify(next));
	} catch {
		// 저장소를 못 쓰면 팔레트의 「최근」이 비어 보일 뿐이다.
	}
}

/**
 * 연 이슈 · 대화 · 산출물을 Ctrl+K 팔레트의 「최근」에 쌓는다.
 * 여는 쪽(보드 카드 · 알림함 · 실행 목록 · 팔레트)마다 기록하지 않고 열린 id 의 변화를 듣는다 — 새 여는 길이 생겨도 빠지지 않게.
 * 아직 만들지 않은 새 대화의 id 도 들어오지만, 팔레트가 목록에 없는 id 를 걸러 낸다.
 */
useUi.subscribe((s, prev) => {
	// 대화 탭 · 옆 칸의 대화는 사이드바 프로젝트와 따로 움직여 제 프로젝트 id 를 든다(앱 대화 · 다른 프로젝트 대화).
	if (s.talk && s.talk.id !== prev.talk?.id) push({ ...s.talk, kind: "talk" });
	if (s.dock.talk && s.dock.talk.id !== prev.dock.talk?.id) push({ ...s.dock.talk, kind: "talk" });
	if (!s.projectId) return;
	if (s.issueId && s.issueId !== prev.issueId) push({ projectId: s.projectId, kind: "issue", id: s.issueId });
	if (s.deliverableId && s.deliverableId !== prev.deliverableId) push({ projectId: s.projectId, kind: "deliverable", id: s.deliverableId });
});
