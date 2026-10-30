import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { comboLabel, KEY_GROUPS, type KeyDef, useActiveKeys, useKey } from "@/lib/keys";

interface Row {
	label: string;
	keys: string;
}

/** 「Ctrl 1」 … 「Ctrl 5」 → 「Ctrl 1–5」, 「Ctrl Alt ↑」 · 「Ctrl Alt ↓」 → 「Ctrl Alt ↑↓」. */
function joinKeys(labels: string[]) {
	const parts = labels.map((l) => l.split(" "));
	const head = parts[0].slice(0, -1).join(" ");
	if (parts.some((p) => p.slice(0, -1).join(" ") !== head)) return labels.join(" · ");
	const tails = parts.map((p) => p[p.length - 1]);
	const nums = tails.map(Number);
	const run = nums.every((n, i) => Number.isInteger(n) && (i === 0 || n === nums[i - 1] + 1));
	const tail = run && tails.length > 2 ? `${tails[0]}–${tails[tails.length - 1]}` : tails.join("");
	return head ? `${head} ${tail}` : tail;
}

/** 등록된 키를 표의 줄로 만든다. 같은 series 는 처음 나온 자리에 한 줄로 모은다. 같은 id 가 두 번 등록됐으면 한 번만 적는다. */
function rowsOf(defs: KeyDef[]): Row[] {
	const seen = new Set<string>();
	const series = new Map<string, KeyDef[]>();
	const order: (KeyDef | string)[] = [];
	for (const d of defs) {
		if (seen.has(d.id)) continue;
		seen.add(d.id);
		if (!d.series) order.push(d);
		else if (series.has(d.series)) series.get(d.series)!.push(d);
		else {
			series.set(d.series, [d]);
			order.push(d.series);
		}
	}
	return order.map((o) => {
		if (typeof o !== "string") return { label: o.label, keys: o.confirm ? `${comboLabel(o.combo)} 두 번` : comboLabel(o.combo) };
		const ds = series.get(o)!;
		return { label: ds.map((d) => d.label).join(" · "), keys: joinKeys(ds.map((d) => comboLabel(d.combo))) };
	});
}

/** ? 로 여닫는 단축키 표. 지금 등록된 키만 보인다 — 상세 창이 닫혀 있으면 「상세 창」 묶음은 없다. */
export function KeyHelp() {
	const [open, setOpen] = useState(false);
	const defs = useActiveKeys();
	useKey({ id: "help", combo: "?", label: "단축키 표 열기 · 닫기", group: "어디서나", inInput: "skip", overModal: true, command: true, run: () => setOpen((o) => !o) });

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent
				// 열리자마자 닫기 단추에 초점 테두리가 생기면 표보다 단추가 먼저 눈에 띈다. 창 자체에 초점을 둔다.
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					(e.currentTarget as HTMLElement | null)?.focus();
				}}
				className="pop max-h-[80vh] gap-4 overflow-y-auto p-6 outline-none sm:max-w-md"
			>
				<DialogHeader>
					<DialogTitle>단축키</DialogTitle>
					<DialogDescription className="sr-only">지금 화면에서 쓸 수 있는 키</DialogDescription>
				</DialogHeader>
				{KEY_GROUPS.map((g) => {
					const rows = rowsOf(defs.filter((d) => d.group === g));
					if (!rows.length) return null;
					return (
						<section key={g} className="flex flex-col gap-1">
							<h3 className="text-[11.5px] font-semibold text-subtle">{g}</h3>
							{rows.map((r) => (
								<div key={r.label} className="flex min-h-7 items-center justify-between gap-4 text-[13px]">
									<span className="min-w-0 break-keep">{r.label}</span>
									<Kbd className="shrink-0">{r.keys}</Kbd>
								</div>
							))}
						</section>
					);
				})}
			</DialogContent>
		</Dialog>
	);
}
