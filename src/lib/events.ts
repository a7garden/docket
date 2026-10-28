import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { qk, upsert } from "./queries";
import { useLive, useUi } from "./store";
import type { Deliverable, Issue, RunEnvelope } from "./types";

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

		return () => {
			for (const p of pending) void p.then((un) => un());
		};
	}, [qc]);
}
