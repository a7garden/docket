import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Draft } from "@/features/issue/ChatTab";
import { GLOBAL_PID, type RunEnvelope, type RunEvent } from "./types";

export type View = "board" | "deliverables" | "talks" | "allTalks" | "knowledge" | "glossary" | "claude" | "settings";

/** 대화 하나를 가리키는 칸. 앱 대화는 projectId 가 GLOBAL_PID 다. */
export interface TalkRef {
	projectId: string;
	id: string;
}

/**
 * 옆 칸 대화. 떠 있는 창이 아니라 본문 옆의 한 칸이다. 닫아도 마지막 대화를 기억해 Ctrl+J 로 다시 띄운다.
 * 폭 범위는 DockPane 이 지킨다.
 */
export interface Dock {
	open: boolean;
	side: "left" | "right";
	width: number;
	talk: TalkRef | null;
}

export const DOCK_WIDTH = { min: 320, max: 560, start: 380 };

interface Ui {
	projectId: string | null;
	view: View;
	issueId: string | null;
	deliverableId: string | null;
	/** 산출물을 열 때 먼저 보일 탭. 상세 창이 읽고 비운다. 실행 목록에서 작성법 뽑기를 누르면 「만드는 법」으로 연다. */
	deliverableTab: "versions" | "recipe" | "auto" | null;
	/** 대화 탭 · 「대화」 화면에서 연 대화. 앱 대화 · 다른 프로젝트 대화를 열어도 사이드바의 현재 프로젝트는 그대로 둔다. */
	talk: TalkRef | null;
	/** 「대화」 화면에서 접고 편 묶음(앱 · 프로젝트 id). 값이 없으면 묶음마다 기본값을 따른다. 앱을 끌 때까지만 기억한다. */
	talkFolded: Record<string, boolean>;
	dock: Dock;
	/** 대화마다 쓰다 만 질문. 대화가 대화 탭과 옆 칸을 오가도 남게 화면 상태에 둔다. */
	talkDrafts: Record<string, Draft>;
	/** Claude 설정에서 보는 프로젝트. null 이면 전역. 사이드바의 현재 프로젝트와 따로 움직인다 — 설정을 둘러보고 보드로 돌아와도 보던 프로젝트가 그대로 있게. */
	claudeProjectId: string | null;
	/** 설정 창을 연 프로젝트. 창은 프로젝트 머리에 있지만 사이드바 우클릭에서도 연다. */
	editingProjectId: string | null;
	/** 설정 화면을 열 때 스크롤해 갈 구획 id. 설정 화면이 그려진 뒤 읽고 비운다 — 화면이 아직 없을 때는 옮길 자리가 없다. */
	settingsSection: string | null;
	setProject:(id: string | null) => void;
	setView: (v: View) => void;
	setClaudeProject: (id: string | null) => void;
	/** 그 프로젝트(null 이면 전역)를 고른 채 Claude 설정을 연다. */
	openClaude: (id: string | null) => void;
	openIssue: (id: string | null) => void;
	openDeliverable: (id: string | null) => void;
	/** 대화 탭에서 그 대화를 고른다. 옆 칸에 띄운 대화면 옆 칸에서 빼 탭으로 가져온다. 화면은 바꾸지 않는다. */
	openTalk: (t: TalkRef | null) => void;
	setFold: (key: string, folded: boolean) => void;
	/** 그 대화를 옆 칸에 띄운다. 대화 탭에서 보던 것이어도 옆 칸이 가져간다 — 같은 대화는 한 곳에만 보인다. */
	dockTalk: (t: TalkRef) => void;
	setDock: (d: Partial<Dock>) => void;
	setDraft: (id: string, d: Draft) => void;
	/** 다른 프로젝트 · 화면에 있어도 그 이슈 · 대화 · 산출물을 연다. 실행 목록 · 알림 · 알림함이 함께 쓴다. */
	openTarget: (t: Target) => void;
	editProject: (id: string | null) => void;
	/** 설정 화면을 열고 그 구획으로 간다. */
	openSettings: (section: string | null) => void;
}

export interface Target {
	projectId: string;
	target: "issue" | "deliverable";
	id: string;
	/** 프로젝트 대화. 보드가 아니라 대화 화면으로 간다. */
	talk?: boolean;
	/** 산출물이면 먼저 보일 탭 */
	tab?: "versions" | "recipe" | "auto";
}

