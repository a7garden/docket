import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { create } from "zustand";

type Phase = "idle" | "checking" | "latest" | "available" | "downloading" | "error";

interface UpdateState {
	phase: Phase;
	/** 새 판이 있을 때만 있다. version · body(그 판의 바뀐 내용) · date 를 담는다. */
	update: Update | null;
	/** 받은 바이트 / 전체 바이트. 서버가 크기를 안 주면 전체가 0 이다. */
	progress: { done: number; total: number };
	error: string;
	checkedAt: number | null;
	/** 설치를 눌러 UpdateConfirm 이 돌고 있는 실행을 보고 있다. 실행이 없으면 바로 깔고 끈다. */
	confirming: boolean;
	/** 알림을 띄운 판. 같은 판을 간격마다 다시 알리지 않게 한다. */
	notifiedVersion: string;
	/** 설치본에서 돌고 있는지. 소스에서 띄운 앱은 설치 대신 릴리즈 페이지로 보낸다. 묻기 전에는 false 다. */
	installable: boolean;
	/** 자동 확인의 마지막 오류. phase 를 덮지 않으려고 따로 둔다. 다음 확인이 성공하면 지운다. */
	autoError: string;
	/** 다음 자동 확인 시각. 실패하면 앞당겨진다. */
	nextAt: number;
	/** 연달아 실패한 수. */
	fails: number;
	/**
	 * silent 는 자동 확인이다. 화면을 「확인하는 중」으로 바꾸지 않고, 실패해도 상태를 error 로 덮지 않는다.
	 * 설치를 묻거나 받는 중이면 건너뛴다. 그 사이 update 개체가 바뀌면 사용자가 본 것과 다른 판이 깔린다.
	 */
	check: (opts?: { silent?: boolean }) => Promise<Update | null>;
	/** 토스트 · 설정의 설치 단추가 부른다. 실행 수는 화면 쪽 훅에서만 알 수 있어 묻는 일은 UpdateConfirm 이 한다. */
	requestInstall: () => void;
	install: () => Promise<void>;
}

/** 설정 화면과 켤 때의 알림이 같은 상태를 본다. 따로 두면 알림으로 받는 중에 설정에서 또 받는다. */
export const useUpdate = create<UpdateState>()((set, get) => ({
	phase: "idle",
	update: null,
	progress: { done: 0, total: 0 },
	error: "",
	checkedAt: null,
	confirming: false,
	notifiedVersion: "",
	installable: false,
	autoError: "",
	nextAt: 0,
	fails: 0,
	requestInstall: () => {
		const { update, phase } = get();
		if (update && phase !== "downloading") set({ confirming: true });
	},
	check: async (opts) => {
		if (get().phase === "checking" || get().phase === "downloading") return get().update;
		if (opts?.silent) {
			if (get().confirming) return get().update;
			try {
				const update = await check();
				// 기다리는 사이 설치를 눌렀으면 받은 결과를 버린다.
				if (get().confirming || get().phase === "downloading" || get().phase === "checking") return get().update;
				set({ phase: update ? "available" : "latest", update, error: "", checkedAt: Date.now(), ...succeeded() });
				return update;
			} catch (e) {
				// 오프라인이거나 latest.json 이 아직 안 올라왔으면 알림 없이 넘어가고 설정 화면에만 보인다. 켤 때 VPN 이 안 붙은 경우가 있어 한 시간을 기다리지 않는다.
				console.warn("업데이트 자동 확인 실패", e);
				const fails = get().fails + 1;
				set({ autoError: String(e), fails, checkedAt: Date.now(), nextAt: Date.now() + retryAfterMs(fails) });
				return null;
			}
		}
		set({ phase: "checking", error: "" });
		try {
			const update = await check();
			set({ phase: update ? "available" : "latest", update, checkedAt: Date.now(), ...succeeded() });
			return update;
		} catch (e) {
			set({ phase: "error", error: String(e), checkedAt: Date.now() });
			throw e;
		}
	},
	install: async () => {
		const { update, phase } = get();
		if (!update || phase === "downloading") return;
		set({ phase: "downloading", progress: { done: 0, total: 0 }, error: "" });
		try {
			await update.downloadAndInstall((ev) => {
				if (ev.event === "Started") set({ progress: { done: 0, total: ev.data.contentLength ?? 0 } });
				else if (ev.event === "Progress") set((s) => ({ progress: { ...s.progress, done: s.progress.done + ev.data.chunkLength } }));
			});
			// Windows 는 설치기가 앱을 먼저 끄므로 여기까지 오지 않는다. 다른 OS 를 위해 남긴다.
			await relaunch();
		} catch (e) {
			set({ phase: "error", error: String(e) });
			throw e;
		}
	},
}));

