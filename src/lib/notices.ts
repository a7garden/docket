import { useEffect } from "react";
import { useQueries } from "@tanstack/react-query";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api } from "./api";
import { focusOnly, qk, useProjects, useTalks } from "./queries";
import { needsDecision } from "./status";
import type { Target } from "./store";
import { type Deliverable, GLOBAL_PID, type Issue, type Project, type RunRecord } from "./types";

/**
 * 알림함. 알림을 따로 쌓지 않고, 캐시에 있는 이슈 · 대화 · 산출물에서 「마지막 실행이 끝난 뒤 아직 열어 보지 않은 것」을 고른다.
 * 쌓아 두면 이슈를 지우거나 다른 길로 열었을 때 알림만 남아 어긋난다.
 *
 * 본 시각은 화면 쪽(localStorage)에 둔다. issue.json 에 쓰면 update_issue 가 updated_at 을 올려,
 * 열어 보기만 해도 보드의 「최근 움직인 순」과 대화 목록의 「N분 전」이 바뀐다.
 */

interface Seen {
	/** 대상 id → 마지막으로 본 시각(ms) */
	seen: Record<string, number>;
	/** 알림함을 처음 켠 시각. 이보다 먼저 끝난 실행은 본 것으로 친다 — 켜자마자 지난 실행이 모두 쏟아지지 않게. */
	since: number;
	mark: (id: string, at: number) => void;
	markAll: (ids: string[]) => void;
	/** 목록에서 사라진 대상을 걷는다. 지운 이슈의 표시가 localStorage 에 끝없이 쌓이지 않게. */
	prune: (alive: Set<string>) => void;
}

export const useSeen = create<Seen>()(
	persist(
		(set) => ({
			seen: {},
			since: Date.now(),
			mark: (id, at) => set((s) => ((s.seen[id] ?? 0) >= at ? s : { seen: { ...s.seen, [id]: Math.max(at, Date.now()) } })),
			markAll: (ids) =>
				set((s) => {
					const now = Date.now();
					const seen = { ...s.seen };
					for (const id of ids) seen[id] = now;
					return { seen };
				}),
			prune: (alive) =>
				set((s) => {
					const keys = Object.keys(s.seen);
					if (keys.every((k) => alive.has(k))) return s;
					return { seen: Object.fromEntries(keys.filter((k) => alive.has(k)).map((k) => [k, s.seen[k]])) };
				}),
		}),
		{ name: "docket-seen", partialize: (s) => ({ seen: s.seen, since: s.since }) },
	),
);

/** 마지막 실행이 끝난 시각. 돌고 있거나 사용자가 중지한 실행은 알릴 것이 아니므로 0 이다. */
export function lastEnded(runs: RunRecord[]): number {
	const r = runs[runs.length - 1];
	if (!r || r.status === "running" || r.status === "stopped") return 0;
	return r.endedAt;
}

/** 그 시각에 끝난 실행을 아직 보지 않았는가. */
export function useUnread(id: string, at: number) {
	return useSeen((s) => at > 0 && at > Math.max(s.seen[id] ?? 0, s.since));
}

/**
 * 연 화면이 부른다. 열려 있는 동안 새 실행이 끝나도 본 것으로 친다.
 * 창이 뒤에 있으면 보지 않은 것으로 두고, 창을 앞으로 가져올 때 남긴다.
 */
export function useMarkSeen(id: string | undefined, at: number, active = true) {
	useEffect(() => {
		if (!id || !active || !at) return;
		const mark = () => {
			if (document.hasFocus()) useSeen.getState().mark(id, at);
		};
		mark();
		window.addEventListener("focus", mark);
		return () => window.removeEventListener("focus", mark);
	}, [id, at, active]);
}

export type NoticeTone = "brand" | "ok" | "danger";

/** 알림이 걸리는 프로젝트 탭. 이슈 안 대화 탭의 답은 그 이슈의 알림이라 보드로 센다. */
export type NoticeView = "board" | "talks" | "deliverables";

export interface Notice extends Target {
	key: string;
	project: Project;
	view: NoticeView;
	title: string;
	/** 「답이 왔습니다」 · 「계획이 나왔습니다」 · 실패 까닭 */
	what: string;
	tone: NoticeTone;
	at: number;
}

const FAIL_LEN = 120;

/** 이슈 · 대화 하나의 알림. 알릴 것이 없으면 null 이다. */
function issueNotice(i: Issue): { what: string; tone: NoticeTone } | null {
	if (i.run) return null;
	const r = i.runs[i.runs.length - 1];
	if (!r) return null;
	if (r.status === "error" || i.error) return { what: `실패 · ${(i.error || r.error).slice(0, FAIL_LEN)}`, tone: "danger" };
	if (r.kind === "chat") return { what: "답이 왔습니다", tone: "brand" };
	// 승인하거나 완료한 뒤에는 결정할 것이 없으니 알리지 않는다.
	if (!needsDecision(i)) return null;
	if (i.status === "review") return { what: "구현이 끝났습니다", tone: "brand" };
	return { what: r.kind === "revert" ? "되돌렸습니다" : "계획이 나왔습니다", tone: "brand" };
}

/** 산출물 하나의 알림. 자동 갱신이 「반영할 것 없음」으로 건너뛰면 새 판이 없으므로 알리지 않는다. */
function deliverableNotice(d: Deliverable): { what: string; tone: NoticeTone } | null {
	if (d.job) return null;
	const r = d.runs[d.runs.length - 1];
	if (!r) return null;
	if (r.status === "error" || d.error) return { what: `작성 실패 · ${(d.error || r.error).slice(0, FAIL_LEN)}`, tone: "danger" };
	const v = d.versions[d.versions.length - 1];
	if (!v || v.addedAt < r.startedAt) return null;
	return { what: `v${v.n} 작성이 끝났습니다`, tone: "ok" };
}

