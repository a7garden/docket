import { useEffect, useRef, useState, type RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

// Tauri 의 파일 끌어 놓기는 창 하나에 사건 하나로 온다. 놓인 좌표 아래에 있는 영역을 찾아 넘겨준다.
// 영역이 겹치면 가장 안쪽(나중에 그려진) 영역이 받는다.

interface Zone {
	el: HTMLElement;
	onDrop: (paths: string[]) => void;
	setOver: (over: boolean) => void;
}

const zones = new Set<Zone>();
let started = false;
let current: Zone | null = null;

function zoneAt(x: number, y: number): Zone | null {
	const target = document.elementFromPoint(x, y);
	if (!target) return null;
	let best: Zone | null = null;
	for (const z of zones) {
		if (z.el.contains(target) && (!best || best.el.contains(z.el))) best = z;
	}
	return best;
}

function setCurrent(z: Zone | null) {
	if (current === z) return;
	current?.setOver(false);
	current = z;
	current?.setOver(true);
}

function start() {
	if (started) return;
	started = true;
	void getCurrentWebview().onDragDropEvent((e) => {
		const p = e.payload;
		if (p.type === "leave") return setCurrent(null);
		const ratio = window.devicePixelRatio || 1;
		const x = p.position.x / ratio;
		const y = p.position.y / ratio;
		const z = zoneAt(x, y);
		if (p.type === "drop") {
			setCurrent(null);
			if (z && p.paths.length) z.onDrop(p.paths);
		} else {
			setCurrent(z);
		}
	});
}

export function useDropZone<T extends HTMLElement>(onDrop: (paths: string[]) => void, enabled = true): [RefObject<T | null>, boolean] {
	const ref = useRef<T>(null);
	const [over, setOver] = useState(false);
	const cb = useRef(onDrop);
	cb.current = onDrop;
	useEffect(() => {
		if (!enabled || !ref.current) return;
		start();
		const zone: Zone = { el: ref.current, onDrop: (p) => cb.current(p), setOver };
		zones.add(zone);
		return () => {
			zones.delete(zone);
			if (current === zone) current = null;
		};
	}, [enabled]);
	return [ref, over];
}
