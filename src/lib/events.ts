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
				// 대화 화면은 열어 두고 보는 것이라 끝났다는 알림도 띄우지 않는다.
				if (payload.talk) {
					qc.setQueryData<Issue[]>(qk.talks(payload.projectId), (old) => upsert(old, payload));
					return;
				}
				const key = qk.issues(payload.projectId);
				const prev = qc.getQueryData<Issue[]>(key)?.find((x) => x.id === payload.id);
				qc.setQueryData<Issue[]>(key, (old) => upsert(old, payload));

				const finished = prev?.run && !payload.run;
				const open = useUi.getState().issueId === payload.id;
				if (!finished || open) return;
				const go = {
					label: "열기",
					onClick: () => {
						const ui = useUi.getState();
						if (ui.projectId !== payload.projectId) ui.setProject(payload.projectId);
						if (ui.view !== "board" && ui.view !== "deliverables") ui.setView("board");
						useUi.getState().openIssue(payload.id);
					},
				};
				const name = `#${payload.number} ${payload.title}`;
				if (payload.error) toast.error(`${name} 실패`, { description: payload.error.slice(0, 160), action: go });
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
