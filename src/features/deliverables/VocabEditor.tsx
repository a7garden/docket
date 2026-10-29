import { type KeyboardEvent, useState } from "react";
import { ArrowUpToLine, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Term } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 피할 말은 「·」 나 쉼표로 나눠 적는다. */
export const splitAvoid = (s: string) =>
	s
		.split(/[·,]/)
		.map((x) => x.trim())
		.filter(Boolean);

/** 어휘 하나를 칩으로 보인다. 피할 말은 지운 줄로 「→ 쓸 말」 앞에 둔다. */
export function TermChip({ t, tone = "own", onRemove, onPromote }: { t: Term; tone?: "own" | "shared" | "draft"; onRemove?: () => void; onPromote?: () => void }) {
	return (
		<span
			title={t.note || undefined}
			className={cn(
				"inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-[12.5px]",
				tone === "own" && "border-border-strong",
				tone === "shared" && "border-border bg-secondary text-muted-foreground",
				tone === "draft" && "border-dashed border-border-strong text-muted-foreground",
			)}
		>
			{t.avoid.length > 0 && (
				<span className="truncate text-subtle">
					<s>{t.avoid.join(" · ")}</s> →
				</span>
			)}
			<span className="truncate font-medium">{t.term}</span>
			{onPromote && (
				<button type="button" className="text-subtle hover:text-foreground" aria-label={`${t.term} 어휘 사전으로 올리기`} title="어휘 사전으로 올리기 — 모든 산출물 · 계획에 쓰인다" onClick={onPromote}>
					<ArrowUpToLine className="size-3.5" />
				</button>
			)}
			{onRemove && (
				<button type="button" className="text-subtle hover:text-foreground" aria-label={`${t.term} 빼기`} onClick={onRemove}>
					<X className="size-3.5" />
				</button>
			)}
		</span>
	);
}

/** 산출물 어휘를 더하고 뺀다. 바꿀 때마다 onChange 로 목록 전체를 넘긴다. */
export function VocabEditor({ vocab, onChange, onPromote }: { vocab: Term[]; onChange: (list: Term[]) => void; onPromote?: (term: string) => void }) {
	const [term, setTerm] = useState("");
	const [avoid, setAvoid] = useState("");
	const [note, setNote] = useState("");
	const add = () => {
		const t = term.trim();
		if (!t) return;
		const rest = vocab.filter((v) => v.term.trim().toLowerCase() !== t.toLowerCase());
		onChange([...rest, { term: t, avoid: splitAvoid(avoid), note: note.trim() }]);
		setTerm("");
		setAvoid("");
		setNote("");
	};
	const onKey = (e: KeyboardEvent) => e.key === "Enter" && add();
	return (
		<div className="flex flex-col gap-2">
			{vocab.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{vocab.map((t) => (
						<TermChip
							key={t.term}
							t={t}
							onRemove={() => onChange(vocab.filter((v) => v !== t))}
							onPromote={onPromote && (() => onPromote(t.term))}
						/>
					))}
				</div>
			)}
			<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] gap-1.5">
				<Input value={term} onChange={(e) => setTerm(e.target.value)} onKeyDown={onKey} placeholder="쓸 말" className="h-8 text-[13px] md:text-[13px]" />
				<Input value={avoid} onChange={(e) => setAvoid(e.target.value)} onKeyDown={onKey} placeholder="피할 말 (· 로 나눔)" className="h-8 text-[13px] md:text-[13px]" />
				<Input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={onKey} placeholder="뜻 (적지 않아도 됨)" className="h-8 text-[13px] md:text-[13px]" />
				<Button size="sm" variant="outline" disabled={!term.trim()} onClick={add}>
					<Plus />
					더하기
				</Button>
			</div>
		</div>
	);
}
