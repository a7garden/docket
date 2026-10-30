/** 한글 음절의 초성. 유니코드 음절 블록은 초성 × 588 칸씩 늘어서 있다. */
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

function choseong(s: string) {
	let out = "";
	for (const ch of s) {
		const c = ch.charCodeAt(0) - 0xac00;
		out += c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
	}
	return out;
}

/** 대소문자 · 띄어쓰기를 가리지 않는다. 「docket 산출물」과 「docket산출물」이 같은 검색어다. */
export function normalize(s: string) {
	return s.toLowerCase().replace(/\s+/g, "");
}

/** 검색어가 자음만으로 되어 있는지. 그때만 초성으로 견준다 — 「ㄱ」 하나가 「가」로 시작하는 모든 제목에 걸리면 안 되니 일반 글자와 섞이면 보지 않는다. */
function onlyCho(q: string) {
	return /^[ㄱ-ㅎ]+$/.test(q);
}

/**
 * 검색어가 글에 얼마나 맞는지. 0 이면 맞지 않는다.
 * 완전 일치 > 앞부분 일치 > 포함 > 초성 순이다. 같은 묶음 안에서 이 점수로 줄을 세운다.
 * `q` 는 normalize 를 거친 값이어야 한다 — 줄마다 다시 다듬지 않게 부르는 쪽에서 한 번만 한다.
 */
export function matchScore(q: string, text: string) {
	if (!q) return 0;
	const t = normalize(text);
	if (t === q) return 100;
	if (t.startsWith(q)) return 80;
	if (t.includes(q)) return 60;
	if (onlyCho(q)) {
		const c = choseong(t);
		if (c.startsWith(q)) return 45;
		if (c.includes(q)) return 40;
	}
	return 0;
}

/** 「#42」 · 「42」 꼴이면 번호로 본다. 번호가 같으면 제목보다 앞에, 앞자리만 같으면(#4 → #42) 포함만큼 둔다. */
export function numberScore(q: string, n: number) {
	const m = /^#?(\d+)$/.exec(q);
	if (!m) return 0;
	const s = String(n);
	if (s === m[1]) return 120;
	return s.startsWith(m[1]) ? 70 : 0;
}
