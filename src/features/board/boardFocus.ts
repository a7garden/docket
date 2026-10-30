import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { create } from "zustand";
import { type KeyDef, useKey } from "@/lib/keys";
import { useUi } from "@/lib/store";

/**
 * 보드 카드 사이의 키보드 초점(roving tabindex). 보드에서 Tab 이 멈추는 카드는 하나뿐이고, 그 안에서는 방향키로 옮긴다.
 * 초점은 순번이 아니라 이슈 id 로 기억한다 — 실시간으로 정렬이 바뀌거나 카드가 다른 열로 옮겨 가도 같은 카드를 따라간다.
 * 열 · 카드 순서는 보드가 그린 것과 같은 `string[][]`(열마다 카드 id)로 받는다. DOM 위치를 재지 않는다.
 */

export type Cols = string[][];

interface Spot {
	col: number;
	row: number;
}

function locate(cols: Cols, id: string | null): Spot | null {
	if (!id) return null;
	for (let col = 0; col < cols.length; col++) {
		const row = cols[col].indexOf(id);
		if (row >= 0) return { col, row };
	}
	return null;
}

/** 왼쪽 열부터 보아 처음 나오는 카드. 빈 열은 건너뛴다. */
export function firstCard(cols: Cols) {
	return cols.find((c) => c.length > 0)?.[0] ?? null;
}

/** 사라진 카드의 자리를 이어받는다. 같은 열 같은 순번 → 그 열 마지막 → 첫 카드. */
function inherit(cols: Cols, at: Spot | null) {
	const col = at ? cols[at.col] : undefined;
	if (col?.length) return col[Math.min(at!.row, col.length - 1)];
	return firstCard(cols);
}

/** ← → 는 옆 열의 같은 순번(짧으면 그 열 마지막), ↑ ↓ 는 열 안에서 옮긴다. 끝에서는 멈춘다. */
function step(cols: Cols, at: Spot, key: string): string | null {
	if (key === "ArrowUp") return at.row > 0 ? cols[at.col][at.row - 1] : null;
	if (key === "ArrowDown") return cols[at.col][at.row + 1] ?? null;
	const dir = key === "ArrowLeft" ? -1 : 1;
	for (let c = at.col + dir; c >= 0 && c < cols.length; c += dir) {
		if (cols[c].length) return cols[c][Math.min(at.row, cols[c].length - 1)];
	}
	return null;
}

/**
 * 보드가 지금 그린 카드 순서(왼쪽 열부터, 열 안은 위부터). 상세 창의 이전 · 다음 이슈가 읽는다.
 * 보드가 걸러 보기 · 정렬 · 완료 숨기기를 마친 결과를 그대로 싣는다 — 상세 창이 같은 계산을 따로 하면 둘이 어긋난다.
 * 보드가 그려져 있지 않으면(산출물 화면 위에 연 창) 비어 있어 이전 · 다음이 꺼진다.
 */
const useBoardOrder = create<{ projectId: string | null; ids: string[] }>(() => ({ projectId: null, ids: [] }));

export function usePublishBoardOrder(projectId: string, cols: Cols) {
	useEffect(() => useBoardOrder.setState({ projectId, ids: cols.flat() }), [projectId, cols]);
	useEffect(() => () => useBoardOrder.setState({ projectId: null, ids: [] }), []);
}

/** 보드 순서에서 그 이슈의 앞(-1) · 뒤(1) 이슈. 보드에 없거나 끝이면 null. 실시간으로 순서가 바뀌면 바뀐 순서를 따른다. */
export function useBoardNeighbor(projectId: string, id: string, dir: -1 | 1) {
	return useBoardOrder((s) => {
		if (s.projectId !== projectId) return null;
		const at = s.ids.indexOf(id);
		return at < 0 ? null : (s.ids[at + dir] ?? null);
	});
}

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * ? 표에 적을 보드 키. 키는 초점 간 카드(`IssueCard`) · 보드 그리드 · 검색칸이 직접 받는다 — 어느 카드에 초점이 있는지가 곧 대상이고,
 * C 는 한글 입력 상태에서도 되도록 `e.code` 로 봐야 하는데 등록부는 `e.key` 로 맞춘다. 그래서 여기서는 처리하지 않고(false) 표에만 올린다.
 */
const BOARD_KEYS: Omit<KeyDef, "group" | "run">[] = [
	{ id: "board.col.prev", combo: "ArrowLeft", label: "왼쪽 열", series: "board.col" },
	{ id: "board.col.next", combo: "ArrowRight", label: "오른쪽 열", series: "board.col" },
	{ id: "board.row.prev", combo: "ArrowUp", label: "위 카드", series: "board.row" },
	{ id: "board.row.next", combo: "ArrowDown", label: "아래 카드", series: "board.row" },
	{ id: "board.open", combo: "Enter", label: "카드 열기" },
	{ id: "board.press", combo: "Mod+Enter", label: "카드의 단추 누르기 · 중지는 두 번" },
	{ id: "board.copy", combo: "C", label: "카드 번호 복사" },
	{ id: "board.menu", combo: "Shift+F10", label: "카드 메뉴 · 메뉴 키도 됩니다" },
	{ id: "board.first", combo: "ArrowDown", label: "검색칸에서 첫 카드로" },
];

