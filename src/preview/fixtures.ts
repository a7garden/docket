// 미리보기 전용 가짜 데이터. 배포 빌드에는 들어가지 않는다 (preview.html 은 vite build 입력이 아니다).
import type { AppInfo, Deliverable, GlossaryView, Issue, KbHit, KbSection, KbView, PluginList, Project, Resource, RunEvent, SessionInfo, Settings, Turn, Usage } from "@/lib/types";

const now = Date.now();
const min = 60_000;
const P = "pcalc0000001";
const ROOT = "D:\\work\\calc";
const DATA = "C:\\Users\\me\\AppData\\Roaming\\docket";

export const info: AppInfo = {
	dataRoot: DATA,
	claudeHome: "C:\\Users\\me\\.claude",
	claudePath: "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe",
	claudeVersion: "2.1.311 (Claude Code)",
	version: "0.1.0",
};

export const usage: Usage = {
	windows: [
		{ key: "five_hour", utilization: 0.09, resetsAt: Math.round((now + 130 * min) / 1000), status: "allowed" },
		{ key: "seven_day", utilization: 0.83, resetsAt: Math.round((now + 3 * 1440 * min) / 1000), status: "allowed" },
	],
	status: "allowed",
	overage: false,
	seenAt: now - 4 * min,
};

export const settings: Settings = { claudePath: "", planModel: "", implModel: "", chatModel: "", planEffort: "high", implEffort: "", chatEffort: "", autoPlan: true, autoPlanDelaySec: 60, titleModel: "haiku", titleDelaySec: 5, useMcp: false, theme: "dark", enabledPlugins: ["herdr"], kbCardModel: "", sendKey: "ctrlEnter", recipeAuto: true };

const KB_OFF = { enabled: false, folders: [], includeDeliverables: true, topK: 8, rerank: false };
const GL_OFF = { enabled: false, include: [] };

export const plugins: PluginList = {
	dir: "C:\\Users\\me\\AppData\\Roaming\\docket\\plugins",
	plugins: [
		{
			id: "herdr",
			name: "herdr",
			kind: "terminal",
			exe: "herdr",
			probe: [],
			attach: [],
			launch: ["{claude}", "--resume", "{session}"],
			hostWt: true,
			note: "",
			file: "C:\\Users\\me\\AppData\\Roaming\\docket\\plugins\\herdr.json",
			enabled: true,
			exePath: "C:\\Users\\me\\.herdr\\bin\\herdr.exe",
			problem: "",
			warning: "",
		},
	],
};

export const projects: Project[] = [
	{ id: P, name: "calc", path: ROOT, createdAt: now - 3 * 86400_000, nextNumber: 12, implMode: "acceptEdits", allowedTools: [], deliverablesDir: "D:\\work\\calc\\산출물", naming: "{제목}_v{판}_{날짜}", namingUnderscore: true, archiveDir: "이전판", deniedTools: ["Bash(git push:*)", "Bash(git commit:*)", "Bash(rm -rf:*)", "Bash(svn commit:*)"], planVcsRead: true, parallelImpl: true, kb: { ...KB_OFF, enabled: true, folders: ["D:\\work\\calc\\docs"] }, glossary: { enabled: true, include: ["pdoc00000001"] } },
	{ id: "pweb00000001", name: "shop-admin", path: "D:\\work\\shop-admin", createdAt: now - 86400_000, nextNumber: 4, implMode: "acceptEdits", allowedTools: [], deliverablesDir: "", naming: "", namingUnderscore: true, archiveDir: "", deniedTools: ["Bash(git push:*)", "Bash(git commit:*)", "Bash(rm -rf:*)", "Bash(svn commit:*)"], planVcsRead: true, parallelImpl: true, kb: KB_OFF, glossary: GL_OFF },
	{ id: "pdoc00000001", name: "위키 정리", path: "D:\\work\\wiki", createdAt: now - 86400_000, nextNumber: 1, implMode: "acceptEdits", allowedTools: [], deliverablesDir: "", naming: "", namingUnderscore: true, archiveDir: "", deniedTools: ["Bash(git push:*)", "Bash(git commit:*)", "Bash(rm -rf:*)", "Bash(svn commit:*)"], planVcsRead: true, parallelImpl: true, kb: KB_OFF, glossary: GL_OFF },
];

