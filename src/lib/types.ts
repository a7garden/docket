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
	/** docket 실행에서 빼는 전역 지침(~/.claude 기준 glob). 「Claude 설정」에서 항목마다 싣고 뺀다. */
	runExcludes: string[];
	/** 어디서나 빠른 메모 창을 띄우는 전역 단축키(Ctrl+Shift+Space 꼴). 비우면 듣지 않는다. */
	quickCaptureKey: string;
	/** 주 창의 닫기를 트레이로 숨기기로 받는다. 끄면 닫기가 앱을 끝낸다. */
	closeToTray: boolean;
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
	/** 그 프로젝트의 새 대화를 열고 보낼 글. 앱에 든 플러그인만 돌려준다. */
	chat?: { text: string };
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

/** 사용량 장부의 묶음 하나. group 은 plan · implement(되돌리기 포함) · chat · document · quick(제목 · 색인 카드 · 판정 · 작성법 · 기억 소화) · total */
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
	/** 보관한 시각. 0 또는 없음이면 쓰는 중이다. */
	archivedAt?: number;
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
	/** DB 자료. 프로젝트 저장(projectSave)은 이 칸을 덮지 않는다 — dbSourcesSave 로만 바꾼다. 예전 프로젝트에는 없을 수 있다. */
	dbSources?: DbSource[];
}

/** DB 자료. 앱이 명령을 돌려 탭으로 나눈 행을 받고, 지난번과 견준 변경을 산출물의 DB 트리거가 따른다. */
export interface DbSource {
	id: string;
	name: string;
	/** 표준 출력으로 탭으로 나눈 행을 내는 명령. cmd 로 돈다. Claude 에는 넘기지 않는다. */
	command: string;
	/** 명령을 돌릴 폴더. 비우면 프로젝트 폴더 */
	cwd: string;
	/** 출력 칸 이름. 비교 요약에 쓴다 */
	columns: string[];
	/** 앞에서 몇 칸이 행의 열쇠인가(스키마 · 테이블 · 컬럼이면 3) */
	keyCols: number;
	timeoutSec: number;
}

export interface SnapMeta {
	id: string;
	at: number;
	rows: number;
	/** 바로 앞 스냅숏과 견준 수. 첫 스냅숏은 0 이다 */
	added: number;
	removed: number;
	changed: number;
}

export interface DbSourceView extends DbSource {
	dir: string;
	checkedAt: number;
	error: string;
	/** 최근 것이 앞 */
	snapshots: SnapMeta[];
	busy: boolean;
	/** 이 자료를 트리거로 고른 산출물 제목 */
	usedBy: string[];
}

export interface DbFetchResult {
	/** 앞 스냅숏과 달라 새 스냅숏을 남겼다. 첫 스냅숏은 바탕이라 false */
	changed: boolean;
	first: boolean;
	rows: number;
	summary: string;
	snapshot: SnapMeta | null;
}

export type DeliverableSettings = Pick<Project, "deliverablesDir" | "naming" | "namingUnderscore" | "archiveDir">;

export type MemoryKind = "rule" | "fact" | "decision" | "reference";

export interface MemoryEntry {
	id: string;
	kind: MemoryKind;
	text: string;
	/** active: 실행에 붙는다 · pending: 승인을 기다린다 · archived: 새 항목에 밀렸다 */
	status: "active" | "pending" | "archived";
	/** 뽑아 낸 파일 이름. 직접 적었으면 비어 있다. */
	source: string;
	manual: boolean;
	createdAt: number;
	/** 승인하면 밀어낼 항목의 id */
	replaces: string;
}

export interface MemoryDigest {
	id: string;
	file: string;
	hash: string;
	at: number;
	added: number;
	pending: number;
	terms: number;
	dropped: { text: string; reason: string }[];
	costUsd: number;
	note: string;
}

export interface MemoryProgress {
	running: boolean;
	file: string;
	done: number;
	total: number;
	message: string;
}

export interface MemoryView {
	enabled: boolean;
	entries: MemoryEntry[];
	digests: MemoryDigest[];
	progress: MemoryProgress;
	glossaryEnabled: boolean;
}

export interface MemoryUsed {
	id: string;
	kind: MemoryKind;
	text: string;
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
	/** Claude 가 허락 · 답을 기다리는 도구 호출(수동 승인 · AskUserQuestion). */
	asks?: PendingAsk[];
}

/** 대화 실행이 기다리는 승인 요청 하나. AskUserQuestion 이면 input.questions 가 있다. */
export interface PendingAsk {
	requestId: string;
	tool: string;
	input: unknown;
	summary: string;
	/** 「이 대화 내내 허락」에 넣을 규칙 */
	suggest: string[];
	at: number;
}