/** 2026.10.29 : 1시간. 같은 날 판이 여러 번 나와도 한 시간 안에 알도록. 받는 것은 작은 latest.json 하나다. */
const CHECK_EVERY_MS = 60 * 60_000;
/** 때가 됐는지 보는 주기. 절전에서 깨어난 뒤에도 늦어도 이만큼 안에 확인한다. setInterval 하나를 한 시간으로 두면 잠든 시간만큼 밀린다. */
const POLL_MS = 5 * 60_000;
/** 창으로 돌아왔을 때 마지막 확인이 이보다 오래됐으면 다시 본다. 창을 오갈 때마다 묻지 않게 한다. */
const FOCUS_CHECK_MS = 10 * 60_000;
/** 릴리즈 페이지. 소스에서 띄운 앱은 여기서 받는다. */
const RELEASES_URL = "https://github.com/a7garden/docket/releases/latest";
/** 마지막 자동 확인을 시작한 때. 확인이 도는 사이 창을 오가도 또 부르지 않게 한다. */
let lastTry = 0;

/** 실패 뒤 다음 확인까지. 연달아 n 번째면 5 · 10 · 20 · 40 · 60분이다. */
export function retryAfterMs(fails: number) {
	return Math.min(5 * 2 ** (Math.max(fails, 1) - 1), 60) * 60_000;
}

function succeeded() {
	return { autoError: "", fails: 0, nextAt: Date.now() + CHECK_EVERY_MS };
}

/** 설치본이면 설치 창을 띄우고, 소스에서 띄운 앱이면 릴리즈 페이지를 연다. */
export function openUpdate() {
	if (useUpdate.getState().installable) useUpdate.getState().requestInstall();
	else void openUrl(RELEASES_URL);
}

/** 새 판 알림. 같은 id 로 띄워 판이 또 바뀌면 옛 알림을 갈아 끼운다. */
function notify(update: Update) {
	if (useUpdate.getState().notifiedVersion === update.version) return;
	useUpdate.setState({ notifiedVersion: update.version });
	const installable = useUpdate.getState().installable;
	toast(`새 판 ${update.version} 이 나왔습니다`, {
		id: "update-available",
		description: installable ? "설정 › 업데이트에서 바뀐 내용을 봅니다. 설치하면 앱이 꺼졌다 다시 켜집니다." : "소스에서 띄운 앱이라 릴리즈 페이지에서 받습니다.",
		duration: Infinity,
		action: { label: installable ? "설치" : "받으러 가기", onClick: openUpdate },
	});
}

/**
 * 켤 때와 켜 둔 동안 한 시간마다 GitHub 릴리즈의 latest.json 을 보고, 새 판이 처음 보이면 알림으로 묻는다.
 * 실패하면 5분부터 늘려 가며 다시 보고, 창이 다시 보일 때도 마지막 확인이 10분을 넘겼으면 본다. 설정 › 업데이트의 「자동으로 확인」으로 끈다.
 * 바로 깔지 않는 까닭: 설치기가 앱을 끄면 돌던 claude 도 작업 개체째 꺼진다. 언제 깔지는 사용자가 고른다.
 */
export function useUpdater(enabled: boolean | undefined) {
	useEffect(() => {
		void api.updateInstallable().then((installable) => useUpdate.setState({ installable }));
	}, []);
	useEffect(() => {
		// 개발 판은 버전이 늘 같아 묻는 게 소음일 뿐이다. 설정 화면의 「업데이트 확인」은 개발 판에서도 된다.
		// 설정을 아직 못 읽었으면(undefined) 꺼 둔 사람에게 묻지 않도록 기다린다.
		if (import.meta.env.DEV || !enabled) return;
		const run = () => {
			lastTry = Date.now();
			void useUpdate
				.getState()
				.check({ silent: true })
				.then((update) => update && notify(update));
		};
		// 때가 됐는지는 nextAt 하나로 본다. 손으로 확인하면 뒤로 밀리고, 실패하면 앞당겨진다.
		const tick = () => {
			if (Date.now() >= useUpdate.getState().nextAt) run();
		};
		const onVisible = () => {
			const last = Math.max(lastTry, useUpdate.getState().checkedAt ?? 0);
			if (document.visibilityState === "visible" && Date.now() - last > FOCUS_CHECK_MS) run();
		};
		tick();
		const t = setInterval(tick, POLL_MS);
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearInterval(t);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [enabled]);
}
