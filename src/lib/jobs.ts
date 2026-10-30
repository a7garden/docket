import { useQueries } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { focusOnly, qk, useProjects } from "@/lib/queries";
import { RUN_KIND_LABEL } from "@/lib/status";
import type { Project } from "@/lib/types";

export interface Job {
	key: string;
	project: Project;
	target: "issue" | "deliverable";
	id: string;
	label: string;
	what: string;
	phase: "running" | "queued";
	/** 프로젝트 대화. 누르면 보드가 아니라 대화 화면으로 간다. */
	talk?: boolean;
	/** 산출물의 작성법 뽑기. 멈출 때 부르는 명령과 실시간 사건 칸이 작성과 다르다. */
	learn?: boolean;
}

/**
 * 모든 프로젝트에서 실행 · 대기 중인 이슈 · 산출물 작성 · 작성법 뽑기. 사건으로 캐시가 고쳐지므로 따로 다시 묻지 않는다.
 * 창 닫기 경고와 업데이트 설치 경고가 함께 쓴다. 따로 세면 두 경고의 건수가 어긋난다.
 */
export function useJobs(): Job[] {
	const { data: projects = [] } = useProjects();
	const issues = useQueries({ queries: projects.map((p) => ({ queryKey: qk.issues(p.id), queryFn: () => api.issues(p.id), ...focusOnly(p.id) })) });
	const docs = useQueries({ queries: projects.map((p) => ({ queryKey: qk.deliverables(p.id), queryFn: () => api.deliverables(p.id), ...focusOnly(p.id) })) });
	const talks = useQueries({ queries: projects.map((p) => ({ queryKey: qk.talks(p.id), queryFn: () => api.talks(p.id), ...focusOnly(p.id) })) });
	const out: Job[] = [];
	projects.forEach((project, n) => {
		// 대화는 번호가 없다. #0 대신 「대화 · 제목」으로 부른다.
		for (const t of talks[n]?.data ?? [])
			if (t.run)
				out.push({ key: `t:${t.id}`, project, target: "issue", id: t.id, label: `대화 · ${t.title || "새 대화"}`, what: RUN_KIND_LABEL[t.run.kind] ?? t.run.kind, phase: t.run.phase, talk: true });
		for (const i of issues[n]?.data ?? [])
			if (i.run)
				out.push({
					key: `i:${i.id}`,
					project,
					target: "issue",
					id: i.id,
					label: `#${i.number} ${i.title || "제목 없는 메모"}`,
					what: RUN_KIND_LABEL[i.run.kind] ?? i.run.kind,
					phase: i.run.phase,
				});
		for (const d of docs[n]?.data ?? []) {
			if (d.job)
				out.push({ key: `d:${d.id}`, project, target: "deliverable", id: d.id, label: d.title || "제목 없는 문서", what: "문서 작성", phase: d.job.phase });
			// 작성과 함께 돌 수 있어 따로 한 줄을 둔다.
			if (d.learn)
				out.push({ key: `l:${d.id}`, project, target: "deliverable", id: d.id, label: d.title || "제목 없는 문서", what: "작성법 뽑기", phase: d.learn.phase ?? "running", learn: true });
		}
	});
	// 실행 중인 것을 위로. 줄 서 있는 것은 그 아래에 프로젝트별로 모인다.
	return out.sort((a, b) => Number(a.phase === "queued") - Number(b.phase === "queued"));
}
