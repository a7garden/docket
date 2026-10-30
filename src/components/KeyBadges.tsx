import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { comboLabel, findKey } from "@/lib/keys";
import { cn } from "@/lib/utils";

/** Alt 만 이만큼 누르고 있어야 배지를 띄운다. 그 사이 다른 키가 눌리면(Alt+↓ 등) 띄우지 않는다 — 바로 누르는 조합에서 배지가 번쩍이지 않게. */
const HOLD_MS = 400;

interface Spot {
	id: string;
	label: string;
	end: boolean;
	x: number;
	y: number;
}

/** 지금 보이는 앵커만 고른다. 크기가 0(가려진 탭 내용) · 화면 밖 · 다른 창에 덮인 자리는 뺀다 — 상세 창이 떠 있을 때 뒤의 탭에 배지가 뜨면 누를 수 없는 키를 알린다. */
function measure(): Spot[] {
	const spots: Spot[] = [];
	for (const el of document.querySelectorAll<HTMLElement>("[data-key-anchor]")) {
		const def = findKey(el.dataset.keyAnchor!);
		if (!def) continue;
		const r = el.getBoundingClientRect();
		if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
		const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
		if (!hit || !el.contains(hit)) continue;
		// 기본은 바로 위에 띄운다. 윗변에 걸치면 높이 28px 탭의 글자 윗부분을 가린다.
		const end = el.dataset.keyPlace === "end";
		spots.push({ id: el.dataset.keyAnchor!, label: comboLabel(def.combo), end, x: end ? r.right - 8 : r.left + r.width / 2, y: end ? r.top + r.height / 2 : r.top - 2 });
	}
	return spots;
}

/**
 * Alt 를 길게 누르는 동안 키가 걸린 자리에 배지를 띄운다(오피스 키 팁과 같은 방식). 손을 떼면 사라진다.
 * 배지는 화면 위 덮개 하나에 겹쳐 그린다. 단추 안에 넣으면 탭 · 단추의 크기와 배치가 바뀐다.
 */
export function KeyBadges() {
	const [spots, setSpots] = useState<Spot[] | null>(null);
	useEffect(() => {
		let timer = 0;
		// Alt 만 눌렸다 떼였는지. 다른 키가 끼면 Alt 조합이다.
		let lone = false;
		const close = () => {
			window.clearTimeout(timer);
			setSpots(null);
		};
		const down = (e: KeyboardEvent) => {
			if (e.key === "Alt") {
				if (e.repeat) return;
				close();
				// 오른쪽 Alt 는 한/영 · AltGr 로 쓰인다.
				lone = e.code === "AltLeft" && !e.ctrlKey && !e.shiftKey && !e.metaKey;
				if (lone) timer = window.setTimeout(() => setSpots(measure()), HOLD_MS);
				return;
			}
			lone = false;
			close();
		};
		const up = (e: KeyboardEvent) => {
			if (e.key !== "Alt") return;
			// 2026.10.29 : Windows 는 Alt 만 눌렀다 떼면 창 메뉴 쪽으로 초점을 옮겨 다음 키 하나를 먹는다(WebView2 에서 그대로인지는 추정).
			// 배지를 보려고 Alt 를 눌렀다 뗀 뒤의 첫 키가 사라지지 않게, 홀로 누른 Alt 의 기본 동작만 막는다.
			if (lone) e.preventDefault();
			lone = false;
			close();
		};
		const reset = () => {
			lone = false;
			close();
		};
		window.addEventListener("keydown", down, true);
		window.addEventListener("keyup", up, true);
		// Alt+Tab 으로 나가면 keyup 이 오지 않는다. 누른 채 스크롤 · 창 크기를 바꾸면 자리가 어긋난다.
		window.addEventListener("blur", reset);
		window.addEventListener("resize", reset);
		window.addEventListener("scroll", reset, true);
		window.addEventListener("pointerdown", reset, true);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("keydown", down, true);
			window.removeEventListener("keyup", up, true);
			window.removeEventListener("blur", reset);
			window.removeEventListener("resize", reset);
			window.removeEventListener("scroll", reset, true);
			window.removeEventListener("pointerdown", reset, true);
		};
	}, []);

	if (!spots?.length) return null;
	return createPortal(
		<div aria-hidden className="pointer-events-none fixed inset-0 z-[100]">
			{spots.map((s, i) => (
				<span
					key={`${s.id}:${i}`}
					style={{ left: s.x, top: s.y }}
					className={cn(
						"tabular absolute rounded-sm bg-foreground px-1 py-px text-[10.5px] leading-[14px] font-semibold whitespace-nowrap text-background shadow-sm duration-100 animate-in fade-in-0 zoom-in-90",
						s.end ? "-translate-x-full -translate-y-1/2" : "-translate-x-1/2 -translate-y-full",
					)}
				>
					{s.label}
				</span>
			))}
		</div>,
		document.body,
	);
}
