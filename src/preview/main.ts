// 미리보기: Tauri 없이 브라우저에서 화면을 띄운다. 가짜 데이터로 명령에 답하고 실행 사건을 흉내 낸다.
// 쓰는 곳: preview.html (vite 개발 서버에서만 열린다). ?theme=light 로 밝은 테마, ?empty=1 로 첫 화면.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import * as fx from "./fixtures";

const q = new URLSearchParams(location.search);
const empty = q.get("empty") === "1";
const settings = { ...fx.settings, theme: (q.get("theme") as "dark" | "light") ?? fx.settings.theme };

type Args = Record<string, unknown> | undefined;
const handlers: Record<string, (a: Args) => unknown> = {
	app_info: () => fx.info,
	settings_get: () => settings,
	settings_save: (a) => a?.settings,
	plugins_list: () => fx.plugins,
	plugin_create_preset: () => fx.plugins.plugins[0].file,
	projects_list: () => (empty ? [] : fx.projects),
	issues_list: (a) => (a?.projectId === fx.projects[0].id ? fx.issues : []),
	issue_get: (a) => fx.issues.find((i) => i.id === a?.issueId),
	deliverables_list: (a) => (a?.projectId === fx.projects[0].id ? fx.deliverables : []),
	deliverable_read_text: () => fx.docText,
	run_events: () => fx.savedEvents,
	issue_transcript: (a) => (a?.issueId === "i0000000004" ? fx.terminalTurns : []),
	issue_sessions: () => fx.sessions,
	project_allow: (a) => ({ ...fx.projects[0], allowedTools: [...fx.projects[0].allowedTools, ...((a?.rules as string[]) ?? [])] }),
	permissions_suggest: () => [
		{ rule: "Bash(python -m pytest:*)", why: "Python 시험" },
		{ rule: "Bash(pytest:*)", why: "Python 시험" },
		{ rule: "Bash(python -m py_compile:*)", why: "Python 문법 확인" },
	],
	permissions_view: () => [
		{ scope: "global", path: "C:\\Users\\me\\.claude\\settings.json", exists: true, defaultMode: "auto", allow: ["Bash(jq:*)"], deny: ["Bash(svn commit:*)", "Bash(svn ci:*)", "Bash(svn add:*)", "Bash(svn delete:*)", "Bash(svn update:*)", "Bash(svn revert:*)", "Bash(svn merge:*)", "Bash(svn switch:*)"], ask: [] },
		{ scope: "project", path: "D:\\work\\calc\\.claude\\settings.json", exists: false, defaultMode: "", allow: [], deny: [], ask: [] },
		{ scope: "local", path: "D:\\work\\calc\\.claude\\settings.local.json", exists: false, defaultMode: "", allow: [], deny: [], ask: [] },
	],
	resources_list: () => fx.resources,
	text_read: (a) => ({ path: a?.path, content: String(a?.path).endsWith("CLAUDE.md") ? fx.claudeMd : "---\nname: changelog\ndescription: 바뀐 것을 CHANGELOG 형식으로 정리한다.\n---\n\n# changelog\n\n1. 지난 판 뒤의 변경을 모은다.\n", modified: Date.now() - 3600_000, crlf: true, bom: false, exists: true }),
	"plugin:window|is_maximized": () => false,
	asset_allow: (a) => a?.path,
	naming_preview: (a) => `${String(a?.title ?? "산출물").trim().split(/\s+/).join("_")}_v${a?.n ?? 1}_20261028.md`,
};

mockWindows("main");
mockIPC((cmd, args) => handlers[cmd]?.(args as Args) ?? null, { shouldMockEvents: true });

// 첨부 · 캡처 그림 자리에 회색 판을 넣는다. 실제 파일을 읽을 길이 없다.
const placeholder =
	"data:image/svg+xml;utf8," +
	encodeURIComponent(
		"<svg xmlns='http://www.w3.org/2000/svg' width='640' height='400'><rect width='640' height='400' fill='#2a3140'/><rect x='24' y='24' width='592' height='40' rx='6' fill='#3a4356'/><rect x='24' y='88' width='280' height='288' rx='6' fill='#343c4d'/><rect x='328' y='88' width='288' height='136' rx='6' fill='#343c4d'/></svg>",
	);
(window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc = () => placeholder;

await import("../main");

// 실행 중인 이슈에 실시간 사건을 흘린다.
const { emit } = await import("@tauri-apps/api/event");
setTimeout(() => {
	for (const [id, events] of Object.entries(fx.liveEvents)) {
		const issue = fx.issues.find((i) => i.id === id);
		for (const event of events) void emit("docket://run", { projectId: issue?.projectId, target: "issue", targetId: id, runId: issue?.run?.runId, event });
	}
}, 300);
