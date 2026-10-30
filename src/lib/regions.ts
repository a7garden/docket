/**
 * 화면의 구역(사이드바 · 본문 · 옆 칸 · 상세 창) 사이를 키로 옮긴다. 구역은 `data-region` 을 단 요소이고, 그 시점에 화면에 있는 것만 돈다.
 * 모달 창이 떠 있으면 Radix 가 나머지에 aria-hidden 을 달므로 창 안에 저절로 머문다. 그래서 창이 모달인지 따로 묻지 않는다.
 */

export type Region = "sidebar" | "main" | "dock" | "sheet";

/** 구역마다 마지막으로 초점이 있던 자리. 돌아왔을 때 처음부터 다시 찾아가지 않게 한다. */
const last = new WeakMap<Element, HTMLElement>();

window.addEventListener("focusin", (e) => {
	const t = e.target as HTMLElement;
	const region = t.closest?.("[data-region]");
	if (region && region !== t) last.set(region, t);
});

const shown = (el: HTMLElement) => el.isConnected && el.getClientRects().length > 0;

/** 구역에 처음 들어갈 때 멈출 자리. 보드의 카드 · 목록의 지금 줄처럼 Tab 이 멈추는 자리가 먼저다. */
const ENTRY = '[data-rove][tabindex="0"], [data-issue-id][tabindex="0"]';
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
/** 대화 입력칸이 먼저고, 없으면 그 구역의 첫 입력칸이다(보드의 검색칸 · 메모 편집기). */
const INPUTS = ["[data-composer]", 'textarea:not([disabled]), input:not([type]):not([disabled]), input[type="text"]:not([disabled]), .cm-content'];

function regions() {
	return [...document.querySelectorAll<HTMLElement>("[data-region]")]
		.filter((r) => !r.closest('[aria-hidden="true"]') && shown(r))
		.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
}

function enter(region: HTMLElement) {
	const kept = last.get(region);
	if (kept && shown(kept)) return kept.focus();
	// 상세 창은 창 자체에 초점을 둔다. 첫 단추에 테두리가 생기면 부차적인 메뉴가 먼저 눈에 띈다.
	if (region.hasAttribute("tabindex")) return region.focus();
	const candidates = [...region.querySelectorAll<HTMLElement>(ENTRY), ...region.querySelectorAll<HTMLElement>(FOCUSABLE)];
	candidates.find(shown)?.focus();
}

function regionOf(el: Element | null) {
	return el?.closest<HTMLElement>("[data-region]") ?? null;
}

/** 다음(1) · 이전(-1) 구역으로. 끝에서는 처음으로 돈다 — 구역은 몇 개뿐이라 놓칠 일이 없다. */
export function stepRegion(dir: 1 | -1) {
	const list = regions();
	if (!list.length) return;
	const cur = regionOf(document.activeElement);
	const at = list.indexOf(cur ?? list.find((r) => r.dataset.region === "main") ?? list[0]);
	enter(list[(at + dir + list.length) % list.length]);
}

/** 그 구역으로 초점을 옮긴다. 구역이 없으면 false. */
export function focusRegion(name: Region) {
	const region = regions().find((r) => r.dataset.region === name);
	if (!region) return false;
	enter(region);
	return true;
}

/** 그 구역(비우면 지금 구역)의 입력칸으로 간다. 입력칸이 없으면 false. */
export function focusInput(name?: Region) {
	const list = regions();
	const cur = regionOf(document.activeElement);
	const fallback = list.find((r) => r.dataset.region === "sheet") ?? list.find((r) => r.dataset.region === "main");
	const region = name ? list.find((r) => r.dataset.region === name) : cur && cur.dataset.region !== "sidebar" ? cur : fallback;
	if (!region) return false;
	for (const sel of INPUTS) {
		const el = [...region.querySelectorAll<HTMLElement>(sel)].find(shown);
		if (el) {
			el.focus();
			return true;
		}
	}
	return false;
}

/**
 * 방금 연 칸이 그려지기를 기다려 부른다. 대화 목록을 받는 동안에는 칸이 아직 없다.
 * 첫 시도도 다음 프레임이다. 바로 부르면 곧 사라질 지금 대화의 입력칸을 찾고 멈춘다.
 */
export function soon(fn: () => boolean, frames = 30) {
	requestAnimationFrame(() => {
		if (!fn() && frames > 0) soon(fn, frames - 1);
	});
}

/** 옆 칸을 닫는다. 초점이 그 안에 있었으면 상세 창 · 본문으로 돌려준다 — 칸과 함께 사라지면 body 로 빠진다. */
export function closingDock(close: () => void) {
	const inside = !!document.activeElement?.closest("[data-dock]");
	close();
	if (inside) requestAnimationFrame(() => void (focusRegion("sheet") || focusRegion("main")));
}
