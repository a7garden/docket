/**
 * docket 플러그인 API 1판의 타입. 앱 쪽 정의는 src-tauri/src/plugin_host/api.rs · manifest.rs 에 있고 이름을 맞춘다.
 *
 * 플러그인은 Extism 플러그인(.wasm)이다. 내보내는 함수는 둘이다.
 * - on_event   : 매니페스트 contributes.events 에 적은 사건이 일어나면 불린다. 돌려준 값은 쓰지 않는다.
 * - on_command : 매니페스트 contributes.menus 의 항목을 누르면 불린다. Reply 를 JSON 으로 돌려준다(비워도 된다).
 * 둘 다 입력은 Input 의 JSON 글 하나다 (Host.inputString()).
 */

export type Event = "planned" | "implemented" | "failed" | "reverted" | "done" | "dropped" | "deliverable";
export type Place = "issue" | "file" | "project";

export interface Input {
	apiVersion: 1;
	/** on_event 일 때만 */
	event: Event | "";
	/** on_command 일 때만. 매니페스트 메뉴의 command */
	command: string;
	/** on_command 일 때만 */
	where: Place | "";
	plugin: { id: string; version: string };
	/** issue:read 권한이 없으면 id · name 만 */
	project: { id: string; name: string; path?: string } | null;
	/** issue:read 권한이 없으면 id · number 만 */
	issue: Issue | null;
	/** deliverable 사건일 때. issue:read 권한이 없으면 id 만 */
	deliverable: { id: string; title?: string; versions?: number; latest?: string | null } | null;
	/** where: file 메뉴에서 누른 파일의 절대 경로 (issue:read) */
	file: string;
	/** 매니페스트 contributes.settings 칸의 값 */
	settings: Record<string, string | boolean>;
}

export interface Issue {
	id: string;
	number: number;
	title?: string;
	status?: "inbox" | "planning" | "planned" | "implementing" | "review" | "done" | "dropped";
	note?: string;
	sessionId?: string;
	error?: string;
	/** 이슈 폴더 (앱 데이터) */
	dir?: string;
	plan?: { title: string; summary: string; plan: string; risks: string[] } | null;
	result?: { summary: string; verification: string; followups: string[] } | null;
	/** 같은 파일은 한 줄. kind: edit · create · update */
	changes?: { path: string; rel: string; kind: string }[];
}

/** on_command 가 돌려주는 것. 화면이 그린다 — 플러그인은 화면을 직접 만지지 않는다. */
export interface Reply {
	/** 앱 안 알림 한 줄 */
	toast?: string;
	/** 기본 프로그램으로 열 경로 · http(s) 주소 (open 권한) */
	open?: string;
	/** 클립보드에 넣을 글 */
	copy?: string;
	/** 창에 띄울 마크다운. 원시 HTML 은 그리지 않는다 */
	markdown?: string;
	/** 창의 제목 */
	title?: string;
}

/**
 * 호스트 함수 (Extism 네임스페이스 extism:host/user). 입력 · 출력 모두 글(메모리 오프셋) 하나다.
 * 허락받지 않은 함수를 가져다 쓰면 플러그인이 아예 뜨지 않는다 — 쓰는 함수의 권한을 매니페스트에 적는다.
 */
export interface HostFunctions {
	/** 권한 없음. 플러그인 기록(log.jsonl)에 한 줄 남긴다 → "" */
	docket_log(text: string): "";
	/** notify → "" */
	docket_notify(text: string): "";
	/** open · 경로나 http(s) 주소 → "" */
	docket_open(target: string): "";
	/** issue:read · JSON {projectId, issueId} → Issue 의 JSON */
	docket_issue_get(req: string): string;
	/** storage · 키 → 값 (없으면 "") */
	docket_kv_get(key: string): string;
	/** storage · JSON {key, value} → "" (value 를 비우면 지운다 · 전체 1MB 까지) */
	docket_kv_set(req: string): "";
	/** process:<exe> · JSON RunRequest → JSON RunResult. 25초가 지나면 끈다 */
	docket_run(req: string): string;
}

export interface RunRequest {
	/** 매니페스트의 process:<이름> 과 같은 이름. 경로는 받지 않는다 */
	exe: string;
	args: string[];
	/** 비우면 플러그인 데이터 폴더 */
	cwd?: string;
}

export interface RunResult {
	ok: boolean;
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}
