import { Puzzle } from "lucide-react";
import { toast } from "sonner";
import { create } from "zustand";
import { type ActionList, attempt, copy } from "@/components/ActionMenu";
import { Markdown } from "@/components/Markdown";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { PluginMenu } from "@/lib/types";

/**
 * 플러그인이 더한 메뉴 항목과 그 결과. 플러그인 코드는 화면에서 돌지 않는다 — 돌려준 값(알림 · 열기 · 복사 · 마크다운)을 앱이 그린다.
 * 마크다운은 앱의 Markdown 으로 그리므로 원시 HTML · 스크립트는 그려지지 않는다.
 */

export type PluginMenuItem = PluginMenu & { pluginId: string; pluginName: string };

interface Context {
	projectId: string;
	issueId?: string;
	file?: string;
	/** when: changes 조건 */
	changes?: boolean;
	/** when: session 조건 */
	session?: boolean;
}

interface Shown {
	title: string;
	markdown: string;
	plugin: string;
}

const useShown = create<{ shown: Shown | null; set: (s: Shown | null) => void }>((set) => ({ shown: null, set: (shown) => set({ shown }) }));

export async function runPluginMenu(m: PluginMenuItem, ctx: Context) {
	const r = await api.pluginInvoke(m.pluginId, m.command, m.where, ctx.projectId, ctx.issueId, ctx.file);
	if (r.copy) await copy(r.copy, m.label);
	if (r.open) await api.open(r.open);
	if (r.markdown) useShown.getState().set({ title: r.title || m.label, markdown: r.markdown, plugin: m.pluginName });
	if (r.toast) toast(r.toast, { description: m.pluginName });
}

/** 메뉴 목록에 끼울 항목. 조건(when)이 맞지 않으면 보이되 누르지 못하게 한다 — 사라지면 왜 없는지 모른다. */
export function pluginActions(menus: PluginMenuItem[], ctx: Context): ActionList {
	return menus.map((m) => ({
		label: m.label,
		icon: <Puzzle />,
		disabled: (m.when === "changes" && !ctx.changes) || (m.when === "session" && !ctx.session),
		onSelect: () => void attempt(() => runPluginMenu(m, ctx)),
	}));
}

/** 플러그인이 돌려준 마크다운을 띄우는 창. 앱에 하나만 둔다(App.tsx). */
export function PluginResultDialog() {
	const { shown, set } = useShown();
	return (
		<Dialog open={!!shown} onOpenChange={(o) => !o && set(null)}>
			<DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
				<DialogTitle className="flex items-baseline gap-2 pr-8">
					<span className="min-w-0 truncate">{shown?.title}</span>
					<span className="shrink-0 text-[12px] font-normal text-subtle">{shown?.plugin}</span>
				</DialogTitle>
				<div className="min-h-0 overflow-y-auto selectable">{shown && <Markdown text={shown.markdown} />}</div>
			</DialogContent>
		</Dialog>
	);
}
