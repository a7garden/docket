import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { PluginPlace } from "./types";

export const qk = {
	info: ["info"] as const,
	usage: ["usage"] as const,
	spend: (days: number) => ["spend", days] as const,
	settings: ["settings"] as const,
	plugins: ["plugins"] as const,
	projects: ["projects"] as const,
	issues: (pid: string) => ["issues", pid] as const,
	talks: (pid: string) => ["talks", pid] as const,
	deliverables: (pid: string) => ["deliverables", pid] as const,
	resources: (pid: string | null) => ["resources", pid ?? ""] as const,
	kb: (pid: string) => ["kb", pid] as const,
	glossary: (pid: string) => ["glossary", pid] as const,
};

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
