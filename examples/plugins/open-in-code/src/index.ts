// 이슈에서 바뀐 파일을 VS Code 로 연다. 메뉴 두 곳(이슈 · 바뀐 파일 머리)에 항목을 더한다.
import type { Input, Reply, RunRequest, RunResult } from "../../docket-plugin";

const { docket_run } = Host.getFunctions();

function run(req: RunRequest): RunResult {
	const mem = Memory.fromString(JSON.stringify(req));
	return JSON.parse(Memory.find(docket_run(mem.offset)).readString());
}

function reply(r: Reply) {
	Host.outputString(JSON.stringify(r));
	return 0;
}

export function on_command() {
	const input: Input = JSON.parse(Host.inputString());
	const root = input.project?.path ?? "";
	// 새로 만든 파일도 고친 파일도 연다. 같은 파일은 앱이 한 줄로 묶어 보낸다.
	const files = input.command === "open-file" ? [input.file] : (input.issue?.changes ?? []).map((c) => c.path);
	if (files.length === 0) return reply({ toast: "열 파일이 없습니다" });
	// --reuse-window: 이미 그 폴더를 연 창이 있으면 거기서 연다. 이슈마다 창이 늘지 않게.
	const r = run({ exe: "code", args: ["--reuse-window", root, ...files], cwd: root });
	if (!r.ok && !r.timedOut) return reply({ toast: `VS Code 를 띄우지 못했습니다: ${r.stderr.slice(0, 200)}` });
	return reply({ toast: `${files.length}개 파일을 VS Code 로 열었습니다` });
}
