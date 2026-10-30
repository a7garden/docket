import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

/**
 * Windows 알림. 실행이 끝났는데 창이 앞에 없을 때 events.ts 가 부르고, 설정 화면의 「보내 보기」도 쓴다.
 * 권한은 처음 보낼 때 한 번만 묻는다. 거절되면 이 켜짐 동안 다시 묻지 않는다 — 끝날 때마다 확인 창이 뜨지 않게.
 */

let asked: Promise<boolean> | null = null;

/** 알림 권한이 있는가. 없으면 한 번만 묻는다. */
export function ensurePermission(): Promise<boolean> {
	asked ??= (async () => {
		if (await isPermissionGranted()) return true;
		return (await requestPermission()) === "granted";
	})().catch(() => false);
	return asked;
}

/** 시스템 알림을 보낸다. 실패해도 앱 안 알림 흐름을 막지 않게 삼킨다. */
export async function systemNotify(title: string, body?: string) {
	try {
		if (await ensurePermission()) sendNotification({ title, body });
	} catch {
		/* 알림을 못 보내도 앱 안 알림은 그대로 뜬다 */
	}
}

/** 창이 앞에 없을 때만 보낸다. 앱을 보고 있으면 앱 안 알림으로 충분하다. */
export function notifyIfAway(on: boolean | undefined, title: string, body?: string) {
	if (on && !document.hasFocus()) void systemNotify(title, body);
}
