// 미리보기: Tauri 없이 브라우저에서 화면을 띄운다. 가짜 데이터로 명령에 답하고 실행 사건을 흉내 낸다.
// 쓰는 곳: preview.html (vite 개발 서버에서만 열린다). ?theme=light 로 밝은 테마, ?empty=1 로 첫 화면.
// ?dock=<대화 id>[&dockSide=left] 로 그 대화를 옆 칸에 띄운 채 연다(일반 대화는 g 로 시작한다). ?issue=<id> 로 메모 상세 창을 연다.
// ?window=quick 으로 빠른 메모 창을 연다. 실제 창 크기(460×300)로 보려면 브라우저 창을 그만큼 줄인다.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import * as fx from "./fixtures";

const q = new URLSearchParams(location.search);
const empty = q.get("empty") === "1";
const settings = { ...fx.settings, theme: (q.get("theme") as "dark" | "light") ?? fx.settings.theme };

type Args = Record<string, unknown> | undefined;
const handlers: Record<string, (a: Args) => unknown> = {
	app_info: () => fx.info,
	update_installable: () => true,
	doc_tools_check: () => fx.docTools,
	usage_get: () => (empty ? null : fx.usage),
	spend_summary: () => (empty ? { days: 7, rows: [], total: { ...fx.spend.total, calls: 0 } } : fx.spend),
	settings_get: () => settings,
	settings_save: (a) => a?.settings,
	quick_key_error: () => "",
	plugins_list: () => fx.plugins,
	// 코어 릴리즈는 새 대화를 열어 보낸다. 메뉴는 사이드바 프로젝트 우클릭에 있다.
	plugin_invoke: (a) => (a?.command === "release" ? { toast: "", open: "", copy: "", markdown: "", title: "", chat: { text: "/release" } } : fx.pluginReply),
	plugin_grant: () => settings,
	plugin_settings_get: () => ({ webhook: "https://hooks.slack.com/services/T000/B000/xxxx", mention: true }),
	plugin_settings_set: (a) => a?.values,
	plugin_inspect: () => ({ manifest: fx.plugins.plugins.find((p) => p.id === "open-in-code"), problem: "", installed: "", source: "" }),
	// 실제 명령처럼 매번 새 값을 준다. 같은 배열을 주면 react-query 가 바뀐 줄 몰라 보관이 화면에 비치지 않는다.
	projects_list: () => (empty ? [] : fx.projects.map((p) => ({ ...p }))),
	issues_list: (a) => (a?.projectId === fx.projects[0].id ? fx.issues : []),
	issue_get: (a) => fx.issues.find((i) => i.id === a?.issueId),
	talks_list: (a) => (a?.projectId === fx.projects[0].id ? fx.talks : a?.projectId === "global" && !empty ? fx.appTalks : []),
	talk_create: (a) => ({ ...fx.talks[1], projectId: a?.projectId, id: a?.talkId, title: "", runs: [], history: [], sessionId: "" }),
	talk_promote: (a) => ({ ...fx.talks[2], id: a?.talkId }),
	issue_follow_up: (a) => ({ ...fx.issues[0], id: "i0000000012", number: 12, note: a?.note, follows: { id: a?.issueId, number: 0, title: "" } }),
	app_project: () => fx.appProject,
	deliverables_list: (a) => (a?.projectId === fx.projects[0].id ? fx.deliverables : []),
	deliverable_read_text: (a) => (a?.n === 3 ? fx.docTextNext : fx.docText),
	deliverable_thumb: (a) => {
		const d = fx.deliverables.find((x) => x.id === a?.deliverableId);
		const file = d?.versions.find((v) => v.n === a?.n)?.file ?? "";
		if (file.endsWith(".md")) return { kind: "text", text: fx.docText };
		return file.endsWith(".png") ? { kind: "image", path: file } : { kind: "none" };
	},
	paths_split: (a) => ({ files: a?.paths ?? [], folders: [] }),
	deliverable_move_shelf: (a) => ({ ...fx.deliverables.find((x) => x.id === a?.deliverableId), subdir: a?.subdir }),
	deliverable_import_folder: () => ({ imported: 3, skipped: 1, failed: 0, errors: [] }),
	kb_status: (a) => (a?.projectId === fx.projects[0].id ? fx.kb : { ...fx.kb, kb: { ...fx.kb.kb, enabled: false, folders: [] }, files: [], sections: 0, cards: 0, pending: 0, indexedAt: 0, cardCostUsd: 0, progress: { running: false, stage: "", done: 0, total: 0, message: "" } }),
	kb_save: (a) => ({ ...fx.kb, kb: a?.kb }),
	db_sources_list: (a) => (a?.projectId === fx.projects[0].id ? fx.dbSources : []),
	db_sources_save: () => fx.dbSources,
	db_source_fetch: () => ({ changed: false, first: false, rows: 214, summary: "바뀐 것 없음", snapshot: fx.dbSources[0].snapshots[0] }),
	db_snapshot_compare: () => fx.dbCompare,
	kb_import: () => fx.kb,
	kb_inbox_delete: () => fx.kb,
	kb_stop: () => true,
	kb_search: () => fx.kbHits,
	kb_cards: () => fx.kbCards,
	memory_get: () => fx.memory,
	memory_save_settings: (a) => ({ ...fx.memory, enabled: (a?.memory as { enabled: boolean })?.enabled }),
	memory_digest: (a) => (a?.paths as string[])?.length ?? 0,
	memory_stop: () => true,
	glossary_get: () => fx.glossary,
	glossary_save_entries: (a) => ({ ...fx.glossary, entries: a?.entries, updatedAt: Date.now() }),
	glossary_save_settings: (a) => ({ ...fx.glossary, glossary: a?.glossary }),
	deliverable_vocab_promote: (a) => ({ deliverable: fx.deliverables[0], added: (a?.terms as string[])?.length ?? 0, merged: 0 }),
	deliverable_draft_apply: () => fx.deliverables[0],
	run_events: () => fx.savedEvents,
	issue_transcript: (a) => (a?.issueId === "i0000000004" ? fx.terminalTurns : []),
	issue_sessions: () => fx.sessions,
	project_archive: (a) => {
		const p = fx.projects.find((x) => x.id === a?.id);
		if (p) p.archivedAt = a?.archived ? Date.now() : 0;
		return p;
	},
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
	claude_run_include: (a) => ({ ...settings, runExcludes: a?.include ? [] : ["CLAUDE.md"] }),
	issue_chat_answer: (a) => {
		const t = fx.talks.find((x) => x.id === a?.issueId);
		return t && { ...t, run: t.run && { ...t.run, asks: [] } };
	},
	slash_commands: () => [
		{ name: "clear", description: "새 대화를 엽니다", source: "app" },
		{ name: "model", description: "이 대화의 모델 · effort 를 고릅니다", source: "app" },
		{ name: "compact", description: "지난 대화를 요약해 컨텍스트를 줄입니다", source: "cli" },
		{ name: "changelog", description: "바뀐 것을 CHANGELOG 형식으로 정리한다.", source: "skill" },
		{ name: "test-plan", description: "고친 코드에 맞춰 확인할 시험 목록을 만든다.", source: "skill" },
		{ name: "fix", description: "이슈 하나를 골라 끝까지 고친다", source: "command" },
	],
	project_files: (a) => ["calc.py", "cli.py", "tests/test_calc.py", "tests/test_parse.py", "README.md"].filter((f) => f.includes(String(a?.query ?? ""))),
	text_read: (a) => ({ path: a?.path, content: String(a?.path).endsWith("CLAUDE.md") ? fx.claudeMd : "---\nname: changelog\ndescription: 바뀐 것을 CHANGELOG 형식으로 정리한다.\n---\n\n# changelog\n\n1. 지난 판 뒤의 변경을 모은다.\n", modified: Date.now() - 3600_000, crlf: true, bom: false, exists: true }),
	"plugin:window|is_maximized": () => false,
	"plugin:notification|is_permission_granted": () => true,
	asset_allow: (a) => a?.path,
	deliverable_settings_save: (a) => ({ ...fx.projects.find((p) => p.id === a?.projectId), ...(a?.settings as object) }),
	naming_preview: (a) => `${String(a?.title ?? "산출물").trim().split(/\s+/).join("_")}_v${a?.n ?? 1}_20261028.md`,
};