// 마지막으로 본 프로젝트와 화면(Claude 설정의 범위 포함)만 기억한다. 열어 둔 이슈까지 되살리면 시작할 때 엉뚱한 창이 뜬다.
export const useUi = create<Ui>()(
	persist(
		(set) => ({
			projectId: null,
			view: "board",
			issueId: null,
			deliverableId: null,
			deliverableTab: null,
			talk: null,
			talkFolded: {},
			dock: { open: false, side: "right", width: DOCK_WIDTH.start, talk: null },
			talkDrafts: {},
			claudeProjectId: null,
			editingProjectId: null,
			settingsSection: null,
			setProject: (projectId) => set((s) => ({ projectId, issueId: null, deliverableId: null, talk: s.talk && s.talk.projectId !== s.projectId ? s.talk : null })),
			setView: (view) => set({ view }),
			setClaudeProject: (claudeProjectId) => set({ claudeProjectId }),
			openClaude: (claudeProjectId) => set({ claudeProjectId, view: "claude" }),
			openIssue: (issueId) => set({ issueId }),
			openDeliverable: (deliverableId) => set({ deliverableId }),
			openTalk: (talk) =>
				set((s) => ({
					talk,
					dock: talk && s.dock.open && s.dock.talk?.id === talk.id ? { ...s.dock, open: false } : s.dock,
				})),
			dockTalk: (talk) => set((s) => ({ dock: { ...s.dock, open: true, talk } })),
			setDock: (d) => set((s) => ({ dock: { ...s.dock, ...d } })),
			setDraft: (id, d) => set((s) => ({ talkDrafts: { ...s.talkDrafts, [id]: d } })),
			setFold: (key, folded) => set((s) => ({ talkFolded: { ...s.talkFolded, [key]: folded } })),
			openTarget: ({ projectId, target, id, talk, tab }) =>
				set((s): Partial<Ui> => {
					// 옆 칸에 띄워 둔 대화는 옆 칸에서 연다. 보던 화면을 바꾸지 않는다.
					if (talk && s.dock.talk?.id === id) return { dock: { ...s.dock, open: true } };
					// 앱 대화는 프로젝트가 없다. 사이드바의 현재 프로젝트를 그대로 두고 「대화」 화면에서 연다.
					if (talk && projectId === GLOBAL_PID) return { view: "allTalks", talk: { projectId, id } };
					const base = s.projectId === projectId ? {} : { projectId, issueId: null, deliverableId: null };
					if (talk) return { ...base, view: "talks", talk: { projectId, id } };
					if (target === "deliverable") return { ...base, view: "deliverables", deliverableId: id, deliverableTab: tab ?? null };
					// 이슈 창은 산출물 화면 위에도 뜬다. 보드 · 산출물 밖에 있을 때만 보드로 옮긴다.
					return { ...base, view: s.view === "board" || s.view === "deliverables" ? s.view : "board", issueId: id };
				}),
			editProject: (editingProjectId) => set({ editingProjectId }),
			openSettings: (settingsSection) => set({ view: "settings", settingsSection }),
		}),
		// 옆 칸(열림 · 좌우 · 폭 · 띄운 대화)도 되살린다. 띄워 두고 쓰는 칸이라 다시 켤 때마다 다시 띄우게 하지 않는다.
		{ name: "docket-ui", partialize: (s) => ({ projectId: s.projectId, view: s.view, claudeProjectId: s.claudeProjectId, dock: s.dock }) },
	),
);

export interface LiveRun {
	runId: string;
	events: RunEvent[];
	activity: string;
}

interface Live {
	byTarget: Record<string, LiveRun>;
	push: (env: RunEnvelope) => void;
}

const TOOL_LABEL: Record<string, string> = {
	Read: "읽기",
	Grep: "찾기",
	Glob: "파일 찾기",
	Edit: "고치기",
	MultiEdit: "고치기",
	Write: "쓰기",
	Bash: "명령",
	PowerShell: "명령",
	WebFetch: "웹 읽기",
	WebSearch: "웹 검색",
	Task: "하위 작업",
	Agent: "하위 작업",
	Skill: "스킬",
	TodoWrite: "할 일 정리",
	StructuredOutput: "결과 정리",
};

export function toolLabel(name: string) {
	return TOOL_LABEL[name] ?? name;
}

/**
 * 실행 사건을 담는 칸의 열쇠. 작성법 뽑기는 같은 산출물의 작성과 함께 돌 수 있어 칸을 따로 둔다.
 * 한 칸에는 실행 하나만 들어가서, 같은 id 로 두면 두 실행이 서로 덮는다.
 */
export function liveKey(target: RunEnvelope["target"], id: string) {
	return target === "learn" ? `learn:${id}` : id;
}

/** 실행 중 사건은 화면에만 둔다. 지난 실행은 저장된 기록에서 다시 펼친다. */
export const useLive = create<Live>()((set) => ({
	byTarget: {},
	push: (env) =>
		set((s) => {
			const k = liveKey(env.target, env.targetId);
			const prev = s.byTarget[k];
			const cur: LiveRun = prev && prev.runId === env.runId ? prev : { runId: env.runId, events: [], activity: "" };
			const ev = env.event;
			let activity = cur.activity;
			if (ev.t === "tool") activity = [toolLabel(ev.name), ev.summary].filter(Boolean).join("  ");
			else if (ev.t === "text") activity = ev.text.split("\n")[0].slice(0, 120);
			const events = cur.events.length > 800 ? cur.events.slice(-600) : cur.events;
			return { byTarget: { ...s.byTarget, [k]: { runId: env.runId, events: [...events, ev], activity } } };
		}),
}));