/** 입력칸 `/` 자동완성 한 줄. app 은 앱이 받아 처리한다(/clear · /model). */
export interface SlashItem {
	name: string;
	description: string;
	source: "cli" | "skill" | "command" | "app";
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
	/** 대화 차례가 돈 모드. 이 칸이 생기기 전의 기록에는 없다. */
	chatMode?: ChatMode;
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
	/** 프롬프트에 붙인 기억 항목. 옛 기록에는 없다. */
	memoryItems?: MemoryUsed[];
	/** 마지막 응답이 읽은 문맥 크기. 옛 기록에는 없거나 0 이다. */
	contextTokens?: number;
	/** 그 모델의 창 크기. 0 이면 화면이 어림한다. */
	contextWindow?: number;
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
/** 대화 한 차례의 권한. 읽기 전용 · 수동 승인 · 자동 승인 · 권한 무시. */
export type ChatMode = "read" | "ask" | "auto" | "bypass";

export interface QueuedChat {
	id: string;
	text: string;
	mode: ChatMode;
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
 * 자동 관리 기록 한 줄. 이슈 하나(또는 DB 변경 하나)가 이 산출물에 어떻게 반영됐는지다.
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
	/** 비면 이슈. DB 변경이면 `db:<자료 id>` 이고 issueId 는 비어 있다 */
	source?: string;
	snapshot?: string;
}

/** 무엇이 바뀌면 새 판을 쓸지. 비면 수동이다. */
export const TRIGGER_CODE = "code";
export const TRIGGER_DB = "db:";

/** 아직 이 산출물에 반영되지 않은 변경. issue 면 완료된 이슈, db 면 DB 자료의 구조 변경(id 는 `db:<자료 id>`) */
export interface PendingIssue {
	id: string;
	kind: "issue" | "db";
	number: number;
	title: string;
	/** 이슈는 완료 시각, DB 는 바뀐 구조를 받은 시각 */
	doneAt: number;
	snapshot: string;
	base: string;
	/** DB: 추가 2 · 삭제 1 · 바뀜 3 */
	summary: string;
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
	job: { runId: string; phase: Phase; request: string; queuedAt: number; issueId?: string; catchUp?: string[]; db?: { source: string; name: string; snapshot: string }[]; dbCatchUp?: boolean } | null;
	error: string;
	runs: RunRecord[];
	guide: string;
	naming: string;
	subdir: string;
	/** 무엇이 바뀌면 새 판을 쓸지 — `code`(이슈 완료) · `db:<자료 id>`(DB 구조 변경). 비면 수동이다 */
	triggers: string[];
	/** 마지막 자동 갱신 결과 한 줄 */
	autoLast: string;
	/** 자동 관리 기록. 오래된 것부터 최근 50건 */
	autoLog: AutoEntry[];
	/** 반영 대기(이슈 · DB 변경). 트리거가 있고 판이 있는 산출물만 센다 */
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

/** 산출물 표지. none 이면 화면이 형식 이름을 그린 대체 표지를 보인다. */
export type Thumb = { kind: "image"; path: string } | { kind: "text"; text: string } | { kind: "none" };

export interface PathKinds {
	files: string[];
	folders: string[];
}

export interface FolderImport {
	imported: number;
	skipped: number;
	failed: number;
	errors: string[];
}

export type DeliverablePatch = Pick<Deliverable, "title" | "note" | "guide" | "naming" | "subdir"> & Partial<Pick<Deliverable, "triggers" | "skill" | "vocab" | "format">>;

/** 이 산출물이 자동 관리인가(트리거가 하나라도 있다) */
export const isAuto = (d: Pick<Deliverable, "triggers">) => (d.triggers ?? []).length > 0;

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
	/** docket 실행에서는 실리지 않는다 (설정의 runExcludes) */
	excluded?: boolean;
	/** 「docket 실행에 싣기」로 켜고 끌 수 있으면 ~/.claude 기준 경로. 전역 CLAUDE.md · rules 만 있다. */
	runKey?: string;
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
	/** 흘러 들어오는 답 글 조각. 실시간 칸에서만 오고, 완성된 text 가 오면 그것으로 바뀐다. */
	| { t: "delta"; text: string }
	| { t: "thinking"; text: string }
	| { t: "tool"; id: string; name: string; summary: string }
	| { t: "toolDone"; id: string; ok: boolean; output?: string }
	| { t: "ask"; requestId: string; tool: string; summary: string; input: unknown; suggest: string[] }
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
