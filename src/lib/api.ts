import { invoke as rawInvoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import type {
	AppInfo,
	Deliverable,
	DocTools,
	DeliverablePatch,
	DeliverableSettings,
	GlossaryEntry,
	GlossaryView,
	Issue,
	KbHit,
	KbSection,
	KbView,
	PluginInspect,
	PluginList,
	PluginPlace,
	PluginReply,
	Project,
	ProjectGlossary,
	ProjectKb,
	Resource,
	ResourceKind,
	RuleSet,
	RunEvent,
	SessionInfo,
	Settings,
	Spend,
	Suggestion,
	TextFile,
	Turn,
	Usage,
} from "./types";

/**
 * 속도 계측. 앱을 DOCKET_PERF=1 로 켰을 때만 명령마다 왕복 시간을 performance.measure 와 콘솔에 남긴다.
 * 켜졌는지 답이 오기 전의 명령(앱을 켤 때 몰리는 목록 읽기)도 재야 해서, 답이 올 때까지는 모아 두었다가 함께 찍는다.
 * 시각은 창을 연 때부터 센 값이다. ms 가 없으면 그 시점에 찍은 표시(perfMark)다.
 */
let perf: boolean | null = null;
const early: { label: string; start: number; ms?: number }[] = [];
void rawInvoke<boolean>("perf_enabled")
	.then((on) => !!on)
	.catch(() => false)
	.then((on) => {
		perf = on;
		if (on) for (const e of early) record(e.label, e.start, e.ms);
		early.length = 0;
	});

function record(label: string, start: number, ms?: number) {
	if (ms === undefined) {
		performance.mark(label, { startTime: start });
		console.info(`[perf] ${label} ${start.toFixed(0)}ms`);
	} else {
		performance.measure(`invoke ${label}`, { start, duration: ms });
		console.debug(`[perf] ${label} ${ms.toFixed(1)}ms (시작 ${start.toFixed(0)}ms)`);
	}
}

function note(label: string, start: number, ms?: number) {
	if (perf) record(label, start, ms);
	else if (perf === null) early.push({ label, start, ms });
}

/** 계측이 켜졌을 때 지금 시점을 남긴다. 첫 화면이 그려진 때처럼 명령이 아닌 순간을 잴 때 쓴다. */
export function perfMark(label: string) {
	if (perf !== false) note(label, performance.now());
}

function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
	if (perf === false) return rawInvoke<T>(cmd, args, options);
	const start = performance.now();
	const done = () => note(cmd, start, performance.now() - start);
	const p = rawInvoke<T>(cmd, args, options);
	p.then(done, done);
	return p;
}

