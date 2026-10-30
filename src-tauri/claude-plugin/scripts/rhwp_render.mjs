#!/usr/bin/env node
// 한글(hwp · hwpx) 쪽을 SVG 로 그린다. 한컴이 없어도 되는 근사 렌더러다 — hwpx 스킬에 실려 있는 rhwp(WASM)를 쓴다.
// 쓰임: node rhwp_render.mjs <문서> <출력 폴더> [최대 쪽 수]
// 출력: 첫 줄에 전체 쪽 수, 다음 줄부터 만든 SVG 경로.
//
// 글자 폭은 브라우저 없이 어림한다(한글 = 글자 크기, 그 밖 = 0.55배 — hwpx 스킬의 변환기와 같은 값).
// 그래서 줄바꿈 · 쪽 나눔이 한컴과 조금 다를 수 있다. 쪽 수를 정확히 맞춰야 하면 한컴으로 다시 본다.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const vendor = path.join(here, "..", "skills", "hwpx", "scripts", "vendor", "rhwp");

function estimateTextWidth(font, text) {
	const match = String(font ?? "").match(/([0-9.]+)px/);
	const size = match ? Number.parseFloat(match[1]) : 12;
	let width = 0;
	for (const ch of String(text ?? "")) {
		const cp = ch.codePointAt(0) ?? 0;
		width += cp >= 0x1100 && cp <= 0xffdc ? size : size * 0.55;
	}
	return width;
}

const [input, outDir, maxArg] = process.argv.slice(2);
if (!input || !outDir) {
	console.error("쓰임: node rhwp_render.mjs <문서> <출력 폴더> [최대 쪽 수]");
	process.exit(2);
}
globalThis.measureTextWidth = estimateTextWidth;
const rhwp = await import(url.pathToFileURL(path.join(vendor, "rhwp.js")).href);
await rhwp.default({ module_or_path: fs.readFileSync(path.join(vendor, "rhwp_bg.wasm")) });
const doc = new rhwp.HwpDocument(new Uint8Array(fs.readFileSync(input)));
try {
	const total = doc.pageCount();
	const limit = Math.min(total, Number(maxArg) || total);
	fs.mkdirSync(outDir, { recursive: true });
	console.log(total);
	for (let i = 0; i < limit; i += 1) {
		const file = path.join(outDir, `p${String(i + 1).padStart(2, "0")}.svg`);
		fs.writeFileSync(file, doc.renderPageSvg(i));
		console.log(file);
	}
} finally {
	doc.free();
}