export function useBoardKeys() {
	for (const k of BOARD_KEYS) {
		// 목록이 고정이라 훅 순서가 바뀌지 않는다.
		useKey({ ...k, group: "보드", run: () => false });
	}
}

/**
 * 보드 그리드에 펼칠 이벤트와, 지금 Tab 이 멈출 카드 id 를 준다.
 * `inBoard` 는 「초점이 보드 카드에 있었다」는 표시다. 이것이 켜져 있을 때만 사라진 초점을 되살린다 —
 * 상세 창 · 작성칸 · 걸러 보기 칩에 있는 초점을 실시간 갱신이 빼앗으면 안 된다.
 */
export function useBoardFocus(cols: Cols) {
	const grid = useRef<HTMLDivElement>(null);
	const [chosen, setChosen] = useState<string | null>(null);
	const last = useRef<Spot | null>(null);
	const inBoard = useRef(false);

	// 고른 카드가 걸러져 사라졌으면(걸러 보기 · 완료 숨기기 · 보류 숨기기 · 지우기) 그 자리를 이어받은 카드가 Tab 을 받는다.
	const active = locate(cols, chosen) ? chosen : inherit(cols, last.current);

	const focusCard = (id: string) => {
		const el = grid.current?.querySelector<HTMLElement>(`[data-issue-id="${CSS.escape(id)}"]`);
		if (!el) return;
		el.focus({ preventScroll: true });
		el.scrollIntoView({ block: "nearest" });
	};

	useLayoutEffect(() => {
		const at = locate(cols, active);
		if (at) last.current = at;
		if (!inBoard.current || !active) return;
		// 카드가 다른 열로 옮겨 가면 React 가 DOM 을 새로 만들어 초점이 body 로 빠진다. 그때만 같은 카드(없으면 이어받은 카드)로 되돌린다.
		const now = document.activeElement;
		if (now && now !== document.body && now.isConnected) return;
		focusCard(active);
	}, [cols, active]);

	const onFocus = (e: FocusEvent<HTMLDivElement>) => {
		const id = (e.target as HTMLElement).dataset.issueId;
		if (!id) return;
		inBoard.current = true;
		setChosen(id);
	};

	const onBlur = (e: FocusEvent<HTMLDivElement>) => {
		const from = e.target as HTMLElement;
		const to = e.relatedTarget as Node | null;
		if (to) {
			inBoard.current = !!grid.current?.contains(to) && !!(to as HTMLElement).dataset?.issueId;
			return;
		}
		// 어디로 갔는지 모르면 한 박자 뒤에 본다. 카드가 지워지며 빠졌으면 표시를 남겨 되살리고, 창을 떠났으면(Alt+Tab) 초점은 카드에 그대로다.
		setTimeout(() => {
			if (!from.isConnected) return;
			const now = document.activeElement;
			inBoard.current = !!now && !!grid.current?.contains(now) && !!(now as HTMLElement).dataset?.issueId;
		});
	};

	// Enter 로 연 상세 창이 닫히면 그 카드로 초점을 돌려준다. 창이 닫히면 초점이 body 로 빠져, 보드로 돌아오려면 Tab 을 수십 번 눌러야 한다.
	// 마우스로 연 창은 건드리지 않는다 — 닫을 때 카드에 초점 테두리가 생기면 마우스로 쓰던 보드가 달라 보인다.
	const reopen = useRef<string | null>(null);
	const sheetId = useUi((s) => s.issueId);
	const latest = useRef(cols);
	latest.current = cols;
	useEffect(() => {
		const id = reopen.current;
		if (!id) return;
		// 창 안에서 이전 · 다음 이슈로 넘어갔으면 닫을 때 마지막으로 본 카드로 돌아간다.
		if (sheetId) {
			reopen.current = sheetId;
			return;
		}
		reopen.current = null;
		// 창은 닫히는 움직임이 끝난 뒤에야 DOM 에서 빠지고, 그때 Radix 가 초점을 정리한다. 그 뒤에 본다.
		let frame = 0;
		const until = Date.now() + 1500;
		const tick = () => {
			if (document.querySelector('[role="dialog"]') && Date.now() < until) {
				frame = requestAnimationFrame(tick);
				return;
			}
			if (document.activeElement && document.activeElement !== document.body) return;
			const target = locate(latest.current, id) ? id : inherit(latest.current, last.current);
			if (!target) return;
			inBoard.current = true;
			setChosen(target);
			focusCard(target);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [sheetId]);

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const t = e.target as HTMLElement;
		if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && t.dataset.issueId) reopen.current = t.dataset.issueId;
		if (!ARROWS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
		// 우클릭 메뉴 · 확인 창은 포털이라 DOM 으로는 보드 밖이지만 React 이벤트는 여기까지 올라온다. 그 안의 ↑↓ 는 메뉴의 것이다.
		if (!t.dataset.issueId || !e.currentTarget.contains(t)) return;
		const at = locate(cols, t.dataset.issueId);
		const next = at && step(cols, at, e.key);
		e.preventDefault();
		if (!next) return;
		setChosen(next);
		focusCard(next);
	};

	/** 검색칸에서 ↓ 로 들어올 때. */
	const focusFirst = () => {
		const id = firstCard(cols);
		if (!id) return false;
		setChosen(id);
		focusCard(id);
		return true;
	};

	return { active, focusFirst, gridProps: { ref: grid, onFocus, onBlur, onKeyDown } };
}
