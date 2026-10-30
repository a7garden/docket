import { useState } from "react";
import { Bell, Check, PanelRight } from "lucide-react";
import { relTime } from "@/lib/format";
import { keyAnchor, useCommands, useKey } from "@/lib/keys";
import { type Notice, type NoticeTone, useNotices, usePruneSeen, useSeen } from "@/lib/notices";
import { roveItem, useRovingList } from "@/lib/rovingList";
import { useUi } from "@/lib/store";
import { cn } from "@/lib/utils";
import { type ActionList, ContextActions } from "./ActionMenu";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

const DOT: Record<NoticeTone, string> = { brand: "bg-brand", ok: "bg-ok", danger: "bg-danger" };

/** 제목 줄의 알림함. 모든 프로젝트에서 끝났는데 아직 열어 보지 않은 대화 답 · 계획 · 구현 · 실패 · 산출물을 모은다. */
export function NoticeCenter() {
	const notices = useNotices();
	usePruneSeen();
	const [open, setOpen] = useState(false);
	const rove = useRovingList();
	const go = (n: Notice) => {
		useSeen.getState().mark(n.id, n.at);
		useUi.getState().openTarget(n);
		setOpen(false);
	};
	useKey({ id: "notices", combo: "Mod+Shift+N", label: "알림함 열고 닫기", group: "어디서나", overModal: true, command: true, run: () => setOpen((o) => !o) });
	useCommands(notices.length ? [{ label: "알림 모두 읽음", onSelect: () => useSeen.getState().markAll(notices.map((n) => n.id)) }] : []);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					{...keyAnchor("notices")}
					aria-label={notices.length ? `확인할 것 ${notices.length}건` : "알림"}
					title={notices.length ? `확인할 것 ${notices.length}건` : "확인할 것이 없습니다"}
					className="relative grid size-7 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-hover data-[state=open]:text-foreground [&_svg]:size-4"
				>
					<Bell />
					{notices.length > 0 && (
						<span className="tabular absolute -top-0.5 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-none font-bold text-brand-ink">
							{notices.length > 99 ? "99+" : notices.length}
						</span>
					)}
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="pop w-96 p-0"
				// 「모두 읽음」이 아니라 첫 알림에서 시작한다. 알림을 열어 보려고 연 창이다.
				onOpenAutoFocus={(e) => {
					const first = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-rove]");
					if (!first) return;
					e.preventDefault();
					first.focus();
				}}
			>
				<div className="flex items-center justify-between border-b border-border px-3 py-2">
					<span className="text-[12px] font-semibold text-muted-foreground">확인할 것 {notices.length}</span>
					<Button size="xs" variant="ghost" disabled={!notices.length} onClick={() => useSeen.getState().markAll(notices.map((n) => n.id))}>
						<Check />
						모두 읽음
					</Button>
				</div>
				{notices.length ? (
					<ul {...rove} className="flex max-h-96 flex-col overflow-y-auto py-1">
						{notices.map((n) => (
							<NoticeRow key={n.key} notice={n} onOpen={() => go(n)} />
						))}
					</ul>
				) : (
					<p className="px-3 py-8 text-center text-[13px] text-subtle">확인할 것이 없습니다</p>
				)}
			</PopoverContent>
		</Popover>
	);
}

function NoticeRow({ notice: n, onOpen }: { notice: Notice; onOpen: () => void }) {
	const menu: ActionList = [
		{ label: n.talk ? "대화 열기" : n.target === "issue" ? "이슈 열기" : "산출물 열기", icon: <PanelRight />, onSelect: onOpen },
		{ label: "읽음으로", icon: <Check />, onSelect: () => useSeen.getState().mark(n.id, n.at) },
	];
	return (
		<ContextActions items={menu} className="w-44">
			<li>
				<button type="button" onClick={onOpen} {...roveItem()} className="flex w-full items-start gap-2.5 px-3 py-2 text-left outline-none hover:bg-hover focus-visible:bg-hover">
					<span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", DOT[n.tone])} />
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="truncate text-[13px] font-medium">{n.title}</span>
						<span className={cn("truncate text-[11.5px]", n.tone === "danger" ? "text-danger" : "text-subtle")}>{n.what}</span>
						<span className="truncate text-[11.5px] text-subtle">
							{n.project.name} · {relTime(n.at)}
						</span>
					</span>
				</button>
			</li>
		</ContextActions>
	);
}
