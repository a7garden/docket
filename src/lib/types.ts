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
	/** 켠 플러그인 id. 정의는 앱 데이터의 plugins/ 에 있다. */
	enabledPlugins: string[];
	/** 플러그인마다 허락한 권한. 매니페스트가 이보다 넓으면 다시 허락받기 전에는 부르지 않는다. */
	pluginGrants: Record<string, string[]>;
	/** 지식베이스의 색인 카드 · 고르기 다듬기 · 자동 갱신 판정 모델. 비우면 제목 모델, 그것도 비면 haiku. */
	kbCardModel: string;
	/** 대화 · 다시 계획 · 수정 요청 입력칸의 보내기 키. enter 면 Shift+Enter 로 줄을 바꾼다. */
	sendKey: "ctrlEnter" | "enter";
	/** 산출물에 파일을 넣거나 새로 등록하면 작성법 · 어휘 · 형식 · 템플릿 · 이름 규칙을 뽑는다 (구현 모델) */
	recipeAuto: boolean;
	/** 켤 때와 켜 둔 동안 정해진 간격마다 새 판을 확인해 알린다. 설치는 사용자가 고른다. */
	autoUpdateCheck: boolean;
	/** 파일 산출물에서 한컴오피스로 한글 문서를 확인한다(열기 검사 · 정확한 쪽 수 · hwp 변환). 끄면 rhwp 로 본다. */
	hancomCheck: boolean;
	/** 실행이 끝났는데 창이 앞에 없으면 Windows 알림으로도 알린다. 기본 켜짐. */
	systemNotify: boolean;
}

/** 터미널 기여. 자리표시: {cwd} {claude} {session} {session_short} {title} · attach 둘째 단계부터 {out.경로} */
export interface PluginTerminal {
	exe: string;
	probe: string[];
	focus: string[];
	/** 단계마다 인자 배열 하나 */
	attach: string[][];
	launch: string[];
	hostWt: boolean;
	attachAfterLaunch: boolean;
}

/** issue: 이슈 카드 · 상세 「더 보기」 · file: 바뀐 파일 머리 · project: 사이드바 프로젝트 */
export type PluginPlace = "issue" | "file" | "project";

export interface PluginMenu {
	where: PluginPlace;
	command: string;
	label: string;
	/** changes: 바뀐 파일이 있을 때 · session: 이어 갈 세션이 있을 때 · 비우면 늘 */
	when: "" | "changes" | "session";
}

export interface PluginField {
	key: string;
	label: string;
	type: "text" | "toggle" | "select";
	options: string[];
	default: unknown;
	hint: string;
}

/** plugins/<id>/plugin.json (plugin_host/manifest.rs). 옛 정의(plugins/<id>.json)도 이 꼴로 읽어 온다. */
export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	apiVersion: number;
	description: string;
	main: string;
	permissions: string[];
	contributes: { menus: PluginMenu[]; events: string[]; settings: PluginField[]; terminal: PluginTerminal | null };
}

export interface PluginView extends PluginManifest {
	file: string;
	dir: string;
	legacy: boolean;
	/** 앱에 들어 있는 플러그인. 파일이 없고 켜고 끄기만 한다. */
	core: boolean;
	enabled: boolean;
	exePath: string;
	/** 아직 허락하지 않은 권한. 비어야 부른다. */
	missing: string[];
	/** 있으면 쓰지 않는다 */
	problem: string;
	warning: string;
	/** 최근 7일 동안 실패한 사건 · 메뉴 수 */
	failures: number;
	log: string;
}

export interface PluginList {
	dir: string;
	plugins: PluginView[];
}

export interface PluginInspect {
	manifest: PluginManifest;
	problem: string;
	/** 같은 id 로 이미 있는 것의 판 */
	installed: string;
	source: string;
}

/** 메뉴 항목을 누르면 플러그인이 돌려주는 것. 화면이 그린다. */
export interface PluginReply {
	toast: string;
	open: string;
	copy: string;
	markdown: string;
	title: string;
}

export interface AppInfo {
	dataRoot: string;
	claudeHome: string;
	claudePath: string;
	claudeVersion: string;
	version: string;
}

