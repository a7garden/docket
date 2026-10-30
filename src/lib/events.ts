import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { qk, upsert } from "./queries";
import { useLive, useUi } from "./store";
import { notifyIfAway } from "./systemNotify";
import { type Deliverable, GLOBAL_PID, type Issue, type KbProgress, type KbView, type RunEnvelope, type Settings, type Usage } from "./types";

/**
 * Rust 가 보내는 사건을 받아 캐시를 고친다. 목록을 다시 불러오지 않고 바뀐 한 건만 끼운다.
 * 실행이 끝나 사용자 차례가 되면 알림을 띄운다. 그 이슈를 이미 열어 보고 있으면 띄우지 않는다.
 * 창이 앞에 없으면 설정 「시스템 알림」에 따라 Windows 알림으로도 알린다.
 */
export function useDocketEvents() {
	const qc = useQueryClient();

	useEffect(() => {
		const pending: Promise<UnlistenFn>[] = [];

		pending.push(
			listen<Issue>("docket://issue", ({ payload }) => {
				// 프로젝트 대화는 같은 사건으로 오지만 보드 목록에 끼우지 않는다. 끼우면 메모 열에 「제목 없는 메모」로 보인다.
				const key = payload.talk ? qk.talks(payload.projectId) : qk.issues(payload.projectId);
				const prev = qc.getQueryData<Issue[]>(key)?.find((x) => x.id === payload.id);
				qc.setQueryData<Issue[]>(key, (old) => upsert(old, payload));
				// 완료되거나 다시 열린 이슈는 산출물의 반영 대기 수를 바꾼다. 반영 대기는 목록을 읽을 때 세므로 다시 불러온다.
				if (prev && (prev.status === "done") !== (payload.status === "done")) void qc.invalidateQueries({ queryKey: qk.deliverables(payload.projectId) });

				// 사용자가 중지한 실행은 알리지 않는다. 알림함에서도 빠진다.
				const last = payload.runs[payload.runs.length - 1];
				const finished = prev?.run && !payload.run && last?.status !== "stopped";
				const ui = useUi.getState();
				// 대화는 대화 화면에서 그 대화를 보고 있을 때만 「보고 있다」고 친다. 다른 화면에 가 있으면 답이 온 줄 모른다.
				// 옆 칸에 띄워 둔 대화는 어느 화면에서든 보고 있는 것이다.
				const open = payload.talk
					? (ui.dock.open && ui.dock.talk?.id === payload.id) ||
						((ui.view === "talks" || ui.view === "allTalks") && ui.talk?.id === payload.id)
					: ui.issueId === payload.id;
				if (!finished) return;
				const name = payload.talk ? `${payload.projectId === GLOBAL_PID ? "앱 대화" : "대화"} · ${payload.title || "새 대화"}` : `#${payload.number} ${payload.title}`;
				// 계획 · 결과 단계의 이슈에 물은 답도 상태는 그대로라, 상태보다 실행 종류를 먼저 본다.
				const n = payload.error
					? { title: `${name} 실패`, description: payload.error.slice(0, 160), error: true }
					: last?.kind === "chat"
						? { title: `${name} 답이 왔습니다` }
						: payload.status === "planned"
							? { title: `${name} 계획이 나왔습니다` }
							: payload.status === "review"
								? { title: `${name} 구현이 끝났습니다`, description: "바뀐 파일을 확인하세요" }
								: null;
				if (!n) return;
				// 시스템 알림은 창이 앞에 없을 때 보낸다. 그 대상을 열어 두었어도 다른 창에 가 있으면 끝난 줄 모른다.
				notifyIfAway(qc.getQueryData<Settings>(qk.settings)?.systemNotify, n.title, n.description);
				if (open) return;
				const go = {
					label: "열기",
					onClick: () => useUi.getState().openTarget({ projectId: payload.projectId, target: "issue", id: payload.id, talk: payload.talk }),
				};
				if (n.error) toast.error(n.title, { description: n.description, action: go });
				else toast(n.title, { description: n.description, action: go });
			}),
		);
		pending.push(
			listen<{ projectId: string; id: string }>("docket://issue-removed", ({ payload }) => {
				qc.setQueryData<Issue[]>(qk.issues(payload.projectId), (old) => old?.filter((x) => x.id !== payload.id));
				qc.setQueryData<Issue[]>(qk.talks(payload.projectId), (old) => old?.filter((x) => x.id !== payload.id));
			}),
		);
		pending.push(
			listen<Deliverable>("docket://deliverable", ({ payload }) => {
				const key = qk.deliverables(payload.projectId);
				const prev = qc.getQueryData<Deliverable[]>(key)?.find((x) => x.id === payload.id);
				qc.setQueryData<Deliverable[]>(key, (old) => upsert(old, payload));
				if (!prev?.job || payload.job) return;
				const title = payload.error ? `「${payload.title || "문서"}」 작성 실패` : `「${payload.title}」 작성이 끝났습니다`;
				const description = payload.error ? payload.error.slice(0, 160) : undefined;
				notifyIfAway(qc.getQueryData<Settings>(qk.settings)?.systemNotify, title, description);
				if (useUi.getState().deliverableId === payload.id) return;
				if (payload.error) toast.error(title, { description });
				else toast(title);
			}),
		);
		pending.push(
			listen<{ projectId: string; id: string }>("docket://deliverable-removed", ({ payload }) => {
				qc.setQueryData<Deliverable[]>(qk.deliverables(payload.projectId), (old) => old?.filter((x) => x.id !== payload.id));
			}),
		);
		// 플러그인이 docket_notify 로 띄운 알림. 어느 플러그인이 띄웠는지 함께 보인다.
		pending.push(listen<{ plugin: string; text: string }>("docket://plugin-notice", ({ payload }) => void toast(payload.text, { description: payload.plugin })));
		pending.push(listen<RunEnvelope>("docket://run", ({ payload }) => useLive.getState().push(payload)));
		pending.push(listen<Usage>("docket://usage", ({ payload }) => qc.setQueryData(qk.usage, payload)));
		// 색인 진행은 자주 온다. 진행 칸만 바로 고치고, 한 단계가 끝날 때 목록을 다시 읽는다.
		pending.push(
			listen<{ projectId: string; progress: KbProgress }>("docket://kb", ({ payload }) => {
				const key = qk.kb(payload.projectId);
				const prev = qc.getQueryData<KbView>(key);
				qc.setQueryData<KbView>(key, (old) => (old ? { ...old, progress: payload.progress } : old));
				if (!payload.progress.running || prev?.progress.stage !== payload.progress.stage) void qc.invalidateQueries({ queryKey: key });
			}),
		);

		return () => {
			for (const p of pending) void p.then((un) => un());
		};
	}, [qc]);
}