if (q.get("dock")) {
	const id = q.get("dock")!;
	const { useUi } = await import("@/lib/store");
	useUi.getState().setDock({ open: true, side: q.get("dockSide") === "left" ? "left" : "right", talk: { projectId: id.startsWith("g") ? "global" : fx.projects[0].id, id } });
}

mockWindows(q.get("window") === "quick" ? "quick" : "main");
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
		const issue = [...fx.issues, ...fx.talks].find((i) => i.id === id);
		for (const event of events) void emit("docket://run", { projectId: issue?.projectId, target: "issue", targetId: id, runId: issue?.run?.runId, event });
	}
}, 300);

// ?issue=<id> 로 그 메모의 상세 창을 연 채 띄운다.
if (q.get("issue")) {
	const { useUi } = await import("@/lib/store");
	setTimeout(() => useUi.getState().openIssue(q.get("issue")), 400);
}

// ?talk=<대화 id> 로 대화 화면에서 그 대화를 연 채 띄운다. ?typing=<글> 이 있으면 입력칸에 넣는다(`/` · `@` 자동완성을 찍을 때).
if (q.get("talk")) {
	const { useUi } = await import("@/lib/store");
	const id = q.get("talk")!;
	useUi.getState().setView("talks");
	useUi.getState().openTalk({ projectId: id.startsWith("g") ? "global" : fx.projects[0].id, id });
	const text = q.get("typing");
	if (text)
		setTimeout(() => {
			const box = document.querySelector<HTMLTextAreaElement>("[data-composer]");
			if (!box) return;
			box.focus();
			Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(box, text);
			box.dispatchEvent(new Event("input", { bubbles: true }));
			box.setSelectionRange(text.length, text.length);
			box.dispatchEvent(new Event("select", { bubbles: true }));
		}, 700);
}

// ?newTalk=<프로젝트 id> 로 저장 전 대화의 시작 화면을 연 채 띄운다(일반 대화는 global). 대화 목록이 차 있어도 볼 수 있다.
if (q.get("newTalk")) {
	const { useUi } = await import("@/lib/store");
	useUi.getState().openNewTalk(q.get("newTalk")!);
}

// ?palette= 로 Ctrl+K 팔레트를 연 채 띄운다. 값이 있으면 검색어로 넣는다 — 브라우저 밖에서 화면을 찍을 때 키를 누를 길이 없다.
if (q.has("palette")) {
	setTimeout(() => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
		const text = q.get("palette");
		if (!text) return;
		setTimeout(() => {
			const input = document.querySelector<HTMLInputElement>("[role=combobox]");
			if (!input) return;
			// React 가 쥔 값이라 value 를 바로 바꾸면 onChange 가 오지 않는다. 원래 setter 로 넣고 input 사건을 보낸다.
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
			input.dispatchEvent(new Event("input", { bubbles: true }));
		}, 100);
	}, 600);
}
