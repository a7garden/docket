// Rust 쪽 model.rs 와 짝을 이룬다. 한쪽을 바꾸면 다른 쪽도 바꾼다.

export type Status = "inbox" | "planning" | "planned" | "implementing" | "review" | "done" | "dropped";
export type RunKind = "plan" | "implement" | "document" | "chat" | "revert";
export type Phase = "queued" | "running";

export interface Settings {
	claudePath: string;
	/** 실행별 모델. 비우면 CLI 기본값이다. 메모에서 고른 모델이 이보다 앞선다. 산출물 작성은 구현 모델을 쓴다. */
	planModel: string;
	implModel: string;
	chatModel: string;
	/** 실행별 effort(low · medium · high · xhigh · max). 비우면 --effort 를 넘기지 않는다. 메모에서 고른 effort 가 앞선다. */
	planEffort: string;
	implEffort: string;
	chatEffort: string;
	autoPlan: boolean;
	autoPlanDelaySec: number;
	/** 새 메모의 제목을 지을 모델. 비우면 첫 줄을 제목으로 쓴다. */
	titleModel: string;
	titleDelaySec: number;
	useMcp: boolean;
	theme: "system" | "dark" | "light";
	/** 켠 플러그인 id. 정의는 앱 데이터의 plugins/*.json 에 있다. */
	enabledPlugins: string[];
	/** 지식베이스의 색인 카드 · 고르기 다듬기 · 자동 갱신 판정 모델. 비우면 제목 모델, 그것도 비면 haiku. */
	kbCardModel: string;
	/** 대화 · 다시 계획 · 수정 요청 입력칸의 보내기 키. enter 면 Shift+Enter 로 줄을 바꾼다. */
	sendKey: "ctrlEnter" | "enter";
	/** 산출물에 파일을 넣거나 새로 등록하면 작성법 · 어휘 · 형식 · 템플릿 · 이름 규칙을 뽑는다 (구현 모델) */
	recipeAuto: boolean;
}

