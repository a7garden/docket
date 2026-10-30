import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useUi } from "./store";
import { GLOBAL_PID, type PluginPlace, type Project } from "./types";

export const qk = {
	info: ["info"] as const,
	usage: ["usage"] as const,
	spend: (days: number) => ["spend", days] as const,
	settings: ["settings"] as const,
	plugins: ["plugins"] as const,
	projects: ["projects"] as const,
	appProject: ["appProject"] as const,
	issues: (pid: string) => ["issues", pid] as const,
	talks: (pid: string) => ["talks", pid] as const,
	deliverables: (pid: string) => ["deliverables", pid] as const,
	resources: (pid: string | null) => ["resources", pid ?? ""] as const,
	kb: (pid: string) => ["kb", pid] as const,
	glossary: (pid: string) => ["glossary", pid] as const,
};

/**
 * 모든 프로젝트를 훑는 목록에 다는 옵션. 창에 돌아올 때 보던 프로젝트 것만 다시 읽는다 — 그러지 않으면 돌아올 때마다 모든 프로젝트 폴더를 훑는다.
 * 다른 프로젝트는 그 프로젝트를 열 때 보드가 새로 구독하며 낡은 값을 다시 읽는다.
 * 같은 쿼리를 구독한 곳 중 하나라도 허락하면 다시 읽으므로, 모든 프로젝트를 훑는 곳은 빠짐없이 이 옵션을 단다.
 * 보던 프로젝트는 창에 돌아온 그때 고른다 — 프로젝트를 바꿀 때마다 옵션이 바뀌지 않게.
 */
export function focusOnly(pid: string) {
	return { refetchOnWindowFocus: () => pid === useUi.getState().projectId };
}

export function useAppInfo() {
	return useQuery({ queryKey: qk.info, queryFn: api.appInfo, staleTime: 60_000 });
}

/** 구독 사용률. 새 값은 docket://usage 사건이 캐시에 끼우므로 다시 묻지 않는다. */
export function useUsage() {
	return useQuery({ queryKey: qk.usage, queryFn: api.usage, staleTime: Infinity });
}

/** 이 앱이 쓴 양. 사용량 창을 열 때마다 장부를 다시 읽는다 — 실행이 끝날 때마다 묻는 것보다 싸고, 연 순간의 값이면 된다. */
export function useSpend(days: number) {
	return useQuery({ queryKey: qk.spend(days), queryFn: () => api.spend(days), staleTime: 0 });
}

export function useSettings() {
	return useQuery({ queryKey: qk.settings, queryFn: api.settingsGet });
}

export function usePlugins() {
	return useQuery({ queryKey: qk.plugins, queryFn: api.plugins });
}

/** 「터미널에서 잇기」가 쓸 플러그인. 서버(plugin_host::terminal)와 같은 규칙이다 — 켜진 것 중 폴더 · 파일 이름 순으로 첫 터미널 기여. 읽지 못한 옛 정의도 켜 두었으면 고른다. */
export function useTerminalPlugin() {
	const { data } = usePlugins();
	return data?.plugins.find((p) => p.enabled && p.contributes.terminal);
}

/** 그 자리에 켜진 플러그인이 더한 메뉴 항목. 서버(PluginView::usable)와 같이 문제가 없고 권한을 다 허락한 것만 고른다. */
export function usePluginMenus(place: PluginPlace) {
	const { data } = usePlugins();
	return useMemo(
		() =>
			(data?.plugins ?? [])
				.filter((p) => p.enabled && !p.problem && p.missing.length === 0)
				.flatMap((p) => p.contributes.menus.filter((m) => m.where === place).map((m) => ({ ...m, pluginId: p.id, pluginName: p.name }))),
		[data, place],
	);
}

export function useProjects() {
	return useQuery({ queryKey: qk.projects, queryFn: api.projects });
}

/** 앱 대화의 가상 프로젝트. 경로는 앱 데이터 폴더라 바뀌지 않는다. 권한 칸은 저장할 때 캐시를 바꾼다. */
export function useAppProject() {
	return useQuery({ queryKey: qk.appProject, queryFn: api.appProject, staleTime: Infinity });
}

/** 앱 대화와 모든 프로젝트 대화. 대화 탭 목록 · 옆 칸이 함께 쓴다 — Ctrl+K 와 같은 쿼리 키라 캐시를 나눠 쓴다. */
export function useAllTalks(projects: Project[]) {
	const app = useTalks(GLOBAL_PID);
	const lists = useQueries({ queries: projects.map((p) => ({ queryKey: qk.talks(p.id), queryFn: () => api.talks(p.id), ...focusOnly(p.id) })) });
	const loading = app.isLoading || lists.some((l) => l.isLoading);
	return {
		app: app.data ?? [],
		byProject: projects.map((p, i) => ({ project: p, talks: lists[i]?.data ?? [] })),
		loading,
	};
}

export function useIssues(pid: string | null) {
	return useQuery({ queryKey: qk.issues(pid ?? ""), queryFn: () => api.issues(pid!), enabled: !!pid });
}

export function useTalks(pid: string | null) {
	return useQuery({ queryKey: qk.talks(pid ?? ""), queryFn: () => api.talks(pid!), enabled: !!pid });
}

export function useDeliverables(pid: string | null) {
	return useQuery({ queryKey: qk.deliverables(pid ?? ""), queryFn: () => api.deliverables(pid!), enabled: !!pid });
}

export function useKb(pid: string | null) {
	return useQuery({ queryKey: qk.kb(pid ?? ""), queryFn: () => api.kbStatus(pid!), enabled: !!pid });
}

export function useGlossary(pid: string | null) {
	return useQuery({ queryKey: qk.glossary(pid ?? ""), queryFn: () => api.glossary(pid!), enabled: !!pid });
}

export function useResources(pid: string | null) {
	return useQuery({ queryKey: qk.resources(pid), queryFn: () => api.resources(pid) });
}

export function upsert<T extends { id: string }>(list: T[] | undefined, item: T): T[] {
	if (!list) return [item];
	const i = list.findIndex((x) => x.id === item.id);
	if (i < 0) return [item, ...list];
	const next = list.slice();
	next[i] = item;
	return next;
}
