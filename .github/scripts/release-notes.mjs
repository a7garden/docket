// CHANGELOG.md 에서 이번 판 구획을 잘라 GITHUB_OUTPUT 의 body 로 넘긴다. release.yml 이 부른다.
// 태그와 앱 버전이 다르면 latest.json 의 버전이 어긋나 업데이트가 돌지 않으므로 여기서 멈춘다.
import { appendFileSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : null;
if (tag && tag !== `v${version}`) fail(`태그 ${tag} 와 tauri.conf.json 버전 ${version} 이 다르다`);

// 구획 머리는 「## 0.1.1」 또는 「## 0.1.1 — 날짜」. 0.1.10 이 0.1.1 로 잡히지 않게 버전 뒤를 끊어 본다.
const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l === `## ${version}` || l.startsWith(`## ${version} `));
if (start < 0) fail(`CHANGELOG.md 에 ## ${version} 구획이 없다`);
let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join("\n").trim();
if (!body) fail(`CHANGELOG.md 의 ## ${version} 구획이 비었다`);

console.log(body);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `body<<__NOTES__\n${body}\n__NOTES__\n`);

function fail(msg) {
	console.log(`::error::${msg}`);
	process.exit(1);
}