const base = (id: string, number: number, extra: Partial<Issue>): Issue => {
	const t = extra.updatedAt ?? now - number * 9 * min;
	const note = extra.note ?? "";
	return {
		id,
		projectId: P,
		number,
		status: "inbox",
		autoPlan: false,
		model: "",
		effort: "",
		title: note.split("\n")[0].replace(/^#+\s*/, ""),
		titleMode: "auto",
		titledAt: t,
		createdAt: t - 30 * min,
		updatedAt: t,
		noteUpdatedAt: t,
		plan: null,
		result: null,
		changes: [],
		sessionId: "",
		run: null,
		runs: [],
		history: [{ at: t - 30 * min, kind: "created", text: "" }],
		error: "",
		note,
		attachments: [],
		dir: `${DATA}\\projects\\${P}\\issues\\${id}`,
		...extra,
	};
};

const planOf = (title: string, summary: string, extra: Partial<NonNullable<Issue["plan"]>> = {}) => ({
	title,
	summary,
	plan: "## 바꿀 곳\n\n1. `calc.py:9` `div` 첫 줄에 0 확인을 넣는다.\n2. 같은 꼴로 `mod` 도 막는다.\n\n## 가정\n\n호출하는 곳이 없어 반환값을 바꿔도 깨지는 곳은 없다.",
	files: [
		{ path: "calc.py", change: "div · mod 에 0 확인" },
		{ path: "tests/test_calc.py", change: "0 나누기 시험 두 개" },
	],
	risks: ["div 결과를 숫자로만 가정하는 호출부가 생기면 None 을 다뤄야 한다"],
	steps: [],
	questions: [],
	createdAt: now - 14 * min,
	runId: "r-plan",
	...extra,
});

export const issues: Issue[] = [
	base("i0000000011", 11, {
		note: "로그 레벨을 환경 변수로 바꿀 수 있게\n\nLOG_LEVEL 이 없으면 지금처럼 INFO.",
		autoPlan: true,
		updatedAt: now - 20_000,
		noteUpdatedAt: now - 20_000,
	}),
	base("i0000000010", 10, { note: "모듈 머리에 함수 목록 주석 달기", updatedAt: now - 4 * min }),
	base("i0000000009", 9, {
		note: "README 의 설치 방법이 옛 명령이다\n\npip install -e . 로 바꾸고 파이썬 3.12 이상이라고 적기",
		attachments: ["붙여넣기-20261027-101500.png"],
		updatedAt: now - 9 * min,
	}),
	base("i0000000008", 8, {
		status: "planning",
		note: "mul 이 큰 수에서 느리다\n\n10만 자리 곱셈에서 몇 초씩 걸린다.",
		run: { kind: "plan", phase: "running", runId: "r-live-plan", queuedAt: now - 2 * min },
		runs: [{ id: "r-live-plan", kind: "plan", startedAt: now - 2 * min, endedAt: 0, status: "running", costUsd: 0, durationMs: 0, numTurns: 0, model: "", effort: "", error: "", prompt: "", mode: "", allowed: [], deniedRules: [], commands: [], denials: [] }],
		// 계획이 도는 동안 넣어 둔 질문. 계획이 끝나면 한 차례로 묶여 나간다.
		queue: [
			{ id: "q1", text: "카라추바 곱셈도 후보로 같이 따져 줘", edit: false, images: [], at: now - min },
			{ id: "q2", text: "느린 지점을 잰 그림이야. 이 구간이 맞는지 봐 줘", edit: true, images: ["붙여넣기-20261027-101500.png"], at: now - 30_000 },
		],
		updatedAt: now - 2 * min,
	}),
	base("i0000000007", 7, {
		status: "planned",
		note: "곱셈 결과를 소수 둘째 자리에서 반올림",
		plan: planOf("mul 결과를 소수 둘째 자리로 반올림한다", "mul 이 round(a * b, 2) 를 돌려주게 바꾼다. 정수끼리 곱할 때도 실수가 될 수 있어 확인이 필요하다.", {
			steps: [
				{ title: "mul 이 반올림한 값을 돌려주게 바꾼다", detail: "`calc.py:6` 의 `return a * b` 를 `round(a * b, 2)` 로 바꾼다.", files: ["calc.py"] },
				{ title: "반올림 시험을 더한다", detail: "정수 · 실수 곱 각각 하나씩.", files: ["tests/test_calc.py"] },
				{
					title: "계산기 화면에 반올림 표시를 더한다",
					detail: [
						"결과 칸 옆에 「반올림」 꼬리표를 둔다. 누르면 원래 값을 펼친다.",
						"",
						"```html",
						"<!doctype html><html><head><style>body{font:14px sans-serif;margin:16px;display:flex;gap:16px}.box{flex:1;border:1px solid #8888;border-radius:8px;padding:12px}h4{margin:0 0 8px;opacity:0.65}.tag{font-size:11px;background:#88f3;padding:2px 6px;border-radius:4px;cursor:pointer}</style></head>",
						"<body><div class='box'><h4>지금</h4>결과 0.30000000000000004</div>",
						"<div class='box'><h4>바뀐 뒤</h4>결과 0.3 <span class='tag' onclick=\"document.getElementById('raw').hidden=!document.getElementById('raw').hidden\">반올림</span><div id='raw' hidden>원래 값 0.30000000000000004</div></div></body></html>",
						"```",
						"",
						"```svg",
						"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 360 80' width='360' height='80' font-family='sans-serif' font-size='13' fill='none' stroke='currentColor'>",
						"<rect x='10' y='20' width='110' height='40' rx='6'/><text x='65' y='45' text-anchor='middle' fill='currentColor' stroke='none'>a * b</text>",
						"<path d='M120 40h40m-6-5 6 5-6 5'/>",
						"<rect x='160' y='20' width='190' height='40' rx='6'/><text x='255' y='45' text-anchor='middle' fill='currentColor' stroke='none'>round(a * b, 2)</text>",
						"</svg>",
						"```",
						"",
						"![지금 화면](attachments/붙여넣기-20261027-101500.png)",
					].join("\n"),
					files: ["web/index.html"],
				},
			],
			questions: [
				{
					header: "반올림 범위",
					question: "정수끼리 곱할 때도 반올림을 거칠까요?",
					multi: false,
					options: [
						{ label: "늘 반올림", description: "결과가 늘 실수가 된다. 2 * 3 도 6.0", recommended: true },
						{ label: "실수일 때만", description: "정수끼리는 지금처럼 정수를 돌려준다", recommended: false },
					],
				},
				{
					header: "자리수",
					question: "반올림 자리수를 어디서 정할까요?",
					multi: false,
					options: [
						{ label: "2로 고정", description: "가장 단순하다", recommended: true },
						{ label: "인자로 받기", description: "mul(a, b, digits=2)", recommended: false },
						{ label: "설정 파일", description: "config 에 항목을 더한다", recommended: false },
					],
				},
			],
			files: [{ path: "calc.py", change: "mul 반환값 반올림" }],
		}),
		updatedAt: now - 12 * min,
	}),
	base("i0000000006", 6, {
		status: "planned",
		model: "opus",
		effort: "high",
		note: "div 에 0 을 넣으면 죽는다\n\nZeroDivisionError 대신 None 을 돌려주면 좋겠다.",
		plan: planOf("div · mod 의 0 나누기를 None 으로 막는다", "b 가 0 이면 None 을 돌려준다. 지금 저장소에서 div · mod 를 부르는 곳은 없다."),
		sessionId: "s1",
		runs: [{ id: "r-plan", kind: "plan", startedAt: now - 16 * min, endedAt: now - 14 * min, status: "ok", costUsd: 0.21, durationMs: 98_000, numTurns: 9, model: "claude-opus-5-5", effort: "high", error: "", prompt: "", mode: "", allowed: [], deniedRules: [], commands: [], denials: [] }],
		history: [
			{ at: now - 30 * min, kind: "created", text: "" },
			{ at: now - 16 * min, kind: "plan", text: "" },
			{ at: now - 14 * min, kind: "planned", text: "div · mod 의 0 나누기를 None 으로 막는다" },
		],
		updatedAt: now - 14 * min,
	}),
	base("i0000000005", 5, {
		status: "implementing",
		note: "sub 함수 추가",
		plan: planOf("sub 를 add 와 같은 꼴로 더한다", "calc.py 에 sub(a, b) 를 더한다."),
		run: { kind: "implement", phase: "running", runId: "r-live-impl", queuedAt: now - 3 * min },
		runs: [{ id: "r-live-impl", kind: "implement", startedAt: now - 3 * min, endedAt: 0, status: "running", costUsd: 0, durationMs: 0, numTurns: 0, model: "", effort: "", error: "", prompt: "", mode: "", allowed: [], deniedRules: [], commands: [], denials: [] }],
		changes: [
			{
				path: `${ROOT}\\calc.py`,
				rel: "calc.py",
				kind: "edit",
				runId: "r-live-impl",
				at: now - min,
				hunks: [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 6, lines: ["     return a - b", " ", "+", "+def sub(a, b):", "+    return a - b", " "] }],
			},
		],
		updatedAt: now - min,
	}),
	base("i0000000004", 4, {
		status: "review",
		note: "add 가 더하지 않고 뺀다",
		plan: planOf("add 가 빼기를 하던 오타를 고친다", "calc.py:2 의 a - b 를 a + b 로 바꾼다."),
		result: {
			summary: "`calc.py` 의 `add(a, b)` 가 `a - b` 를 돌려주던 것을 `a + b` 로 고쳤다. 다른 줄은 건드리지 않았다.",
			changed: [{ path: "calc.py", what: "2행 연산자" }],
			verification: "Read 로 calc.py 를 다시 열어 2행을 확인했다. 실행 확인은 하지 못했다. Bash 권한이 없어 `python -c` 가 거부됐다.",
			followups: ["add 시험을 tests/ 에 더할지 정하기"],
			screenshots: [
				{ path: "shots/r-impl/01-calc.png", caption: "계산기 첫 화면 · 2 + 3 의 결과가 5 로 나온다" },
				{ path: "shots/r-impl/02-history.png", caption: "계산 기록 칸" },
			],
			createdAt: now - 6 * min,
			runId: "r-impl",
		},
		changes: [
			{
				path: `${ROOT}\\calc.py`,
				rel: "calc.py",
				kind: "edit",
				runId: "r-impl",
				at: now - 7 * min,
				hunks: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3, lines: [" def add(a, b):", "-    return a - b", "+    return a + b", " "] }],
			},
			{
				path: `${ROOT}\\tests\\test_calc.py`,
				rel: "tests/test_calc.py",
				kind: "create",
				runId: "r-impl",
				at: now - 7 * min,
				hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 5, lines: ["+from calc import add", "+", "+", "+def test_add():", "+    assert add(2, 3) == 5"] }],
			},
		],
		runs: [
			{ id: "r-plan4", kind: "plan", startedAt: now - 20 * min, endedAt: now - 18 * min, status: "ok", costUsd: 0.12, durationMs: 61_000, numTurns: 6, model: "claude-opus-5-5", effort: "high", error: "", prompt: "", mode: "", allowed: [], deniedRules: [], commands: [], denials: [] },
			{ id: "r-impl", kind: "implement", startedAt: now - 8 * min, endedAt: now - 6 * min, status: "ok", costUsd: 0.18, durationMs: 83_000, numTurns: 8, model: "claude-opus-5-5", effort: "high", error: "", prompt: "", mode: "편집 · 허용 목록", allowed: [], deniedRules: ["Bash(git push:*)", "Bash(git commit:*)"], commands: ["cd \"D:/work/calc\" && python -I -c \"from calc import add; print(add(2, 3))\""], denials: [{ tool: "Bash", target: "cd \"D:/work/calc\" && python -I -c \"from calc import add; print(add(2, 3))\"", reason: "ask", suggest: ["Bash(python:*)"] }] },
			{ id: "r-chat4", kind: "chat", startedAt: now - 5 * min, endedAt: now - 4 * min, status: "ok", costUsd: 0.04, durationMs: 21_000, numTurns: 2, model: "claude-opus-5-5", effort: "high", error: "", prompt: "add 말고 다른 함수에도 같은 오타가 있나?\n있으면 어디인지만 알려 줘.", mode: "", allowed: [], deniedRules: [], commands: [], denials: [] },
		],
		sessionId: "8c1f3d52-6b7e-4a09-9d1e-2f6a4b7c0e31",
		history: [
			{ at: now - 25 * min, kind: "created", text: "" },
			{ at: now - 20 * min, kind: "plan", text: "" },
			{ at: now - 18 * min, kind: "planned", text: "add 가 빼기를 하던 오타를 고친다" },
			{ at: now - 8 * min, kind: "approve", text: "" },
			{ at: now - 6 * min, kind: "implemented", text: "" },
			{ at: now - 5 * min, kind: "chat", text: "add 말고 다른 함수에도 같은 오타가 있나?" },
		],
		updatedAt: now - 6 * min,
	}),
	base("i0000000003", 3, {
		status: "inbox",
		note: "pow 함수 추가 (음수 지수 포함)",
		error: "Claude 가 결과 없이 끝났습니다 (종료 코드 1)\nAPI Error: 529 overloaded",
		runs: [{ id: "r-fail", kind: "plan", startedAt: now - 40 * min, endedAt: now - 39 * min, status: "error", costUsd: 0, durationMs: 4_000, numTurns: 0, model: "", effort: "", error: "API Error: 529 overloaded", prompt: "", mode: "", allowed: [], deniedRules: [], commands: [], denials: [] }],
		updatedAt: now - 39 * min,
	}),
	base("i0000000002", 2, {
		status: "done",
		note: "README 에 사용법 예시 넣기",
		plan: planOf("README 에 사용 예시를 더한다", "add · mul 호출 예시를 README 에 넣는다."),
		result: { summary: "README.md 에 쓰는 법 절을 더했다.", changed: [], verification: "", followups: [], createdAt: now - 3 * 3600_000, runId: "x" },
		updatedAt: now - 3 * 3600_000,
	}),
	base("i0000000001", 1, { status: "dropped", note: "명령줄 도구로 감싸기", updatedAt: now - 86400_000 }),
];

