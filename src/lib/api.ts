import { invoke } from "@tauri-apps/api/core";
import type {
	AppInfo,
	Deliverable,
	DeliverablePatch,
	Issue,
	KbHit,
	KbSection,
	KbView,
	PluginList,
	Project,
	ProjectKb,
	Resource,
	ResourceKind,
	RuleSet,
	RunEvent,
	SessionInfo,
	Settings,
	Suggestion,
	TextFile,
	Turn,
	Usage,
} from "./types";

// Rust 명령 이름과 인자를 한 곳에 모은다. 화면 코드는 invoke 를 직접 부르지 않는다.
export const api = {
	appInfo: () => invoke<AppInfo>("app_info"),
	usage: () => invoke<Usage | null>("usage_get"),
	settingsGet: () => invoke<Settings>("settings_get"),
	settingsSave: (settings: Settings) => invoke<Settings>("settings_save", { settings }),
	open: (path: string) => invoke<void>("path_open", { path }),
	reveal: (path: string) => invoke<void>("path_reveal", { path }),
	plugins: () => invoke<PluginList>("plugins_list"),
	pluginCreatePreset: (id: string) => invoke<string>("plugin_create_preset", { id }),

	projects: () => invoke<Project[]>("projects_list"),
	projectAdd: (path: string) => invoke<Project>("project_add", { path }),
	projectSave: (project: Project) => invoke<Project>("project_save", { project }),
	projectRemove: (id: string, deleteData: boolean) => invoke<void>("project_remove", { id, deleteData }),
	projectAllow: (projectId: string, rules: string[]) => invoke<Project>("project_allow", { projectId, rules }),
	permissionsView: (projectId: string) => invoke<RuleSet[]>("permissions_view", { projectId }),
	permissionsSuggest: (projectId: string) => invoke<Suggestion[]>("permissions_suggest", { projectId }),
	namingPreview: (projectId: string, pattern: string, title: string, n: number, underscore?: boolean) =>
		invoke<string>("naming_preview", { projectId, pattern, title, n, underscore: underscore ?? null }),

	issues: (projectId: string) => invoke<Issue[]>("issues_list", { projectId }),
	issue: (projectId: string, issueId: string) => invoke<Issue>("issue_get", { projectId, issueId }),
	/** model 을 비우면 설정의 실행별 모델을 따른다. */
	issueCreate: (projectId: string, issueId: string, note: string, autoPlan: boolean, model: string) =>
		invoke<Issue>("issue_create", { projectId, issueId, note, autoPlan, model }),
	/** 프로젝트 대화. 보내기 · 중지 · 터미널 · 첨부 · 지우기는 issue* 를 그대로 쓴다. */
	talks: (projectId: string) => invoke<Issue[]>("talks_list", { projectId }),
	talkCreate: (projectId: string, talkId: string) => invoke<Issue>("talk_create", { projectId, talkId }),
	issueSaveNote:(projectId: string, issueId: string, note: string) =>
		invoke<Issue>("issue_save_note", { projectId, issueId, note }),
	/** 비우면 다시 제목 모델에 맡긴다. */
	issueSetTitle: (projectId: string, issueId: string, title: string) =>
		invoke<Issue>("issue_set_title", { projectId, issueId, title }),
	issueSetAutoPlan: (projectId: string, issueId: string, on: boolean) =>
		invoke<Issue>("issue_set_auto_plan", { projectId, issueId, on }),
	/** 비우면 설정의 실행별 모델을 따른다. 다음 실행부터 쓰인다. */
	issueSetModel: (projectId: string, issueId: string, model: string) =>
		invoke<Issue>("issue_set_model", { projectId, issueId, model }),
	issuePlan: (projectId: string, issueId: string, feedback?: string) =>
		invoke<Issue>("issue_plan", { projectId, issueId, feedback: feedback || null }),
	issueApprove: (projectId: string, issueId: string, instruction?: string, allowAll = false) =>
		invoke<Issue>("issue_approve", { projectId, issueId, instruction: instruction || null, allowAll }),
	issueRework: (projectId: string, issueId: string, feedback: string, allowAll = false) =>
		invoke<Issue>("issue_rework", { projectId, issueId, feedback, allowAll }),
	runsStopAll: () => invoke<number>("runs_stop_all"),
	issueRevert: (projectId: string, issueId: string) => invoke<Issue>("issue_revert", { projectId, issueId }),
	issueChat: (projectId: string, issueId: string, text: string, edit: boolean, images: string[] = []) =>
		invoke<Issue>("issue_chat", { projectId, issueId, text, edit, images }),
	issueOpenTerminal: (projectId: string, issueId: string) => invoke<void>("issue_open_terminal", { projectId, issueId }),
	issueTranscript: (projectId: string, issueId: string) => invoke<Turn[]>("issue_transcript", { projectId, issueId }),
	issueSessions: (projectId: string) => invoke<SessionInfo[]>("issue_sessions", { projectId }),
	issueSetSession: (projectId: string, issueId: string, sessionId: string) =>
		invoke<Issue>("issue_set_session", { projectId, issueId, sessionId }),
	issueComplete: (projectId: string, issueId: string) => invoke<Issue>("issue_complete", { projectId, issueId }),
	issueDrop: (projectId: string, issueId: string) => invoke<Issue>("issue_drop", { projectId, issueId }),
	issueReopen: (projectId: string, issueId: string) => invoke<Issue>("issue_reopen", { projectId, issueId }),
	issueClearError: (projectId: string, issueId: string) => invoke<Issue>("issue_clear_error", { projectId, issueId }),
	issueStop: (projectId: string, issueId: string) => invoke<Issue>("issue_stop", { projectId, issueId }),
	issueDelete: (projectId: string, issueId: string) => invoke<void>("issue_delete", { projectId, issueId }),

	/** 이미지는 날 바이트로 보낸다. id 는 머리글로 싣는다. */
	attachmentSave: (projectId: string, issueId: string, bytes: Uint8Array, ext: string) =>
		invoke<string>("attachment_save", bytes, { headers: { "x-project": projectId, "x-issue": issueId, "x-ext": ext } }),
	attachmentImport: (projectId: string, issueId: string, paths: string[]) =>
		invoke<string[]>("attachment_import", { projectId, issueId, paths }),
	attachmentDelete: (projectId: string, issueId: string, name: string) =>
		invoke<void>("attachment_delete", { projectId, issueId, name }),
	/** 프로젝트 안 그림 파일 하나를 asset 범위에 연다. 연 실제 경로를 돌려주고, 열지 않았으면 빈 글자다. */
	assetAllow: (path: string) => invoke<string>("asset_allow", { path }),

	runEvents: (projectId: string, target: "issue" | "deliverable", targetId: string, runId: string) =>
		invoke<RunEvent[]>("run_events", { projectId, target, targetId, runId }),

	deliverables: (projectId: string) => invoke<Deliverable[]>("deliverables_list", { projectId }),
	deliverableImport: (projectId: string, paths: string[], deliverableId?: string) =>
		invoke<Deliverable[]>("deliverable_import", { projectId, paths, deliverableId: deliverableId ?? null }),
	deliverableCreate: (projectId: string, title: string) => invoke<Deliverable>("deliverable_create", { projectId, title }),
	deliverableRefsAdd: (projectId: string, deliverableId: string, paths: string[]) =>
		invoke<Deliverable>("deliverable_refs_add", { projectId, deliverableId, paths }),
	deliverableRefDelete: (projectId: string, deliverableId: string, name: string) =>
		invoke<Deliverable>("deliverable_ref_delete", { projectId, deliverableId, name }),
	deliverableCreateDoc: (projectId: string, title: string, content: string) =>
		invoke<Deliverable>("deliverable_create_doc", { projectId, title, content }),
	deliverableSaveDoc: (projectId: string, deliverableId: string, content: string, newVersion: boolean, note = "") =>
		invoke<Deliverable>("deliverable_save_doc", { projectId, deliverableId, content, newVersion, note }),
	deliverableReadText: (projectId: string, deliverableId: string, n: number) =>
		invoke<string>("deliverable_read_text", { projectId, deliverableId, n }),
	deliverableVersionPath: (projectId: string, deliverableId: string, n: number) =>
		invoke<string>("deliverable_version_path", { projectId, deliverableId, n }),
	deliverableUpdate: (projectId: string, deliverableId: string, patch: DeliverablePatch) =>
		invoke<Deliverable>("deliverable_update", { projectId, deliverableId, patch }),
	deliverableClearError: (projectId: string, deliverableId: string) =>
		invoke<Deliverable>("deliverable_clear_error", { projectId, deliverableId }),
	deliverableDelete: (projectId: string, deliverableId: string) =>
		invoke<void>("deliverable_delete", { projectId, deliverableId }),
	deliverableGenerate: (projectId: string, request: string, deliverableId?: string) =>
		invoke<Deliverable>("deliverable_generate", { projectId, request, deliverableId: deliverableId ?? null }),
	deliverableStop: (projectId: string, deliverableId: string) =>
		invoke<void>("deliverable_stop", { projectId, deliverableId }),
	deliverableFromIssue: (projectId: string, issueId: string) =>
		invoke<Deliverable>("deliverable_from_issue", { projectId, issueId }),

	kbStatus: (projectId: string) => invoke<KbView>("kb_status", { projectId }),
	kbSave: (projectId: string, kb: ProjectKb) => invoke<KbView>("kb_save", { projectId, kb }),
	/** 파일 · 폴더를 앱 데이터의 kb/inbox/ 로 복사한다. */
	kbImport: (projectId: string, paths: string[]) => invoke<KbView>("kb_import", { projectId, paths }),
	kbInboxDelete: (projectId: string, path: string) => invoke<KbView>("kb_inbox_delete", { projectId, path }),
	kbReindex: (projectId: string) => invoke<void>("kb_reindex", { projectId }),
	kbStop: (projectId: string) => invoke<boolean>("kb_stop", { projectId }),
	kbSearch: (projectId: string, query: string) => invoke<KbHit[]>("kb_search", { projectId, query }),
	kbCards: (projectId: string, path: string) => invoke<KbSection[]>("kb_cards", { projectId, path }),

	resources: (projectId?: string | null) => invoke<Resource[]>("resources_list", { projectId: projectId ?? null }),
	textRead: (path: string) => invoke<TextFile>("text_read", { path }),
	textWrite: (file: TextFile, content: string, force = false) =>
		invoke<TextFile>("text_write", {
			path: file.path,
			content,
			crlf: file.crlf,
			bom: file.bom,
			expectedModified: file.modified,
			force,
		}),
	resourceCreate: (kind: ResourceKind, scope: "global" | "project", projectId: string | null, name: string, description: string) =>
		invoke<string>("resource_create", { kind, scope, projectId, name, description }),
	resourceDelete: (path: string) => invoke<string>("resource_delete", { path }),
};

/** Rust 쪽 오류는 문장 하나로 온다. */
export function errorText(e: unknown): string {
	if (typeof e === "string") return e;
	if (e instanceof Error) return e.message;
	return String(e);
}
