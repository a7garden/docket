import { useEffect, useState } from "react";
import { DOCK_WIDTH, useUi } from "./store";

/** 사이드바 폭(w-56)과 접었을 때의 아이콘 띠 폭. 본문은 옆 칸을 띄워도 이만큼은 남긴다. */
export const SIDEBAR_W = 224;
export const SIDEBAR_RAIL = 56;
export const MAIN_MIN = 520;

export function useWindowWidth() {
	const [w, setW] = useState(() => window.innerWidth);
	useEffect(() => {
		const on = () => setW(window.innerWidth);
		window.addEventListener("resize", on);
		return () => window.removeEventListener("resize", on);
	}, []);
	return w;
}

/**
 * 옆 칸의 실제 폭과 사이드바를 아이콘 띠로 접을지. 옆 칸을 띄워도 본문이 MAIN_MIN 을 지키게 한다 —
 * 먼저 사이드바를 접고, 그래도 모자라면 옆 칸을 최소 폭까지 줄인다. 그 아래로는 본문이 좁아지는 것을 받아들인다.
 */
export function useDockLayout() {
	const w = useWindowWidth();
	const dock = useUi((s) => s.dock);
	const shown = dock.open && !!dock.talk;
	if (!shown) return { shown, width: 0, rail: false };
	const room = w - SIDEBAR_RAIL - MAIN_MIN;
	const width = Math.max(DOCK_WIDTH.min, Math.min(dock.width, DOCK_WIDTH.max, room));
	const rail = w - SIDEBAR_W - width < MAIN_MIN;
	return { shown, width, rail };
}