const talkRun = (id: string, at: number, prompt: string) => ({
	id,
	kind: "chat" as const,
	startedAt: at,
	endedAt: at + 40_000,
	status: "ok" as const,
	costUsd: 0.06,
	durationMs: 40_000,
	numTurns: 4,
	model: "claude-opus-5-5",
	effort: "",
	error: "",
	prompt,
	mode: "읽기 · 이력 조회",
	allowed: [],
	deniedRules: [],
	commands: [],
	denials: [],
});

/** 프로젝트 대화. 둘째 차례에서 보드에 메모 #11 을 등록했다. */
export const talks: Issue[] = [
	base("t0000000002", 0, {
		talk: true,
		title: "로그는 어디서 찍나요?",
		sessionId: "5c1f7e2a-talk-0002",
		runs: [talkRun("r-talk-1", now - 22 * min, "로그는 어디서 찍나요?"), talkRun("r-talk-2", now - 20 * min, "레벨을 환경 변수로 바꾸는 것을 작업 메모로 등록해 줘")],
		history: [
			{ at: now - 23 * min, kind: "created", text: "" },
			{ at: now - 22 * min, kind: "chat", text: "로그는 어디서 찍나요?" },
			{ at: now - 20 * min, kind: "chat", text: "레벨을 환경 변수로 바꾸는 것을 작업 메모로 등록해 줘" },
			{ at: now - 20 * min + 41_000, kind: "memo", text: "#11 로그 레벨을 환경 변수로 바꿀 수 있게" },
		],
		updatedAt: now - 20 * min,
		dir: `${DATA}\\projects\\${P}\\issues\\t0000000002`,
	}),
	base("t0000000001", 0, { talk: true, title: "시험은 어떻게 돌리나요?", sessionId: "5c1f7e2a-talk-0001", runs: [talkRun("r-talk-0", now - 26 * 3600_000, "시험은 어떻게 돌리나요?")], updatedAt: now - 26 * 3600_000 }),
];