// Rust 명령 이름과 인자를 한 곳에 모은다. 화면 코드는 invoke 를 직접 부르지 않는다.
export const api = {
	appInfo: () => invoke<AppInfo>("app_info"),
	docTools: () => invoke<DocTools>("doc_tools_check"),
	usage: () => invoke<Usage | null>("usage_get"),
	spend: (days: number) => invoke<Spend>("spend_summary", { days }),
	settingsGet: () => invoke<Settings>("settings_get"),
	settingsSave: (settings: Settings) => invoke<Settings>("settings_save", { settings }),
	open: (path: string) => invoke<void>("path_open", { path }),
	reveal: (path: string) => invoke<void>("path_reveal", { path }),
	plugins: () => invoke<PluginList>("plugins_list"),
	/** 매니페스트의 권한을 허락하고 켠다 */
	pluginGrant: (id: string) => invoke<Settings>("plugin_grant", { id }),
	pluginInspect: (path: string) => invoke<PluginInspect>("plugin_inspect", { path }),
	pluginInstall: (path: string) => invoke<Settings>("plugin_install", { path }),
	pluginUninstall: (id: string) => invoke<Settings>("plugin_uninstall", { id }),
	pluginSettingsGet: (id: string) => invoke<Record<string, unknown>>("plugin_settings_get", { id }),
	pluginSettingsSet: (id: string, values: Record<string, unknown>) => invoke<Record<string, unknown>>("plugin_settings_set", { id, values }),
	pluginInvoke: (pluginId: string, command: string, place: PluginPlace, projectId: string, issueId?: string, file?: string) =>
		invoke<PluginReply>("plugin_invoke", { pluginId, command, place, projectId, issueId: issueId ?? null, file: file ?? null }),

	projects: () => invoke<Project[]>("projects_list"),
	projectAdd: (path: string) => invoke<Project>("project_add", { path }),
	projectSave: (project: Project) => invoke<Project>("project_save", { project }),
	deliverableSettingsSave: (projectId: string, settings: DeliverableSettings) => invoke<Project>("deliverable_settings_save", { projectId, settings }),
	projectRemove: (id: string, deleteData: boolean) => invoke<void>("project_remove", { id, deleteData }),
	projectAllow: (projectId: string, rules: string[]) => invoke<Project>("project_allow", { projectId, rules }),
	permissionsView: (projectId: string) => invoke<RuleSet[]>("permissions_view", { projectId }),
	permissionsSuggest: (projectId: string) => invoke<Suggestion[]>("permissions_suggest", { projectId }),
	namingPreview: (projectId: string, pattern: string, title: string, n: number, underscore?: boolean) =>
		invoke<string>("naming_preview", { projectId, pattern, title, n, underscore: underscore ?? null }),

	issues: (projectId: string) => invoke<Issue[]>("issues_list", { projectId }),
	issue: (projectId: string, issueId: string) => invoke<Issue>("issue_get", { projectId, issueId }),
	/** model · effort 를 비우면 설정의 실행별 값을 따른다. */
	issueCreate: (projectId: string, issueId: string, note: string, autoPlan: boolean, model: string, effort: string) =>
		invoke<Issue>("issue_create", { projectId, issueId, note, autoPlan, model, effort }),
	/** 이 메모에서 이어지는 새 메모를 만든다. 자동 계획은 설정을 따르고, 모델 · effort 는 앞선 메모의 것을 물려받는다. */
	issueFollowUp: (projectId: string, issueId: string, note: string) => invoke<Issue>("issue_follow_up", { projectId, issueId, note }),
	/** 프로젝트 대화. 보내기 · 중지 · 터미널 · 첨부 · 지우기는 issue* 를 그대로 쓴다. */
	talks: (projectId: string) => invoke<Issue[]>("talks_list", { projectId }),
	talkCreate: (projectId: string, talkId: string) => invoke<Issue>("talk_create", { projectId, talkId }),
	/** 메모의 대화를 같은 프로젝트의 대화로 갈라 낸다. 메모는 그대로 남는다. */
	talkPromote: (projectId: string, issueId: string, talkId: string) => invoke<Issue>("talk_promote", { projectId, issueId, talkId }),
	/** 앱 대화가 도는 가상의 프로젝트(앱 데이터 폴더 · 권한 칸). 프로젝트 목록에는 없다. */
	appProject: () => invoke<Project>("app_project"),
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
	/** 비우면 설정의 실행별 effort 를 따른다. 다음 실행부터 쓰인다. */
	issueSetEffort: (projectId: string, issueId: string, effort: string) =>
		invoke<Issue>("issue_set_effort", { projectId, issueId, effort }),
	issuePlan: (projectId: string, issueId: string, feedback?: string) =>
		invoke<Issue>("issue_plan", { projectId, issueId, feedback: feedback || null }),
	issueApprove: (projectId: string, issueId: string, instruction?: string, allowAll = false) =>
		invoke<Issue>("issue_approve", { projectId, issueId, instruction: instruction || null, allowAll }),
	issueRework: (projectId: string, issueId: string, feedback: string, allowAll = false) =>
		invoke<Issue>("issue_rework", { projectId, issueId, feedback, allowAll }),
	runsStopAll: () => invoke<number>("runs_stop_all"),
	issueRevert: (projectId: string, issueId: string) => invoke<Issue>("issue_revert", { projectId, issueId }),
	/** 워크트리에서 끝난 구현을 본 작업트리에 옮긴다. 합치지 못하면 아무것도 쓰지 않고 오류를 낸다. */
	issueMerge: (projectId: string, issueId: string) => invoke<Issue>("issue_merge", { projectId, issueId }),
	issueChat: (projectId: string, issueId: string, text: string, edit: boolean, images: string[] = []) =>
		invoke<Issue>("issue_chat", { projectId, issueId, text, edit, images }),
	/** keepFiles 는 고치려고 입력칸으로 되돌릴 때 첨부를 남긴다. */
	issueQueueRemove: (projectId: string, issueId: string, queueId: string, keepFiles = false) =>
		invoke<Issue>("issue_queue_remove", { projectId, issueId, queueId, keepFiles }),
	issueQueueSend: (projectId: string, issueId: string) => invoke<Issue>("issue_queue_send", { projectId, issueId }),
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

	runEvents: (projectId: string, target: "issue" | "deliverable" | "learn", targetId: string, runId: string) =>
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
	/** 반영 대기 이슈 가운데 고른 것을 한 번에 반영한 새 판을 쓴다. 10건까지 */
	deliverableCatchUp: (projectId: string, deliverableId: string, issueIds: string[]) =>
		invoke<Deliverable>("deliverable_catch_up", { projectId, deliverableId, issueIds }),
	/** keep 이면 검토 표지만 지우고, 아니면 그 판을 휴지통으로 옮긴다 */
	deliverableVersionReview: (projectId: string, deliverableId: string, n: number, keep: boolean) =>
		invoke<Deliverable>("deliverable_version_review", { projectId, deliverableId, n, keep }),
	deliverableFromIssue: (projectId: string, issueId: string) =>
		invoke<Deliverable>("deliverable_from_issue", { projectId, issueId }),
	deliverableLearn: (projectId: string, deliverableId: string) => invoke<Deliverable>("deliverable_learn", { projectId, deliverableId }),
	deliverableLearnStop: (projectId: string, deliverableId: string) => invoke<void>("deliverable_learn_stop", { projectId, deliverableId }),
	/** field: skill · vocab · format · naming · template · all. terms 를 주면 어휘 제안 가운데 그 말만 처리한다. */
	deliverableDraftApply: (projectId: string, deliverableId: string, field: string, apply: boolean, terms?: string[]) =>
		invoke<Deliverable>("deliverable_draft_apply", { projectId, deliverableId, field, apply, terms: terms ?? null }),
	deliverableSetTemplate: (projectId: string, deliverableId: string, name: string) =>
		invoke<Deliverable>("deliverable_set_template", { projectId, deliverableId, name }),
	/** 산출물 어휘 · 어휘 제안을 사전으로 옮긴다. added 는 새로 더한 수, merged 는 이미 있어 보탠 수다. */
	deliverableVocabPromote: (projectId: string, deliverableId: string, terms: string[]) =>
		invoke<{ deliverable: Deliverable; added: number; merged: number }>("deliverable_vocab_promote", { projectId, deliverableId, terms }),

	kbStatus: (projectId: string) => invoke<KbView>("kb_status", { projectId }),
	kbSave: (projectId: string, kb: ProjectKb) => invoke<KbView>("kb_save", { projectId, kb }),
	/** 파일 · 폴더를 앱 데이터의 kb/inbox/ 로 복사한다. */
	kbImport: (projectId: string, paths: string[]) => invoke<KbView>("kb_import", { projectId, paths }),
	kbInboxDelete: (projectId: string, path: string) => invoke<KbView>("kb_inbox_delete", { projectId, path }),
	kbReindex: (projectId: string) => invoke<void>("kb_reindex", { projectId }),
	kbStop: (projectId: string) => invoke<boolean>("kb_stop", { projectId }),
	kbSearch: (projectId: string, query: string) => invoke<KbHit[]>("kb_search", { projectId, query }),
	kbCards: (projectId: string, path: string) => invoke<KbSection[]>("kb_cards", { projectId, path }),

	glossary: (projectId: string) => invoke<GlossaryView>("glossary_get", { projectId }),
	/** 표 전체를 바꾼다. updatedAt 은 읽어 둔 값 — 그 사이 다른 곳에서 저장했으면 거절된다. */
	glossarySaveEntries: (projectId: string, entries: GlossaryEntry[], updatedAt: number) =>
		invoke<GlossaryView>("glossary_save_entries", { projectId, entries, updatedAt }),
	glossarySaveSettings: (projectId: string, glossary: ProjectGlossary) =>
		invoke<GlossaryView>("glossary_save_settings", { projectId, glossary }),

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
