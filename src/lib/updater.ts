import { useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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
	check: () => Promise<Update | null>;
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
	requestInstall: () => {
		const { update, phase } = get();
		if (update && phase !== "downloading") set({ confirming: true });
	},
	check: async () => {
		if (get().phase === "checking" || get().phase === "downloading") return get().update;
		set({ phase: "checking", error: "" });
		try {
			const update = await check();
			set({ phase: update ? "available" : "latest", update, checkedAt: Date.now() });
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

/**
 * 켤 때 한 번 GitHub 릴리즈의 latest.json 을 보고, 새 판이 있으면 알림으로 묻는다.
 * 바로 깔지 않는 까닭: 설치기가 앱을 끄면 돌던 claude 도 작업 개체째 꺼진다. 언제 깔지는 사용자가 고른다.
 */
export function useUpdater() {
	useEffect(() => {
		// 개발 판은 버전이 늘 같아 묻는 게 소음일 뿐이다. 설정 화면의 「업데이트 확인」은 개발 판에서도 된다.
		if (import.meta.env.DEV) return;
		useUpdate
			.getState()
			.check()
			.then((update) => {
				if (!update) return;
				toast(`새 판 ${update.version} 이 나왔습니다`, {
					description: "설정 › 업데이트에서 바뀐 내용을 봅니다. 설치하면 앱이 꺼졌다 다시 켜집니다.",
					duration: Infinity,
					action: { label: "설치", onClick: () => useUpdate.getState().requestInstall() },
				});
			})
			// 오프라인이거나 릴리즈가 아직 없으면 조용히 넘어간다. 다음에 켤 때 다시 본다.
			.catch((e) => console.warn("업데이트 확인 실패", e));
	}, []);
}