export const liveEvents: Record<string, RunEvent[]> = {
	i0000000008: [
		{ t: "init", model: "claude-opus-5-5", sessionId: "s8" },
		{ t: "tool", id: "a", name: "Glob", summary: "**/*.py" },
		{ t: "toolDone", id: "a", ok: true },
		{ t: "tool", id: "b", name: "Read", summary: "calc.py" },
		{ t: "toolDone", id: "b", ok: true },
		{ t: "text", text: "mul 은 파이썬 기본 곱셈을 그대로 쓴다. 느린 곳은 문자열 변환일 수 있어 호출부를 찾는다." },
		{ t: "tool", id: "c", name: "Grep", summary: "mul\\(  src" },
	],
	i0000000005: [
		{ t: "init", model: "claude-opus-5-5", sessionId: "s5" },
		{ t: "tool", id: "a", name: "Read", summary: "calc.py" },
		{ t: "toolDone", id: "a", ok: true },
		{ t: "tool", id: "b", name: "Edit", summary: "calc.py" },
		{ t: "toolDone", id: "b", ok: true },
		{ t: "change", rel: "calc.py", kind: "edit", added: 3, removed: 0 },
		{ t: "tool", id: "c", name: "Bash", summary: "pytest 로 시험 돌리기" },
	],
};

