import { useEffect, useRef, type RefObject } from "react";
import { toast } from "sonner";
import { create } from "zustand";

/**
 * 단축키 등록부. 키는 여기 한 곳에 등록하고, ? 단축키 표 · Alt 배지 · 툴팁이 같은 목록을 읽는다.
 * 등록은 그 키를 쓰는 컴포넌트가 마운트되어 있는 동안만 산다. 그래서 「지금 화면에서 쓸 수 있는 키」는 곧 지금 등록된 키다.
 * 화면마다 표를 손으로 적으면 키를 더하거나 바꿀 때 표만 낡는다.
 */

/** ? 표에서 묶는 순서 그대로다. */
export const KEY_GROUPS = ["어디서나", "보드", "대화", "상세 창"] as const;
export type KeyGroup = (typeof KEY_GROUPS)[number];

export interface KeyDef {
	/** 앵커 · 툴팁이 키를 찾는 이름. 화면에 보이지 않는다. */
	id: string;
	/** "Mod+F" · "Mod+Shift+Enter" · "Mod+Alt+ArrowUp" · "?" 꼴. Mod 는 Ctrl(맥은 Cmd)이다. */
	combo: string;
	/**
	 * 있으면 글자(`e.key`) 대신 자판 자리(`e.code`)로 맞춘다. 수식키는 `combo` 대로 본다.
	 * 한글 입력 상태에서는 N 이 「ㅜ」로 와서 글자로는 맞지 않는다. 숫자 패드의 Alt 조합(Alt 코드 입력)을 숫자 줄과 가를 때도 쓴다.
	 */
	code?: string;
	/** 표 · 툴팁에 보일 이름 */
	label: string;
	group: KeyGroup;
	/** 거짓이면 등록하지 않는다 — 표에도 나오지 않는다. 조건이 맞을 때만 쓰는 키(질문에 답한 뒤의 Ctrl ↵ 등)에 쓴다. */
	enabled?: boolean;
	/**
	 * 입력칸 · 편집기 안에서 누른 키도 받을지. 기본은 받는다 — Ctrl 조합은 글자를 먹지 않는다.
	 * 맨 글자 키(? 등)는 "skip" 으로 둔다. 그러지 않으면 글을 쓰다 「?」를 칠 때 표가 뜬다.
	 */
	inInput?: "allow" | "skip";
	/** 표에서 한 줄로 묶을 이름. 같은 이름의 키는 「보드 · 대화 · … Ctrl 1–5」처럼 한 줄이 된다. */
	series?: string;
	/** Ctrl+K 의 「지금 여기서」에도 싣는다. 동작만 싣는다 — 자리를 옮기는 키는 그 자리에서 눌러야 뜻이 있다. */
	command?: boolean;
	/** 등록은 두되 지금은 누를 수 없다. 키는 다음 등록으로 넘어가고 Ctrl+K 에서는 흐리게 보인다. */
	disabled?: boolean;
	/** 있으면 CONFIRM_MS 안에 두 번 눌러야 run 을 부른다. 실행을 시작하거나 끝내는 키에 쓴다. key 는 대상(이슈 id)이고, text 는 「한 번 더 누르면 …」의 뒷말이다. */
	confirm?: { key: string; text: string };
	/** 창 · 메뉴가 떠 있어도 받는다. 기본은 받지 않는다 — 뒤 화면을 키로 바꾸면 안 된다. 여닫는 키에만 쓴다. */
	overModal?: boolean;
	/** false 를 돌려주면 처리하지 않은 것으로 보고 기본 동작을 막지 않는다 — 다음 등록이 받는다. */
	run: (e: KeyboardEvent) => boolean | void;
}

interface Combo {
	mod: boolean;
	alt: boolean;
	shift: boolean;
	key: string;
}

function parse(combo: string): Combo {
	const parts = combo.split("+");
	// "Mod++" 처럼 + 자체를 키로 쓰면 끝이 빈 조각이 된다.
	const key = parts.pop() || "+";
	return { mod: parts.includes("Mod"), alt: parts.includes("Alt"), shift: parts.includes("Shift"), key };
}