/** 산출물 파일 도구 점검 한 줄. required 가 없으면 그 형식을 못 만들고, optional 이 없으면 쪽 그림 확인 같은 확인이 빠진다. */
export interface DocTool {
	key: string;
	label: string;
	ok: boolean;
	detail: string;
	need: "required" | "optional";
	usedFor: string;
}

/** 플러그인의 scripts/doctor.py 가 낸 결과. install 은 빠진 Python 패키지를 까는 명령(없으면 빈 글). */
export interface DocTools {
	python: string;
	items: DocTool[];
	install: string;
	error?: string;
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

/** claude 한 번 호출이 쓴 토큰 (result 줄의 usage) */
export interface Tokens {
	input: number;
	output: number;
	cacheCreate: number;
	cacheRead: number;
}

/** 사용량 장부의 묶음 하나. group 은 plan · implement(되돌리기 포함) · chat · document · quick(제목 · 색인 카드 · 판정 · 작성법) · total */
export interface SpendRow {
	group: string;
	calls: number;
	tokens: Tokens;
	costUsd: number;
}

/** 최근 days 일 동안 이 앱이 claude 를 부른 양. 호출이 없던 묶음은 rows 에 없다 */
export interface Spend {
	days: number;
	rows: SpendRow[];
	total: SpendRow;
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
	/** 줄을 서야 할 구현을 기다리지 않고 git 워크트리에서 돌린다. parallelImpl 을 켰을 때만 먹는다. 예전 프로젝트에는 없을 수 있다. */
	worktree?: boolean;
	/** 실행마다 --add-dir 로 함께 여는 폴더(전체 경로). 계획 · 읽기 대화 · 산출물은 읽기만, 구현은 편집까지. 예전 프로젝트에는 없을 수 있다. */
	extraDirs?: string[];
	/** 산출물 네 칸. 프로젝트 저장(projectSave)은 덮지 않는다 — 산출물 화면의 deliverableSettingsSave 로만 바꾼다. */
	deliverablesDir: string;
	naming: string;
	namingUnderscore: boolean;
	archiveDir: string;
	/** 지식베이스. 프로젝트 저장(projectSave)은 이 칸을 덮지 않는다 — kbSave 로만 바꾼다. */
	kb: ProjectKb;
	/** 어휘 사전 설정. 프로젝트 저장(projectSave)은 이 칸을 덮지 않는다 — glossarySaveSettings 로만 바꾼다. */
	glossary: ProjectGlossary;
}

export type DeliverableSettings = Pick<Project, "deliverablesDir" | "naming" | "namingUnderscore" | "archiveDir">;

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
	/** 이 기능 전의 기록은 모두 0 이다 */
	tokens: Tokens;
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
	/** 이 실행이 돈 claude 세션. 옛 기록에는 없다. */
	sessionId?: string;
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
	/** 훅 사건마다 「사건 이름 · 명령 수」 */
	hooks?: string[];
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
	/** 구현이 도는 워크트리. 있으면 결과 확인 때 「반영」해야 본 작업트리에 들어간다. 예전 이슈에는 없을 수 있다. */
	worktree?: Worktree | null;
	/** 메모의 대화에서 갈라 낸 대화면 그 메모. 예전 대화에는 없다. */
	fromIssue?: IssueRef | null;
	/** 갈라 낸 뒤 아직 보내지 않았다. 첫 차례가 메모 세션을 새 세션으로 가른다. */
	forkPending?: boolean;
	/** 이 메모가 이어 받은 앞선 메모. 후속 메모는 화면이 목록에서 이 칸으로 거꾸로 찾는다. 예전 메모에는 없다. */
	follows?: IssueRef | null;
	note: string;
	attachments: string[];
	dir: string;
}

export interface IssueRef {
	id: string;
	number: number;
	title: string;
}

/** 앱 대화(프로젝트에 묶이지 않은 대화)의 예약 프로젝트 id. 서버 model.rs 의 GLOBAL_PID 와 같다. */
export const GLOBAL_PID = "global";