export const savedEvents: RunEvent[] = [
	{ t: "init", model: "claude-opus-5-5", sessionId: "s4" },
	{ t: "tool", id: "a", name: "Read", summary: "calc.py" },
	{ t: "toolDone", id: "a", ok: true },
	{ t: "tool", id: "b", name: "Edit", summary: "calc.py" },
	{ t: "toolDone", id: "b", ok: true },
	{ t: "change", rel: "calc.py", kind: "edit", added: 1, removed: 1 },
	{ t: "tool", id: "c", name: "Bash", summary: "python -c 로 add 확인" },
	{ t: "toolDone", id: "c", ok: false },
	{ t: "tool", id: "d", name: "StructuredOutput", summary: "" },
	{ t: "toolDone", id: "d", ok: true },
	{ t: "done", ok: true, costUsd: 0.18, durationMs: 83_000, numTurns: 8, error: "" },
];

/** 작성법을 아직 뽑지 않은 산출물의 칸 */
const NO_RECIPE = { skill: "", vocab: [], format: "", template: "", learn: null, learnError: "", learnedAt: 0, learnCostUsd: 0, draft: { skill: "", vocab: [], format: "", naming: "", template: "" } };

const SKILL_SAMPLE = `## 구성
1. 개요 — 한 문단
2. 함수 표 — 열: 함수 · 하는 일 · 인자 · 0 을 넣으면
3. 남은 일

## 문체
- 「~한다」 체 · 한 줄에 한 가지

## 표기
- 함수 이름은 \`코드\` 로 · 숫자는 아라비아 숫자`;