/** 글자 · 숫자가 아닌 한 글자 키(? , 등)는 Shift 를 보지 않는다. ? 는 Shift 를 눌러야 나오는데 조합에 Shift 를 적게 하면 읽기 어렵다. */
function shiftFree(key: string) {
	return key.length === 1 && !/[a-z0-9]/i.test(key);
}

function matches(c: Combo, e: KeyboardEvent, code?: string) {
	if (c.mod !== (e.ctrlKey || e.metaKey) || c.alt !== e.altKey) return false;
	if (!shiftFree(c.key) && c.shift !== e.shiftKey) return false;
	if (code) return e.code === code;
	// 한글 입력 상태에서는 K 가 「ㅏ」로 온다. 글자가 영문이 아닐 때만 자판 자리로 본다 — 영문 자판 배열이 다른 사람은 글자대로 맞아야 한다.
	if (/^[a-z]$/i.test(c.key) && !/^[a-z]$/i.test(e.key)) return e.code === `Key${c.key.toUpperCase()}`;
	return c.key.length === 1 ? e.key.toLowerCase() === c.key.toLowerCase() : e.key === c.key;
}

const KEY_NAMES: Record<string, string> = { Mod: "Ctrl", Shift: "⇧", Enter: "↵", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc" };

/** "Mod+Shift+Enter" → "Ctrl ⇧ ↵". 화면에 이미 있는 Kbd 표기와 같은 꼴이다. */
export function comboLabel(combo: string) {
	const c = parse(combo);
	return [c.mod && "Ctrl", c.alt && "Alt", c.shift && !shiftFree(c.key) && "⇧", KEY_NAMES[c.key] ?? c.key.toUpperCase()].filter(Boolean).join(" ");
}

/** 입력칸 · 편집기 안인지. 질문 답한 뒤의 Ctrl ↵ 가 보던 범위에 textarea · contenteditable 을 더했다. */
export function inTyping(t: EventTarget | null) {
	return !!(t as Element | null)?.closest?.("input, textarea, select, .cm-editor, [contenteditable=''], [contenteditable='true']");
}

interface Entry {
	token: number;
	def: RefObject<KeyDef>;
}

interface Keys {
	/** 등록한 순서. 같은 조합이면 나중 것(상세 창 > 보드)이 먼저 받는다. */
	entries: Entry[];
	/** 키 없이 Ctrl+K 에만 싣는 동작 목록 */
	sources: { token: number; list: RefObject<Command[]> }[];
}

const useKeys = create<Keys>()(() => ({ entries: [], sources: [] }));
let nextToken = 0;

function register(def: RefObject<KeyDef>) {
	const token = nextToken++;
	useKeys.setState((s) => ({ entries: [...s.entries, { token, def }] }));
	return () => useKeys.setState((s) => ({ entries: s.entries.filter((e) => e.token !== token) }));
}

/** 두 번 눌러야 하는 키 · 카드 단추가 기다리는 시간. */
export const CONFIRM_MS = 1500;

let pending: { key: string; at: number } | null = null;

/** 첫 번째면 안내를 띄우고 false, 같은 대상을 시간 안에 다시 눌렀으면 true. 기다리는 것은 하나뿐이라 다른 이슈 · 다른 키를 누르면 처음부터다. */
export function pressTwice(key: string, text: string) {
	if (pending?.key === key && Date.now() - pending.at < CONFIRM_MS) {
		pending = null;
		toast.dismiss("press-twice");
		return true;
	}
	pending = { key, at: Date.now() };
	toast(`한 번 더 누르면 ${text}`, { id: "press-twice", duration: CONFIRM_MS });
	return false;
}

/** 상세 창은 겹침으로 치지 않는다. 그 위에서 쓰라고 만든 키가 많고, 뒤 화면을 막는 것은 창 자체다. */
const blocked = () => !!document.querySelector('[role="alertdialog"], [role="menu"], [role="dialog"]:not([data-slot="sheet-content"])');

// 리스너는 하나만 둔다. 컴포넌트마다 window 에 따로 걸면 같은 키를 누가 먼저 받는지 마운트 순서에 맡기게 된다.
window.addEventListener("keydown", (e) => {
	// 한글 조합 중의 키는 글자를 만드는 중이다.
	if (e.isComposing) return;
	const { entries } = useKeys.getState();
	for (let i = entries.length - 1; i >= 0; i--) {
		const d = entries[i].def.current;
		if (!matches(parse(d.combo), e, d.code)) continue;
		if (d.disabled) continue;
		if (d.inInput === "skip" && inTyping(e.target)) continue;
		if (!d.overModal && blocked()) continue;
		if (d.confirm) {
			e.preventDefault();
			// 누르고 있어 반복되는 입력은 두 번째 누름이 아니다.
			if (!e.repeat && pressTwice(`${d.id}:${d.confirm.key}`, d.confirm.text)) d.run(e);
			return;
		}
		if (d.run(e) === false) continue;
		e.preventDefault();
		return;
	}
});

/** 컴포넌트가 마운트되어 있는 동안 키를 등록한다. run · label 은 렌더마다 최신 것을 쓴다. */
export function useKey(def: KeyDef) {
	const ref = useRef(def);
	ref.current = def;
	const on = def.enabled ?? true;
	useEffect(() => (on ? register(ref) : undefined), [on, def.id, def.combo]);
}

/** 키 없는 동작 하나. 「더 보기」 메뉴의 항목을 그대로 싣는다(useActionCommands). */
export interface Command {
	label: string;
	/** 오른쪽 흐린 글자. 어디의 동작인지 가른다 — 「지우기」는 이슈에도 대화에도 있다. */
	sub?: string;
	disabled?: boolean;
	onSelect: () => void;
}

/** 컴포넌트가 마운트되어 있는 동안 그 목록을 Ctrl+K 에 싣는다. 목록은 렌더마다 최신 것을 쓴다. */
export function useCommands(list: Command[]) {
	const ref = useRef(list);
	ref.current = list;
	useEffect(() => {
		const token = nextToken++;
		useKeys.setState((s) => ({ sources: [...s.sources, { token, list: ref }] }));
		return () => useKeys.setState((s) => ({ sources: s.sources.filter((x) => x.token !== token) }));
	}, []);
}

/** Ctrl+K 의 「지금 여기서」. 나중에 등록한 것(상세 창 > 화면)이 위다. 키 있는 동작이 먼저고, 같은 이름의 메뉴 항목은 뺀다. */
export function activeCommands(): { keys: KeyDef[]; others: Command[] } {
	const { entries, sources } = useKeys.getState();
	const keys = entries
		.map((e) => e.def.current)
		.filter((d) => d.command && !d.disabled)
		.reverse();
	const names = new Set(keys.map((d) => d.label));
	const others = sources.flatMap((s) => s.list.current).reverse();
	return { keys, others: others.filter((c) => !names.has(c.label)) };
}

/** 지금 등록된 키. 표 · 배지 · 툴팁이 읽는다. */
export function useActiveKeys(): KeyDef[] {
	return useKeys((s) => s.entries).map((e) => e.def.current);
}

function find(entries: Entry[], id: string) {
	for (let i = entries.length - 1; i >= 0; i--) if (entries[i].def.current.id === id) return entries[i];
	return undefined;
}

/**
 * id 로 지금 등록된 키를 찾는다. 등록되지 않았으면 undefined.
 * 고르개는 등록 칸(바뀌지 않는 객체)을 돌려주고 def 는 밖에서 읽는다. def 는 등록한 쪽이 렌더할 때마다 새 객체라 고르개가 돌려주면 구독이 끝없이 다시 그린다.
 */
export function useKeyDef(id: string): KeyDef | undefined {
	return useKeys((s) => find(s.entries, id))?.def.current;
}

export function findKey(id: string): KeyDef | undefined {
	return find(useKeys.getState().entries, id)?.def.current;
}

/**
 * 키가 걸린 단추 · 탭에 펼친다. Alt 를 길게 누를 때 배지가 여기에 뜬다. 속성뿐이라 크기 · 배치는 그대로다.
 * `place` 는 배지 자리다. top 은 바로 위 가운데, end 는 줄 안쪽 오른쪽 끝 — 사이드바처럼 세로로 붙은 줄은 위에 띄우면 윗줄 글자를 가린다.
 */
export function keyAnchor(id: string, place: "top" | "end" = "top") {
	return place === "top" ? { "data-key-anchor": id } : { "data-key-anchor": id, "data-key-place": place };
}
