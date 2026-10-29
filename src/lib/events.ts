import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { qk, upsert } from "./queries";
import { useLive, useUi } from "./store";
import type { Deliverable, Issue, KbProgress, KbView, RunEnvelope, Usage } from "./types";

/**
 * Rust 가 보내는 사건을 받아 캐시를 고친다. 목록을 다시 불러오지 않고 바뀐 한 건만 끼운다.
 * 실행이 끝나 사용자 차례가 되면 알림을 띄운다. 그 이슈를 이미 열어 보고 있으면 띄우지 않는다.
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

				// 사용자가 중지한 실행은 알리지 않는다. 알림함에서도 빠진다.
				const last = payload.runs[payload.runs.length - 1];
				const finished = prev?.run && !payload.run && last?.status !== "stopped";
				const ui = useUi.getState();
				// 대화는 대화 화면에서 그 대화를 보고 있을 때만 「보고 있다」고 친다. 다른 화면에 가 있으면 답이 온 줄 모른다.
				const open = payload.talk ? ui.view === "talks" && ui.talkId === payload.id : ui.issueId === payload.id;
				if (!finished || open) return;
				const go = {
					label: "열기",
					onClick: () => useUi.getState().openTarget({ projectId: payload.projectId, target: "issue", id: payload.id, talk: payload.talk }),
				};
				const name = payload.talk ? `대화 · ${payload.title || "새 대화"}` : `#${payload.number} ${payload.title}`;
				if (payload.error) toast.error(`${name} 실패`, { description: payload.error.slice(0, 160), action: go });
				// 계획 · 결과 단계의 이슈에 물은 답도 상태는 그대로라, 상태보다 실행 종류를 먼저 본다.
				else if (last?.kind === "chat") toast(`${name} 답이 왔습니다`, { action: go });
				else if (payload.status === "planned") toast(`${name} 계획이 나왔습니다`, { action: go });
				else if (payload.status === "review") toast(`${name} 구현이 끝났습니다`, { description: "바뀐 파일을 확인하세요", action: go });
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
				if (prev?.job && !payload.job && useUi.getState().deliverableId !== payload.id) {
					if (payload.error) toast.error(`「${payload.title || "문서"}」 작성 실패`, { description: payload.error.slice(0, 160) });
					else toast(`「${payload.title}」 작성이 끝났습니다`);
				}
			}),
		);
		pending.push(
			listen<{ projectId: string; id: string }>("docket://deliverable-removed", ({ payload }) => {
				qc.setQueryData<Deliverable[]>(qk.deliverables(payload.projectId), (old) => old?.filter((x) => x.id !== payload.id));
			}),
		);
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