export const deliverables: Deliverable[] = [
	{
		id: "d0000000004",
		projectId: P,
		title: "API 명세서",
		note: "다른 팀에 넘기는 문서",
		issueId: "",
		createdAt: now - 10 * min,
		updatedAt: now - 10 * min,
		versions: [],
		job: null,
		error: "",
		runs: [],
		dir: `${DATA}\\projects\\${P}\\deliverables\\d0000000004`,
		guide: "다른 팀에 넘기는 API 명세서다. 템플릿 엑셀의 열(함수명 · 인자 · 반환값 · 설명)을 그대로 쓰고, 코드에 없는 함수는 넣지 않는다.",
		naming: "CALC_{제목}_v{판}_{날짜}",
		subdir: "API_명세서",
		mode: "file",
		autoUpdate: false,
		autoLast: "",
		...NO_RECIPE,
		format: "xlsx",
		template: "API_명세서_양식.xlsx",
		learn: { runId: "r-learn", startedAt: now - 20_000 },
		refs: [
			{ name: "API_명세서_양식.xlsx", size: 48_200, kind: "extract", textPath: "x", template: true },
			{ name: "참고_다른_프로젝트_명세서.xlsx", size: 61_900, kind: "extract", textPath: "x", template: false },
			{ name: "작성요령.hwp", size: 30_100, kind: "none", textPath: "", template: false },
		],
		outputDir: "D:\\work\\calc\\산출물\\API_명세서",
		nextName: "CALC_API_명세서_v1_20261028.md",
	},
	{
		id: "d0000000002",
		projectId: P,
		title: "이번 주 변경 요약",
		note: "주간 회의 자료",
		issueId: "",
		createdAt: now - 30 * min,
		updatedAt: now - 30 * min,
		versions: [],
		job: { runId: "r-doc", phase: "running", request: "이번 주에 바뀐 함수와 까닭을 표로", queuedAt: now - min },
		error: "",
		runs: [],
		dir: `${DATA}\\projects\\${P}\\deliverables\\d0000000002`,
		guide: "",
		naming: "",
		subdir: "",
		mode: "md",
		autoUpdate: false,
		autoLast: "",
		...NO_RECIPE,
		refs: [],
		outputDir: "D:\\work\\calc\\산출물",
		nextName: "이번_주_변경_요약_v1_20261028.md",
	},
	{
		id: "d0000000001",
		projectId: P,
		title: "함수 설명서",
		note: "README 에 붙일 표",
		issueId: "i0000000002",
		createdAt: now - 3600_000,
		updatedAt: now - 3600_000,
		versions: [
			{ n: 1, file: "함수_설명서_v1_20261027.md", addedAt: now - 2 * 3600_000, note: "", size: 812, source: "claude", path: "D:\\work\\calc\\산출물\\이전판\\함수_설명서_v1_20261027.md" },
			{ n: 2, file: "함수_설명서_v2_20261028.md", addedAt: now - 3600_000, note: "div 줄 고침", size: 905, source: "editor", path: "D:\\work\\calc\\산출물\\함수_설명서_v2_20261028.md" },
		],
		job: null,
		error: "",
		runs: [],
		dir: `${DATA}\\projects\\${P}\\deliverables\\d0000000001`,
		guide: "README 에 붙일 표. 함수마다 하는 일과 0 을 넣었을 때의 결과를 적는다. 확인하지 못한 것은 확인하지 못했다고 적는다.",
		naming: "{제목}_{날짜}",
		subdir: "",
		mode: "file",
		autoUpdate: true,
		autoLast: "#9 · v2 갱신",
		...NO_RECIPE,
		skill: SKILL_SAMPLE,
		vocab: [
			{ term: "나눗셈", avoid: ["나누기"], note: "div 함수" },
			{ term: "반환값", avoid: ["리턴값", "돌려주는 값"], note: "" },
		],
		format: "hwpx",
		template: "함수설명서_양식.hwpx",
		learnedAt: now - 3000_000,
		learnCostUsd: 0.083,
		draft: { skill: "", vocab: [{ term: "사칙연산", avoid: [], note: "add · sub · mul · div" }], format: "", naming: "{제목}_v{판}_{날짜}", template: "" },
		refs: [
			{ name: "함수설명서_양식.hwpx", size: 24_800, kind: "extract", textPath: "x", template: true },
			{ name: "지난판_회의록.pdf", size: 1_204_000, kind: "direct", textPath: "", template: false },
			{ name: "옛_양식.hwp", size: 30_100, kind: "none", textPath: "", template: false },
		],
		outputDir: "D:\\work\\calc\\산출물",
		nextName: "함수_설명서_v3_20261028.md",
	},
	{
		id: "d0000000003",
		projectId: P,
		title: "화면 캡처 모음",
		note: "",
		issueId: "",
		createdAt: now - 86400_000,
		updatedAt: now - 86400_000,
		versions: [{ n: 1, file: "캡처.png", addedAt: now - 86400_000, note: "", size: 245_000, source: "import", path: "D:\\work\\calc\\산출물\\캡처.png" }],
		job: null,
		error: "",
		runs: [],
		dir: `${DATA}\\projects\\${P}\\deliverables\\d0000000003`,
		guide: "",
		naming: "",
		subdir: "",
		mode: "md",
		autoUpdate: false,
		autoLast: "",
		...NO_RECIPE,
		refs: [],
		outputDir: "D:\\work\\calc\\산출물",
		nextName: "화면_캡처_모음_v2_20261028.md",
	},
];