/** plugins/*.json 의 정의. 자리표시: {cwd} {claude} {session} {session_short} {title} · attach 둘째 단계부터 {out.경로} */
export interface Plugin {
	id: string;
	name: string;
	kind: string;
	exe: string;
	probe: string[];
	focus: string[];
	/** 단계마다 인자 배열 하나 */
	attach: string[][];
	launch: string[];
	hostWt: boolean;
	attachAfterLaunch: boolean;
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

/** 구독 사용률의 창 하나. key 는 claude 가 붙인 이름 그대로다 (five_hour · seven_day …). */
export interface UsageWindow {
	key: string;
	/** 쓴 비율 0~1 */
	utilization: number;
	/** 다시 차는 시각(유닉스 초). 모르면 0 */
	resetsAt: number;
	status: string;
}

/** 실행이 돌 때 claude 가 함께 보내 온 마지막 사용률 */
export interface Usage {
	windows: UsageWindow[];
	status: string;
	overage: boolean;
	/** 받은 시각(ms) */
	seenAt: number;
}

export interface Project {
	id: string;
	name: string;
	path: string;
	createdAt: number;
	nextNumber: number;
	implMode: "acceptEdits" | "bypassPermissions";
	allowedTools: string[];
	deniedTools: string[];
	planVcsRead: boolean;
	/** 계획에 적힌 파일이 겹치지 않는 구현을 함께 돌린다 */
	parallelImpl: boolean;
	deliverablesDir: string;
	naming: string;
	namingUnderscore: boolean;
	archiveDir: string;
	/** 지식베이스. 프로젝트 저장(projectSave)은 이 칸을 덮지 않는다 — kbSave 로만 바꾼다. */
	kb: ProjectKb;
	/** 어휘 사전 설정. 프로젝트 저장(projectSave)은 이 칸을 덮지 않는다 — glossarySaveSettings 로만 바꾼다. */
	glossary: ProjectGlossary;
}

export interface ProjectGlossary {
	enabled: boolean;
	/** 함께 쓸 다른 프로젝트의 id */
	include: string[];
}

export interface GlossaryEntry {
	term: string;
	meaning: string;
	aliases: string[];
}

export interface GlossaryView {
	glossary: ProjectGlossary;
	/** 저장할 때 돌려보낸다. 그 사이 다른 곳에서 저장했으면 거절된다. */
	updatedAt: number;
	entries: GlossaryEntry[];
	others: { id: string; name: string; count: number }[];
	/** 다른 프로젝트에서 함께 쓰는 용어. from 은 그 프로젝트 이름이다. */
	shared: (GlossaryEntry & { from: string })[];
}

export interface ProjectKb {
	enabled: boolean;
	/** 복사하지 않고 그 자리를 훑는 폴더(전체 경로) */
	folders: string[];
	includeDeliverables: boolean;
	topK: number;
	rerank: boolean;
	/** 넣지 않을 것. 전체 경로면 그 파일 · 폴더 아래, 아니면 참조 폴더 · 넣은 자료 안의 폴더 · 파일 이름에 그 말이 든 것 */
	exclude: string[];
	/** 판 묶기에서 빠졌지만 「다시 넣기」로 되살린 파일(전체 경로) */
	keep: string[];
}

/** 지식베이스에서 찾은 구획. 실행 기록에 남은 것은 excerpt 가 비어 있다. */
export interface KbHit {
	path: string;
	textPath: string;
	source: "folder" | "inbox" | "deliverable";
	label: string;
	section: string;
	why: string;
	excerpt: string;
	score: number;
}

export interface KbCard {
	summary: string;
	keywords: string[];
	aliases: string[];
	questions: string[];
}

export interface KbFileView {
	path: string;
	source: "folder" | "inbox" | "deliverable";
	label: string;
	size: number;
	sections: number;
	cards: number;
	/** 비어 있지 않으면 색인하지 않은 까닭 */
	skipped: string;
	/** exclude: 제외 목록에 걸림 · version: 새 판이 있어 뺌(판 묶기) */
	held: "" | "exclude" | "version";
	/** 판 묶기에서 「다시 넣기」로 되살린 파일 */
	kept: boolean;
	cardError: string;
}

export interface KbProgress {
	running: boolean;
	/** scan: 훑는 중 · cards: 카드를 만드는 중 */
	stage: "" | "scan" | "cards";
	done: number;
	total: number;
	message: string;
}

export interface KbView {
	kb: ProjectKb;
	dir: string;
	inboxDir: string;
	exts: string[];
	files: KbFileView[];
	sections: number;
	cards: number;
	pending: number;
	indexedAt: number;
	cardCostUsd: number;
	truncated: boolean;
	cardModel: string;
	progress: KbProgress;
}

export interface KbSection {
	heading: string;
	card: KbCard | null;
	excerpt: string;
}

export interface RunState {
	kind: RunKind;
	phase: Phase;
	runId: string;
	queuedAt: number;
	/** 줄에서 무엇을 기다리는지. 비면 기본 문구를 보인다. */
	waitFor?: string;
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
	/** 이 실행에 넘긴 effort. 비면 CLI 기본값으로 돌았다. */
	effort: string;
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
	/** 지식베이스에서 찾아 프롬프트에 붙인 구획. 옛 기록에는 없다. */
	kbHits?: KbHit[];
	/** 어휘 사전에서 프롬프트에 붙인 용어. 다른 프로젝트 것은 「용어 · 프로젝트」 꼴이다. 옛 기록에는 없다. */
	glossaryTerms?: string[];
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

export type TitleMode = "firstLine" | "auto" | "manual";

/** 실행이 끝나기를 기다리는 질문 하나. 넣을 때의 읽기 전용 여부와 첨부를 따로 든다. */
export interface QueuedChat {
	id: string;
	text: string;
	edit: boolean;
	images: string[];
	at: number;
}

export interface Issue {
	id: string;
	projectId: string;
	number: number;
	status: Status;
	autoPlan: boolean;
	/** 이 메모의 계획 · 구현 · 대화에 쓸 모델. 비우면 설정의 실행별 모델을 따른다. */
	model: string;
	/** 이 메모에 쓸 effort. 비우면 설정의 실행별 effort 를 따른다. */
	effort: string;
	title: string;
	/** firstLine: 메모 첫 줄 (옛 이슈) · auto: 제목 모델이 짓는다 · manual: 손으로 고쳤다 */
	titleMode: TitleMode;
	/** 제목을 지을 때 읽은 메모의 noteUpdatedAt. 이보다 메모가 새로우면 짓는 중이다. */
	titledAt: number;
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
	/** 메모 없이 프로젝트에서 연 대화. 보드에 나오지 않고 번호가 0 이다. 예전 이슈에는 없을 수 있다. */
	talk?: boolean;
	/** 실행 중에 보낸 질문. 실행이 끝나면 한 차례로 묶여 나간다. 중지했으면 남는다. 예전 이슈에는 없을 수 있다. */
	queue?: QueuedChat[];
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
	/** Deliverable.template 이 이 파일이다 */
	template: boolean;
}

/** 산출물에서 쓸 말. avoid 는 같은 뜻이지만 쓰지 않을 말이다. */
export interface Term {
	term: string;
	avoid: string[];
	note: string;
}

/** 값이 이미 있는 칸에 들어갈 뽑은 값. 빈 칸 · 빈 목록이면 제안이 없다. */
export interface RecipeDraft {
	skill: string;
	vocab: Term[];
	format: string;
	naming: string;
	template: string;
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
	/** issueId: 이슈를 완료해 자동 갱신으로 시작했으면 그 이슈 */
	job: { runId: string; phase: Phase; request: string; queuedAt: number; issueId?: string } | null;
	error: string;
	runs: RunRecord[];
	guide: string;
	naming: string;
	subdir: string;
	mode: "md" | "file";
	/** 이슈를 완료하면 그 변경과 관련 있는지 가려 새 판을 쓴다 */
	autoUpdate: boolean;
	/** 마지막 자동 갱신 결과 한 줄 */
	autoLast: string;
	/** 작성법 — 템플릿 · 지난 판에서 뽑은 구성 · 문체 · 표기 규칙 (마크다운) */
	skill: string;
	vocab: Term[];
	/** 결과 파일 형식(확장자). 비우면 템플릿을 따른다 */
	format: string;
	/** refs 안에서 템플릿으로 쓸 파일 이름 */
	template: string;
	learn: { runId: string; startedAt: number } | null;
	learnError: string;
	learnedAt: number;
	learnCostUsd: number;
	draft: RecipeDraft;
	dir: string;
	refs: RefFile[];
	outputDir: string;
	nextName: string;
}

export type DeliverablePatch = Pick<Deliverable, "title" | "note" | "guide" | "naming" | "subdir" | "mode" | "autoUpdate"> & Partial<Pick<Deliverable, "skill" | "vocab" | "format">>;

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
