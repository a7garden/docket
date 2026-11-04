import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

// 주 창과 빠른 메모 창이 함께 쓴다. 창마다 html 의 dark 클래스와 창 바탕색을 따로 입혀야 한다.

/** index.html 이 첫 화면 전에 읽는 키다. */
const THEME_KEY = "docket.theme";
/** --background 를 sRGB 로 옮긴 값. 창 크기를 바꿀 때 화면보다 먼저 드러나는 창 바탕이다. lib.rs 의 시작 색과 같다. */
const WINDOW_BG = { dark: "#161616", light: "#f7f7f7" };

/** 설정의 테마를 html 의 dark 클래스로 옮기고, 실제로 입힌 쪽을 돌려준다. 「시스템」이면 OS 설정이 바뀌는 대로 따라간다. */
export function useTheme(theme: string | undefined): "dark" | "light" {
	const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
	useEffect(() => {
		// 설정이 오기 전에는 index.html 이 입힌 지난번 테마를 그대로 둔다.
		if (theme === undefined) return;
		try {
			localStorage.setItem(THEME_KEY, theme);
		} catch {
			// 저장소를 못 쓰면 다음에 켤 때 한 번 번쩍일 뿐이다.
		}
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const d = theme === "dark" || (theme === "system" && mq.matches);
			document.documentElement.classList.toggle("dark", d);
			setDark(d);
			getCurrentWindow()
				.setBackgroundColor(d ? WINDOW_BG.dark : WINDOW_BG.light)
				.catch(() => {});
		};
		apply();
		mq.addEventListener("change", apply);
		return () => mq.removeEventListener("change", apply);
	}, [theme]);
	return dark ? "dark" : "light";
}
