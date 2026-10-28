import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RunEnvelope, RunEvent } from "./types";

export type View = "board" | "deliverables" | "talks" | "knowledge" | "claude" | "settings";

interface Ui {
	projectId: string | null;
	view: View;
	issueId: string | null;
	deliverableId: string | null;
	/** 대화 화면에서 연 대화. 아직 만들지 않은 새 대화면 화면이 정한 id 다. */
	talkId: string | null;
	/** Claude 설정에서 보는 프로젝트. null 이면 전역. 사이드바의 현재 프로젝트와 따로 움직인다 — 설정을 둘러보고 보드로 돌아와도 보던 프로젝트가 그대로 있게. */
	claudeProjectId: string | null;
	/** 설정 창을 연 프로젝트. 창은 프로젝트 머리에 있지만 사이드바 우클릭에서도 연다. */
	editingProjectId: string | null;
	setProject: (id: string | null) => void;
	setView: (v: View) => void;
	setClaudeProject: (id: string | null) => void;
	/** 그 프로젝트(null 이면 전역)를 고른 채 Claude 설정을 연다. */
	openClaude: (id: string | null) => void;
	openIssue: (id: string | null) => void;
	openDeliverable: (id: string | null) => void;
	openTalk: (id: string | null) => void;
	editProject: (id: string | null) => void;
}

// 마지막으로 본 프로젝트와 화면(Claude 설정의 범위 포함)만 기억한다. 열어 둔 이슈까지 되살리면 시작할 때 엉뚱한 창이 뜬다.
export const useUi = create<Ui>()(
	persist(
		(set) => ({
			projectId: null,
			view: "board",
			issueId: null,
			deliverableId: null,
			talkId: null,
			claudeProjectId: null,
			editingProjectId: null,
			setProject: (projectId) => set({ projectId, issueId: null, deliverableId: null, talkId: null }),
			setView: (view) => set({ view }),
			setClaudeProject: (claudeProjectId) => set({ claudeProjectId }),
			openClaude: (claudeProjectId) => set({ claudeProjectId, view: "claude" }),
			openIssue: (issueId) => set({ issueId }),
			openDeliverable: (deliverableId) => set({ deliverableId }),
			openTalk: (talkId) => set({ talkId }),
			editProject: (editingProjectId) => set({ editingProjectId }),
		}),
		{ name: "docket-ui", partialize: (s) => ({ projectId: s.projectId, view: s.view, claudeProjectId: s.claudeProjectId }) },
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

/** 실행 중 사건은 화면에만 둔다. 지난 실행은 저장된 기록에서 다시 펼친다. */
export const useLive = create<Live>()((set) => ({
	byTarget: {},
	push: (env) =>
		set((s) => {
			const prev = s.byTarget[env.targetId];
			const cur: LiveRun = prev && prev.runId === env.runId ? prev : { runId: env.runId, events: [], activity: "" };
			const ev = env.event;
			let activity = cur.activity;
			if (ev.t === "tool") activity = [toolLabel(ev.name), ev.summary].filter(Boolean).join("  ");
			else if (ev.t === "text") activity = ev.text.split("\n")[0].slice(0, 120);
			const events = cur.events.length > 800 ? cur.events.slice(-600) : cur.events;
			return { byTarget: { ...s.byTarget, [env.targetId]: { runId: env.runId, events: [...events, ev], activity } } };
		}),
}));
