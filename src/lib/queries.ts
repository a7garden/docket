import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const qk = {
	info: ["info"] as const,
	settings: ["settings"] as const,
	plugins: ["plugins"] as const,
	projects: ["projects"] as const,
	issues: (pid: string) => ["issues", pid] as const,
	deliverables: (pid: string) => ["deliverables", pid] as const,
	resources: (pid: string | null) => ["resources", pid ?? ""] as const,
};

export function useAppInfo() {
	return useQuery({ queryKey: qk.info, queryFn: api.appInfo, staleTime: 60_000 });
}

export function useSettings() {
	return useQuery({ queryKey: qk.settings, queryFn: api.settingsGet });
}

export function usePlugins() {
	return useQuery({ queryKey: qk.plugins, queryFn: api.plugins });
}

/** 「터미널에서 잇기」가 쓸 플러그인. 서버(plugins::terminal)와 같은 규칙이다 — 켜진 것 중 파일 이름 순으로 첫 터미널. 읽지 못한 정의도 켜 두었으면 고른다. */
export function useTerminalPlugin() {
	const { data } = usePlugins();
	return data?.plugins.find((p) => p.enabled && (p.kind === "terminal" || p.kind === ""));
}

export function useProjects() {
	return useQuery({ queryKey: qk.projects, queryFn: api.projects });
}

export function useIssues(pid: string | null) {
	return useQuery({ queryKey: qk.issues(pid ?? ""), queryFn: () => api.issues(pid!), enabled: !!pid });
}

export function useDeliverables(pid: string | null) {
	return useQuery({ queryKey: qk.deliverables(pid ?? ""), queryFn: () => api.deliverables(pid!), enabled: !!pid });
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