export interface Worktree {
	path: string;
	/** 만들 때 찍은 작업트리 사본 커밋 */
	base: string;
	at: number;
}

export interface Version {
	n: number;
	file: string;
	addedAt: number;
	note: string;
	size: number;
	source: "import" | "editor" | "claude" | "issue";
	path: string;
	/** 자동 갱신 · 밀린 변경 반영으로 쓴 판. 「검토함」을 누르기 전까지 켜져 있다 */
	review: boolean;
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

/**
 * 자동 관리 기록 한 줄. 이슈 하나가 이 산출물에 어떻게 반영됐는지다.
 * updated · skipped · unrelated · catchup 은 반영이 끝난 것, busy · failed · stopped · discarded 는 반영 대기에 남는다.
 */
export interface AutoEntry {
	at: number;
	issueId: string;
	number: number;
	verdict: "updated" | "skipped" | "unrelated" | "catchup" | "busy" | "failed" | "stopped" | "discarded";
	reason: string;
	/** updated · catchup 이면 만든 판 번호 */
	version: number;
}

/** 완료됐지만 아직 이 산출물에 반영되지 않은 이슈 */
export interface PendingIssue {
	id: string;
	number: number;
	title: string;
	doneAt: number;
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
	job: { runId: string; phase: Phase; request: string; queuedAt: number; issueId?: string; catchUp?: string[] } | null;
	error: string;
	runs: RunRecord[];
	guide: string;
	naming: string;
	subdir: string;
	/** 이슈를 완료하면 그 변경과 관련 있는지 가려 새 판을 쓴다 */
	autoUpdate: boolean;
	/** 마지막 자동 갱신 결과 한 줄 */
	autoLast: string;
	/** 자동 관리 기록. 오래된 것부터 최근 50건 */
	autoLog: AutoEntry[];
	/** 반영 대기 이슈. 자동 갱신을 켜고 판이 있는 산출물만 센다 */
	pending: PendingIssue[];
	/** 작성법 — 템플릿 · 지난 판에서 뽑은 구성 · 문체 · 표기 규칙 (마크다운) */
	skill: string;
	vocab: Term[];
	/** 결과 파일 형식(확장자). 비우면 템플릿을 따른다 */
	format: string;
	/** refs 안에서 템플릿으로 쓸 파일 이름 */
	template: string;
	/** 작성법 뽑기. 동시에 둘까지만 돌아 그 밖은 queued 로 기다린다 */
	learn: { runId: string; startedAt: number; phase: "running" | "queued" } | null;
	learnError: string;
	/** 마지막으로 끝난 뽑기의 runId. 끝난 뒤에도 그 기록을 다시 펼친다 */
	learnLastRun: string;
	learnedAt: number;
	learnCostUsd: number;
	draft: RecipeDraft;
	dir: string;
	refs: RefFile[];
	outputDir: string;
	nextName: string;
}

export type DeliverablePatch = Pick<Deliverable, "title" | "note" | "guide" | "naming" | "subdir" | "autoUpdate"> & Partial<Pick<Deliverable, "skill" | "vocab" | "format">>;

/** settings 는 settings.json(읽기 전용으로 보인다), folder 는 함께 여는 폴더 한 줄이다. */
export type ResourceKind = "instructions" | "skill" | "agent" | "command" | "rule" | "settings" | "folder";

export interface Resource {
	kind: ResourceKind;
	/** parent: 프로젝트 위 폴더의 지침 · local: settings.local.json · extra: 함께 여는 폴더 */
	scope: "global" | "parent" | "project" | "local" | "extra";
	name: string;
	description: string;
	path: string;
	dir: string;
	exists: boolean;
	files: string[];
	modified: number;
	/** docket 실행에서는 실리지 않는다 (전역 CLAUDE.md · 전역 rules) */
	excluded?: boolean;
	/** settings 일 때 그 파일의 권한 규칙 · 훅 */
	rules?: RuleSet | null;
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
	/** learn 은 산출물의 작성법 뽑기다. targetId 는 산출물 id 다 */
	target: "issue" | "deliverable" | "learn";
	targetId: string;
	runId: string;
	event: RunEvent;
}
