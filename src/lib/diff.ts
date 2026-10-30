/**
 * 두 글의 줄 단위 비교. 산출물의 앞 판과 새 판을 견줄 때 쓴다.
 * 앞뒤로 같은 줄을 먼저 덜어 내고 가운데만 LCS 로 비교한다 — 자동 갱신은 문서의 일부만 고치므로 가운데가 짧다.
 */

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** 가운데 비교 표의 칸 수 상한. 넘으면 가운데를 통째로 지움 · 더함으로 본다(화면이 멈추지 않게). */
const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
	const a = before.replace(/\r\n/g, "\n").split("\n");
	const b = after.replace(/\r\n/g, "\n").split("\n");
	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head++;
	let tail = 0;
	while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
	const am = a.slice(head, a.length - tail);
	const bm = b.slice(head, b.length - tail);
	const out: DiffLine[] = a.slice(0, head).map((text) => ({ kind: "same", text }));
	out.push(...middle(am, bm));
	out.push(...a.slice(a.length - tail).map((text) => ({ kind: "same" as const, text })));
	return out;
}

function middle(a: string[], b: string[]): DiffLine[] {
	const n = a.length;
	const m = b.length;
	if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) {
		return [...a.map((text) => ({ kind: "del" as const, text })), ...b.map((text) => ({ kind: "add" as const, text }))];
	}
	// lcs[i][j] = a[i..] 와 b[j..] 의 공통 부분열 길이. 뒤에서부터 채워 앞에서부터 읽는다.
	const w = m + 1;
	const lcs = new Uint32Array((n + 1) * w);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
		}
	}
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			out.push({ kind: "same", text: a[i] });
			i++;
			j++;
		} else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
			out.push({ kind: "del", text: a[i++] });
		} else {
			out.push({ kind: "add", text: b[j++] });
		}
	}
	while (i < n) out.push({ kind: "del", text: a[i++] });
	while (j < m) out.push({ kind: "add", text: b[j++] });
	return out;
}

export type DiffChunk = { kind: "lines"; lines: DiffLine[] } | { kind: "gap"; count: number };

/** 바뀐 곳 둘레 context 줄만 남기고 나머지 같은 줄은 「N줄 같음」으로 접는다. */
export function foldDiff(lines: DiffLine[], context = 2): DiffChunk[] {
	const keep = new Array<boolean>(lines.length).fill(false);
	lines.forEach((l, i) => {
		if (l.kind === "same") return;
		for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
	});
	const out: DiffChunk[] = [];
	let i = 0;
	while (i < lines.length) {
		if (keep[i]) {
			const run: DiffLine[] = [];
			while (i < lines.length && keep[i]) run.push(lines[i++]);
			out.push({ kind: "lines", lines: run });
		} else {
			let count = 0;
			while (i < lines.length && !keep[i]) {
				count++;
				i++;
			}
			out.push({ kind: "gap", count });
		}
	}
	return out;
}