/** 켠 지식베이스 하나. 카드를 만드는 중이고, 읽지 못한 파일이 섞여 있다. */
export const kb: KbView = {
	kb: projects[0].kb,
	dir: `${DATA}\\projects\\${P}\\kb`,
	inboxDir: `${DATA}\\projects\\${P}\\kb\\inbox`,
	exts: ["md", "markdown", "txt", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "htm", "sql", "docx", "xlsx", "pptx", "hwpx", "pdf"],
	files: [
		{ path: "D:\\work\\calc\\docs\\요구사항.hwpx", source: "folder", label: "", size: 182_000, sections: 14, cards: 14, skipped: "", cardError: "" },
		{ path: "D:\\work\\calc\\docs\\계산 규칙.md", source: "folder", label: "", size: 6_200, sections: 5, cards: 3, skipped: "", cardError: "" },
		{ path: `${DATA}\\projects\\${P}\\kb\\inbox\\회의록_1027.pdf`, source: "inbox", label: "", size: 1_204_000, sections: 9, cards: 0, skipped: "", cardError: "" },
		{ path: "D:\\work\\calc\\산출물\\함수_설명서_v2_20261028.md", source: "deliverable", label: "함수 설명서", size: 905, sections: 2, cards: 2, skipped: "", cardError: "" },
		{ path: "D:\\work\\calc\\docs\\옛_양식.hwp", source: "folder", label: "", size: 30_100, sections: 0, cards: 0, skipped: "지원하지 않는 형식", cardError: "" },
		{ path: "D:\\work\\calc\\docs\\스캔본.pdf", source: "folder", label: "", size: 2_400_000, sections: 0, cards: 0, skipped: "글자 없음 (스캔 PDF 일 수 있음)", cardError: "" },
	],
	sections: 30,
	cards: 19,
	pending: 11,
	indexedAt: now - 4 * min,
	cardCostUsd: 0.07,
	truncated: false,
	cardModel: "haiku",
	progress: { running: true, stage: "cards", done: 3, total: 11, message: "" },
};

export const kbHits: KbHit[] = [
	{ path: "D:\\work\\calc\\docs\\계산 규칙.md", textPath: "", source: "folder", label: "", section: "나눗셈", why: "0 으로 나눌 때 None 을 돌려주는 규칙을 다룬다.", excerpt: "## 나눗셈\n0 으로 나누면 오류 대신 None 을 돌려준다.\n호출하는 쪽이 None 을 보고 안내 문구를 띄운다.", score: 7.4 },
	{ path: "D:\\work\\calc\\docs\\요구사항.hwpx", textPath: "", source: "folder", label: "", section: "3. 계산 기능", why: "사칙연산 함수의 입력 · 출력 요구를 정리한다.", excerpt: "덧셈 · 뺄셈 · 곱셈 · 나눗셈을 제공한다.\t입력은 정수와 실수", score: 4.1 },
];

export const glossary: GlossaryView = {
	glossary: projects[0].glossary,
	updatedAt: now - 3600_000,
	entries: [
		{ term: "나눗셈", meaning: "div 함수. 0 으로 나누면 예외 대신 None 을 돌려준다", aliases: ["div", "나누기"] },
		{ term: "반올림", meaning: "소수 둘째 자리에서 반올림해 첫째 자리까지 남긴다", aliases: ["round"] },
		{ term: "계산 기록", meaning: "화면 오른쪽에 쌓이는 지난 식과 결과", aliases: ["history", "이력"] },
	],
	others: [
		{ id: "pweb00000001", name: "shop-admin", count: 0 },
		{ id: "pdoc00000001", name: "위키 정리", count: 2 },
	],
	shared: [
		{ term: "판", meaning: "산출물의 버전. v1, v2 … 로 센다", aliases: ["버전"], from: "위키 정리" },
		{ term: "회신", meaning: "검토 결과를 요청한 곳에 돌려보내는 일", aliases: ["결과 통보"], from: "위키 정리" },
	],
};