/** 모든 프로젝트에서 아직 보지 않은 알림. 최근 것이 위다. 사건으로 캐시가 고쳐지므로 따로 다시 묻지 않는다. */
export function useNotices(): Notice[] {
	const { data: projects = [] } = useProjects();
	const issues = useQueries({ queries: projects.map((p) => ({ queryKey: qk.issues(p.id), queryFn: () => api.issues(p.id), ...focusOnly(p.id) })) });
	const talks = useQueries({ queries: projects.map((p) => ({ queryKey: qk.talks(p.id), queryFn: () => api.talks(p.id), ...focusOnly(p.id) })) });
	const docs = useQueries({ queries: projects.map((p) => ({ queryKey: qk.deliverables(p.id), queryFn: () => api.deliverables(p.id), ...focusOnly(p.id) })) });
	const { data: appTalks = [] } = useTalks(GLOBAL_PID);
	const { seen, since } = useSeen();

	const all = projects.map((project, n) => ({
		project,
		issues: issues[n]?.data ?? [],
		talks: talks[n]?.data ?? [],
		docs: docs[n]?.data ?? [],
	}));
	// 앱 대화는 프로젝트가 없다. 알림 줄이 쓰는 이름만 채운 칸을 둔다 — 셈은 GLOBAL_PID 로 묶여 어느 프로젝트 숫자에도 더해지지 않고 알림함과 대화 탭의 「앱」 묶음에만 보인다.
	all.push({ project: { id: GLOBAL_PID, name: "앱" } as Project, issues: [], talks: appTalks, docs: [] });

	const out: Notice[] = [];
	const unread = (id: string, at: number) => at > 0 && at > Math.max(seen[id] ?? 0, since);
	for (const { project, issues, talks, docs } of all) {
		for (const t of talks) {
			const at = lastEnded(t.runs);
			const n = unread(t.id, at) && issueNotice(t);
			const kind = project.id === GLOBAL_PID ? "앱 대화" : "대화";
			if (n) out.push({ key: `t:${t.id}`, project, view: "talks", projectId: project.id, target: "issue", id: t.id, talk: true, title: `${kind} · ${t.title || "새 대화"}`, at, ...n });
		}
		for (const i of issues) {
			const at = lastEnded(i.runs);
			const n = unread(i.id, at) && issueNotice(i);
			if (n) out.push({ key: `i:${i.id}`, project, view: "board", projectId: project.id, target: "issue", id: i.id, title: `#${i.number} ${i.title || "제목 없는 메모"}`, at, ...n });
		}
		for (const d of docs) {
			const at = lastEnded(d.runs);
			const n = unread(d.id, at) && deliverableNotice(d);
			if (n) out.push({ key: `d:${d.id}`, project, view: "deliverables", projectId: project.id, target: "deliverable", id: d.id, title: `「${d.title || "제목 없는 문서"}」`, at, ...n });
		}
	}
	return out.sort((a, b) => b.at - a.at);
}

export type NoticeCount = Record<NoticeView | "total", number>;

const NO_NOTICE: NoticeCount = { total: 0, board: 0, talks: 0, deliverables: 0 };

/**
 * 프로젝트 · 탭별 알림 수. 알림함과 같은 `useNotices()` 를 묶기만 한다 — 셈을 따로 두면 알림함 · 프로젝트 줄 · 탭 숫자가 어긋난다.
 * 돌려준 함수는 알림이 없는 프로젝트에 0 을 준다.
 */
export function useNoticeCounts(): (projectId: string) => NoticeCount {
	const notices = useNotices();
	const by = new Map<string, NoticeCount>();
	for (const n of notices) {
		const c = by.get(n.projectId) ?? { ...NO_NOTICE };
		c.total++;
		c[n.view]++;
		by.set(n.projectId, c);
	}
	return (projectId) => by.get(projectId) ?? NO_NOTICE;
}

/**
 * 목록에서 사라진 대상의 본 시각을 걷는다. 늘 떠 있는 알림함 한 곳에서만 부른다 —
 * `useNotices()` 는 사이드바 · 프로젝트 머리도 부르므로, 거기 두면 같은 정리가 부르는 곳마다 돈다.
 */
export function usePruneSeen() {
	const { data: projects = [] } = useProjects();
	const qs = useQueries({
		queries: [
			...projects.flatMap((p) => [
				{ queryKey: qk.issues(p.id) as readonly string[], queryFn: (): Promise<{ id: string }[]> => api.issues(p.id), ...focusOnly(p.id) },
				{ queryKey: qk.talks(p.id), queryFn: () => api.talks(p.id), ...focusOnly(p.id) },
				{ queryKey: qk.deliverables(p.id), queryFn: () => api.deliverables(p.id), ...focusOnly(p.id) },
			]),
			{ queryKey: qk.talks(GLOBAL_PID), queryFn: () => api.talks(GLOBAL_PID) },
		],
	});
	const prune = useSeen((s) => s.prune);
	// 모두 읽어 온 뒤에만 걷는다. 덜 읽은 때 걷으면 아직 안 온 프로젝트의 표시가 지워진다.
	const loaded = projects.length > 0 && qs.every((q) => q.isSuccess);
	const ids = loaded ? qs.flatMap((q) => (q.data as { id: string }[]).map((x) => x.id)).join(" ") : "";
	useEffect(() => {
		if (ids) prune(new Set(ids.split(" ")));
	}, [ids, prune]);
}
