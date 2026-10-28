// Rust 쪽 model.rs 와 짝을 이룬다. 한쪽을 바꾸면 다른 쪽도 바꾼다.

export type Status = "inbox" | "planning" | "planned" | "implementing" | "review" | "done" | "dropped";
export type RunKind = "plan" | "implement" | "document" | "chat" | "revert";
export type Phase = "queued" | "running";

export interface Settings {
	claudePath: string;
	model: string;
	autoPlan: boolean;
	autoPlanDelaySec: number;
	useMcp: boolean;
	theme: "system" | "dark" | "light";
	/** 켠 플러그인 id. 정의는 앱 데이터의 plugins/*.json 에 있다. */
	enabledPlugins: string[];
}

/** plugins/*.json 의 정의. 자리표시: {cwd} {claude} {session} {title} */
export interface Plugin {
	id: string;
	name: string;
	kind: string;
	exe: string;
	probe: string[];
	attach: string[];
	launch: string[];
	hostWt: boolean;
	note: string;
}

export interface PluginView extends Plugin {
	file: string;
	enabled: boolean;
	exePath: string;
	/** 있으면 쓰지 않는다 */
	problem: string;
	warning: string;
}

export interface PluginList {
	dir: string;
	plugins: PluginView[];
}

export interface AppInfo {
	dataRoot: string;
	claudeHome: string;
	claudePath: string;
	claudeVersion: string;
	version: string;
}

export interface Project {
	id: string;
	name: string;
	path: string;
	createdAt: number;
	nextNumber: number;
	model: string;
	implMode: "acceptEdits" | "bypassPermissions";
	allowedTools: string[];
	deniedTools: string[];
	planVcsRead: boolean;
	deliverablesDir: string;
	naming: string;
	namingUnderscore: boolean;
	archiveDir: string;
}

export interface RunState {
	kind: RunKind;
	phase: Phase;
	runId: string;
	queuedAt: number;
}

export interface PlanStep {
	title: string;
	detail: string;
	files: string[];
}

/** 선택지가 없으면(옛 계획 · Claude 가 고를 답을 못 낸 질문) 글로만 답한다. */
export interface Question {
	header: string;
	question: string;
	options: { label: string; description: string; recommended: boolean }[];
	multi: boolean;
}

export interface Plan {
	title: string;
	summary: string;
	plan: string;
	steps: PlanStep[];
	files: { path: string; change: string }[];
	risks: string[];
	questions: Question[];
	createdAt: number;
	runId: string;
}

export interface ImplResult {
	summary: string;
	changed: { path: string; what: string }[];
	verification: string;
	followups: string[];
	/** 화면이 바뀐 구현에서 찍은 결과 화면. path 는 이슈 폴더 기준이다. 예전 결과에는 없다. */
	screenshots?: Shot[];
	createdAt: number;
	runId: string;
}

export interface Shot {
	path: string;
	caption: string;
}

export interface Hunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: string[];
}

export interface FileChange {
	path: string;
	rel: string;
	kind: "edit" | "create" | "update";
	hunks: Hunk[];
	runId: string;
	at: number;
}

export interface HistoryEntry {
	at: number;
	kind: string;
	text: string;
}

export interface RunRecord {
	id: string;
	kind: RunKind;
	startedAt: number;
	endedAt: number;
	status: "running" | "ok" | "error" | "stopped";
	costUsd: number;
	durationMs: number;
	numTurns: number;
	model: string;
	error: string;
	/** 대화 실행에서 사용자가 보낸 글. 다른 실행은 비어 있다. */
	prompt: string;
	/** 대화에 함께 보낸 첨부 이름(이슈 attachments/ 안). 옛 기록에는 없다. */
	images?: string[];
	/** 이 실행이 돈 권한. 옛 기록에는 비어 있다. */
	mode: string;
	allowed: string[];
	deniedRules: string[];
	commands: string[];
	denials: Denial[];
}

/** 권한 때문에 막힌 도구 호출. rule: 거부 규칙에 걸림 · ask: 허용 목록에 없음 */
export interface Denial {
	tool: string;
	target: string;
	reason: "rule" | "ask";
	suggest: string[];
}

export interface RuleSet {
	scope: "global" | "project" | "local";
	path: string;
	exists: boolean;
	defaultMode: string;
	allow: string[];
	deny: string[];
	ask: string[];
}

export interface Suggestion {
	rule: string;
	why: string;
}

export interface Issue {
	id: string;
	projectId: string;
	number: number;
	status: Status;
	autoPlan: boolean;
	title: string;
	createdAt: number;
	updatedAt: number;
	noteUpdatedAt: number;
	plan: Plan | null;
	result: ImplResult | null;
	changes: FileChange[];
	sessionId: string;
	run: RunState | null;
	runs: RunRecord[];
	history: HistoryEntry[];
	error: string;
	note: string;
	attachments: string[];
	dir: string;
}

export interface Version {
	n: number;
	file: string;
	addedAt: number;
	note: string;
	size: number;
	source: "import" | "editor" | "claude" | "issue";
	path: string;
}

export interface RefFile {
	name: string;
	size: number;
	kind: "extract" | "direct" | "none";
	textPath: string;
}

export interface Deliverable {
	id: string;
	projectId: string;
	title: string;
	note: string;
	issueId: string;
	createdAt: number;
	updatedAt: number;
	versions: Version[];
	job: { runId: string; phase: Phase; request: string; queuedAt: number } | null;
	error: string;
	runs: RunRecord[];
	guide: string;
	naming: string;
	subdir: string;
	mode: "md" | "file";
	dir: string;
	refs: RefFile[];
	outputDir: string;
	nextName: string;
}

export type DeliverablePatch = Pick<Deliverable, "title" | "note" | "guide" | "naming" | "subdir" | "mode">;

export type ResourceKind = "instructions" | "skill" | "agent" | "command" | "rule";

export interface Resource {
	kind: ResourceKind;
	scope: "global" | "project";
	name: string;
	description: string;
	path: string;
	dir: string;
	exists: boolean;
	files: string[];
	modified: number;
}

export interface TextFile {
	path: string;
	content: string;
	modified: number;
	crlf: boolean;
	bom: boolean;
	exists: boolean;
}

export type RunEvent =
	| { t: "init"; model: string; sessionId: string }
	| { t: "text"; text: string }
	| { t: "tool"; id: string; name: string; summary: string }
	| { t: "toolDone"; id: string; ok: boolean }
	| { t: "change"; rel: string; kind: string; added: number; removed: number }
	| ({ t: "denied"; id: string } & Denial)
	| { t: "done"; ok: boolean; costUsd: number; durationMs: number; numTurns: number; error: string };

/** 세션 기록에서 읽은, 앱 밖(터미널)에서 나눈 한 차례. */
export interface Turn {
	at: number;
	prompt: string;
	events: RunEvent[];
}

export interface SessionInfo {
	id: string;
	modified: number;
	turns: number;
	lastPrompt: string;
}

export interface RunEnvelope {
	projectId: string;
	target: "issue" | "deliverable";
	targetId: string;
	runId: string;
	event: RunEvent;
}
