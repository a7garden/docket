import { type KeyboardEvent, useEffect, useState } from "react";

/**
 * 세로 목록의 키보드 초점(roving tabindex). Tab 은 목록에서 한 번만 멈추고, 그 안에서는 ↑↓ · Home · End 로 옮긴다.
 * 줄은 `roveItem()` 을 펼친 단추다. 보드와 달리 줄이 여러 컴포넌트에 걸쳐 그려지고(묶음 · 머리 줄) 순서도 화면 그대로라 DOM 을 읽는다.
 * Tab 이 멈추는 줄은 초점이 있는 줄 → 지금 연 줄 → 첫 줄이다.
 */

export function roveItem(active = false) {
	return active ? { "data-rove": "", "data-rove-active": "" } : { "data-rove": "" };
}

function items(root: HTMLElement) {
	return [...root.querySelectorAll<HTMLElement>("[data-rove]")];
}

function sync(root: HTMLElement) {
	const list = items(root);
	const now = document.activeElement as HTMLElement | null;
	const stop = list.find((el) => el === now) ?? list.find((el) => el.hasAttribute("data-rove-active")) ?? list[0];
	for (const el of list) el.tabIndex = el === stop ? 0 : -1;
}

/** 목록을 감싸는 요소에 펼친다. */
export function useRovingList() {
	const [root, setRoot] = useState<HTMLElement | null>(null);
	useEffect(() => {
		if (!root) return;
		sync(root);
		// 묶음을 접고 펴거나 대화가 새로 생겨도 멈출 줄을 다시 정한다.
		const seen = new MutationObserver(() => sync(root));
		seen.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-rove-active"] });
		return () => seen.disconnect();
	}, [root]);

	const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
		if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
		// 우클릭 메뉴는 포털이라 DOM 으로는 목록 밖이지만 React 이벤트는 여기까지 올라온다. 그 안의 ↑↓ 는 메뉴의 것이다.
		const t = e.target as HTMLElement;
		if (!t.hasAttribute("data-rove") || !e.currentTarget.contains(t)) return;
		const list = items(e.currentTarget);
		const at = list.indexOf(t);
		const next = e.key === "ArrowDown" ? list[at + 1] : e.key === "ArrowUp" ? list[at - 1] : e.key === "Home" ? list[0] : e.key === "End" ? list[list.length - 1] : undefined;
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
		e.preventDefault();
		next?.focus();
	};

	return { ref: setRoot, onKeyDown, onFocus: (e: { currentTarget: HTMLElement }) => sync(e.currentTarget) };
}
