import { useMemo, useState } from "react";
import { ChevronRight, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import type { FileChange, Hunk } from "@/lib/types";
import { cn } from "@/lib/utils";
import { type ActionList, ContextActions, copy, fileActions } from "./ActionMenu";
import { Button } from "./ui/button";
import { Diffstat } from "./bits";

const MAX_LINES = 400;

function count(changes: FileChange[]) {
	let added = 0;
	let removed = 0;
	for (const c of changes)
		for (const h of c.hunks)
			for (const l of h.lines) {
				if (l.startsWith("+")) added++;
				else if (l.startsWith("-")) removed++;
			}
	return { added, removed };
}

/** 같은 파일을 여러 번 고쳤으면 한 묶음으로 보인다. 고친 순서는 그대로 둔다. */
export function DiffView({ changes }: { changes: FileChange[] }) {
	const groups = useMemo(() => {
		const map = new Map<string, FileChange[]>();
		for (const c of changes) {
			const list = map.get(c.rel) ?? [];
			list.push(c);
			map.set(c.rel, list);
		}
		return [...map.entries()];
	}, [changes]);

	return (
		<div className="flex flex-col gap-2">
			{groups.map(([rel, list]) => (
				<FileDiff key={rel} rel={rel} list={list} />
			))}
		</div>
	);
}

function FileDiff({ rel, list }: { rel: string; list: FileChange[] }) {
	const [open, setOpen] = useState(true);
	const [all, setAll] = useState(false);
	const { added, removed } = count(list);
	const created = list[0].kind === "create";
	const hunks = list.flatMap((c) => c.hunks);
	const total = hunks.reduce((n, h) => n + h.lines.length, 0);

	let shown = 0;
	// 머리 줄에만 건다. 변경분 본문은 글을 골라 복사하는 자리라 기본 메뉴를 그대로 둔다.
	const menu: ActionList = [
		...fileActions(list[0].path),
		{ label: "저장소 기준 경로 복사", icon: <Copy />, onSelect: () => void copy(rel, "경로") },
		"sep",
		{ label: open ? "접기" : "펼치기", icon: <ChevronRight />, onSelect: () => setOpen((v) => !v) },
	];
	return (
		<div className="surface overflow-hidden rounded-lg">
			<ContextActions items={menu}>
				<div className="flex h-9 items-center gap-2 pr-1.5 pl-2">
					<button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" onClick={() => setOpen((v) => !v)}>
						<ChevronRight className={cn("size-3.5 shrink-0 text-subtle transition-transform", open && "rotate-90")} />
						<span className="mono min-w-0 truncate text-[12.5px]" title={list[0].path}>
							{rel}
						</span>
						{created && <span className="shrink-0 text-[11px] text-ok">새 파일</span>}
						{list.length > 1 && <span className="shrink-0 text-[11px] text-subtle">{list.length}번 고침</span>}
					</button>
					<Diffstat added={added} removed={removed} />
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="파일 열기"
						title="기본 프로그램으로 열기"
						onClick={() => api.open(list[0].path).catch((e) => toast.error(errorText(e)))}
					>
						<ExternalLink />
					</Button>
				</div>
			</ContextActions>
			{open && (
				<div className="mono overflow-x-auto border-t border-border text-[12px] leading-[1.6] selectable">
					{hunks.map((h, i) => {
						if (!all && shown >= MAX_LINES) return null;
						const room = all ? Infinity : MAX_LINES - shown;
						shown += Math.min(h.lines.length, room);
						return <HunkRows key={i} hunk={h} limit={room} />;
					})}
					{!all && total > MAX_LINES && (
						<button type="button" className="w-full py-2 text-center font-sans text-[12px] text-subtle hover:text-foreground" onClick={() => setAll(true)}>
							나머지 {total - MAX_LINES}줄 펼치기
						</button>
					)}
				</div>
			)}
		</div>
	);
}

function HunkRows({ hunk, limit }: { hunk: Hunk; limit: number }) {
	let o = hunk.oldStart;
	let n = hunk.newStart;
	const rows = hunk.lines.slice(0, limit).map((line, i) => {
		const sign = line[0];
		const text = line.slice(1);
		let a: number | "" = "";
		let b: number | "" = "";
		if (sign === "-") a = o++;
		else if (sign === "+") b = n++;
		else if (sign === "\\") return null;
		else {
			a = o++;
			b = n++;
		}
		return (
			<div
				key={i}
				className={cn(
					"flex min-w-fit",
					sign === "+" && "bg-ok/10",
					sign === "-" && "bg-danger/10",
				)}
			>
				<span className="w-11 shrink-0 pr-2 text-right text-subtle/70 tabular select-none">{a}</span>
				<span className="w-11 shrink-0 pr-2 text-right text-subtle/70 tabular select-none">{b}</span>
				<span className={cn("w-4 shrink-0 select-none", sign === "+" ? "text-ok" : sign === "-" ? "text-danger" : "text-subtle")}>{sign === " " ? "" : sign}</span>
				<span className="pr-4 whitespace-pre">{text}</span>
			</div>
		);
	});
	return (
		<div className="border-b border-border last:border-b-0">
			<div className="bg-secondary px-3 py-0.5 text-[11px] text-subtle select-none">
				@@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
			</div>
			{rows}
		</div>
	);
}