export const kbCards: KbSection[] = [
	{ heading: "나눗셈", card: { summary: "0 으로 나눌 때 None 을 돌려주는 규칙을 다룬다.", keywords: ["div", "0 나누기"], aliases: ["ZeroDivisionError", "예외 처리"], questions: ["0 으로 나누면 어떻게 되나?"] }, excerpt: "## 나눗셈\n0 으로 나누면…" },
	{ heading: "반올림", card: null, excerpt: "## 반올림\n소수 둘째 자리에서…" },
];

export const docText = "# 함수 설명서\n\n| 함수 | 하는 일 | 0 을 넣으면 |\n| - | - | - |\n| `add` | 두 수를 더한다 | 그대로 |\n| `mul` | 두 수를 곱한다 | 0 |\n| `div` | 두 수를 나눈다 | `None` |\n\n## 쓰는 법\n\n```python\nfrom calc import add\nadd(2, 3)  # 5\n```\n";

const H = info.claudeHome;
export const resources: Resource[] = [
	{ kind: "instructions", scope: "global", name: "CLAUDE.md", description: "", path: `${H}\\CLAUDE.md`, dir: "", exists: true, files: [], modified: now - 3600_000 },
	{ kind: "skill", scope: "global", name: "changelog", description: "바뀐 것을 CHANGELOG 형식으로 정리한다. 「변경 기록 써줘」 요청 때 쓴다.", path: `${H}\\skills\\changelog\\SKILL.md`, dir: `${H}\\skills\\changelog`, exists: true, files: ["SKILL.md", "template.md", "scripts/collect.mjs"], modified: now - 86400_000 },
	{ kind: "skill", scope: "global", name: "test-plan", description: "고친 코드에 맞춰 확인할 시험 목록을 만든다.", path: `${H}\\skills\\test-plan\\SKILL.md`, dir: `${H}\\skills\\test-plan`, exists: true, files: ["SKILL.md"], modified: now - 2 * 86400_000 },
	{ kind: "skill", scope: "global", name: "hwpx", description: "한글 HWP/HWPX 파일의 변환 · 읽기 · 편집과 편집 가능한 .hwpx 문서 생성.", path: `${H}\\skills\\hwpx\\SKILL.md`, dir: `${H}\\skills\\hwpx`, exists: true, files: ["SKILL.md"], modified: now - 5 * 86400_000 },
	{ kind: "agent", scope: "global", name: "reviewer", description: "변경분을 리뷰한다", path: `${H}\\agents\\reviewer.md`, dir: "", exists: true, files: [], modified: now - 7 * 86400_000 },
	{ kind: "command", scope: "global", name: "fix", description: "이슈 하나를 골라 끝까지 고친다", path: `${H}\\commands\\fix.md`, dir: "", exists: true, files: [], modified: now - 7 * 86400_000 },
	{ kind: "instructions", scope: "project", name: "CLAUDE.md", description: "", path: `${ROOT}\\CLAUDE.md`, dir: "", exists: false, files: [], modified: 0 },
];

export const claudeMd =
	"# 전역 규칙\n\n이 파일은 모든 프로젝트 세션에 로드된다.\n\n## SVN 커밋 절대 금지\n\n- 금지 명령: `svn commit`, `svn add`, `svn delete`\n- 허용: 읽기 전용 조회만\n\n## 코드 스타일\n\n- **탭**으로 들여쓴다.\n- 주석은 한국어로 쓰고 왜 그렇게 했는지를 적는다.\n";

// 대화 탭: #4 를 터미널에서 이어 물은 차례와, 세션 바꾸기에 뜨는 최근 세션.
export const terminalTurns: Turn[] = [
	{
		at: now - 3 * min,
		prompt: "tests 폴더에 mul 시험도 같은 꼴로 있어?",
		events: [
			{ t: "tool", id: "t1", name: "Glob", summary: "tests/**/*.py" },
			{ t: "toolDone", id: "t1", ok: true },
			{ t: "text", text: "없습니다. `tests/test_calc.py` 에는 `test_add` 하나만 있습니다." },
		],
	},
];

export const sessions: SessionInfo[] = [
	{ id: "8c1f3d52-6b7e-4a09-9d1e-2f6a4b7c0e31", modified: now - 3 * min, turns: 4, lastPrompt: "tests 폴더에 mul 시험도 같은 꼴로 있어?" },
	{ id: "b27e90aa-1c44-4f3b-8e0d-61a9c3d5f720", modified: now - 2 * min, turns: 5, lastPrompt: "tests 폴더에 mul 시험도 같은 꼴로 있어? 그럼 하나 만들어 줘" },
	{ id: "0d93c6e1-77a2-4b5f-a0c8-9e4f12b3d6a8", modified: now - 40 * min, turns: 1, lastPrompt: "pow 함수 추가 (음수 지수 포함)" },
];
