import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

/**
 * 켤 때 한 번 GitHub 릴리즈의 latest.json 을 보고, 새 판이 있으면 알림으로 묻는다.
 * 바로 깔지 않는 까닭: 설치기가 앱을 끄면 돌던 claude 도 작업 개체째 꺼진다. 언제 깔지는 사용자가 고른다.
 */
export function useUpdater() {
	useEffect(() => {
		// 개발 판은 버전이 늘 같아 묻는 게 소음일 뿐이다.
		if (import.meta.env.DEV) return;
		let cancelled = false;
		check()
			.then((update) => {
				if (!update || cancelled) return;
				toast(`새 판 ${update.version} 이 나왔습니다`, {
					description: "설치하면 앱이 꺼졌다 다시 켜집니다. 돌던 Claude 실행은 멈춥니다.",
					duration: Infinity,
					action: {
						label: "설치",
						onClick: () => {
							const id = toast.loading(`${update.version} 받는 중`);
							update
								.downloadAndInstall()
								.then(() => relaunch())
								.catch((e) => toast.error("업데이트하지 못했습니다", { id, description: String(e) }));
						},
					},
				});
			})
			// 오프라인이거나 릴리즈가 아직 없으면 조용히 넘어간다. 다음에 켤 때 다시 본다.
			.catch((e) => console.warn("업데이트 확인 실패", e));
		return () => {
			cancelled = true;
		};
	}, []);
}
