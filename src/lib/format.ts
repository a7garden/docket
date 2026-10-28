import { convertFileSrc } from "@tauri-apps/api/core";
import type { Issue } from "./types";

export function relTime(ms: number, now = Date.now()): string {
	if (!ms) return "";
	const s = Math.round((now - ms) / 1000);
	if (s < 45) return "방금";
	const m = Math.round(s / 60);
	if (m < 60) return `${m}분 전`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}시간 전`;
	const d = new Date(ms);
	const today = new Date(now);
	const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
	if (days === 1) return "어제";
	if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
	return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function clock(ms: number): string {
	if (!ms) return "";
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${d.getMonth() + 1}.${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function duration(ms: number): string {
	if (!ms) return "";
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}초`;
	const m = Math.floor(s / 60);
	return s % 60 ? `${m}분 ${s % 60}초` : `${m}분`;
}

export function bytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function cost(usd: number): string {
	if (!usd) return "";
	return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

export function joinPath(...parts: string[]) {
	return parts.filter(Boolean).join("\\").replace(/[\\/]+/g, "\\");
}

export function dirname(path: string) {
	const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
	return i > 0 ? path.slice(0, i) : path;
}

export function attachmentPath(issue: Pick<Issue, "dir">, name: string) {
	return joinPath(issue.dir, "attachments", name);
}

export function fileUrl(path: string) {
	return convertFileSrc(path);
}

/** `C:\…` · `C:/…` · `\\서버\…` */
export function isAbsPath(p: string) {
	return /^[A-Za-z]:[\\/]/.test(p) || /^\\\\/.test(p);
}

/** 앞머리가 같은지 본다. Windows 경로라 대소문자 · 구분자를 가리지 않는다. */
export function isUnder(path: string, dir: string) {
	const n = (s: string) => s.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
	return !!dir && n(path).startsWith(`${n(dir)}\\`);
}

/**
 * 마크다운 그림 주소를 띄울 곳으로 푼다. 웹 주소면 url, 로컬 파일이면 path 를 준다.
 * `attachments/` · `shots/` 는 이슈 폴더(base), 나머지 상대 경로는 저장소(root) 기준이다. root 가 없으면 base 기준이다.
 */
export function resolveImage(src: string, base?: string, root?: string): { url?: string; path?: string } {
	if (/^(https?:|data:|blob:|asset:|http:\/\/asset\.)/i.test(src)) return { url: src };
	let s = src;
	try {
		s = decodeURI(src);
	} catch {
		// 잘못된 % 가 섞인 경로는 받은 그대로 쓴다.
	}
	if (/^file:/i.test(s)) s = s.replace(/^file:\/*/i, "");
	if (isAbsPath(s)) return { path: s.replace(/\//g, "\\") };
	if (/^(attachments|shots)[\\/]/i.test(s) && base) return { path: joinPath(base, s) };
	const dir = root || base;
	return dir ? { path: joinPath(dir, s.replace(/^\.[\\/]/, "")) } : { url: src };
}

export function isImage(name: string) {
	return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

export function extOf(name: string) {
	const m = /\.([^.\\/]+)$/.exec(name);
	return m ? m[1].toLowerCase() : "";
}

export function isText(name: string) {
	return /\.(md|markdown|txt)$/i.test(name);
}

/** 첨부를 가리키는 마크다운. 이름에 빈칸이 있어도 깨지지 않게 <…> 로 감싼다. */
export function attachmentRef(name: string) {
	const label = name.replace(/\.[^.]+$/, "");
	return isImage(name) ? `![${label}](<attachments/${name}>)` : `[${name}](<attachments/${name}>)`;
}

export function delayText(sec: number) {
	if (sec <= 0) return "바로";
	if (sec < 60) return `${sec}초 뒤`;
	const m = Math.floor(sec / 60);
	return sec % 60 ? `${m}분 ${sec % 60}초 뒤` : `${m}분 뒤`;
}

export function newId() {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
