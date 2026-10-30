import { type KeyboardEvent, type MouseEvent, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { SelectionBar } from "@/components/SelectionBar";
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

const keyOf = (s: string) => s.trim().toLowerCase();

/**
 * 어휘 칩 고르기. 누르면 하나, Shift 는 범위, 묶음에 초점이 있을 때 Ctrl+A 는 모두 · Esc 는 풀기.
 * 고른 것은 말(소문자)로 쥔다. 올리기 · 다시 뽑기로 목록이 바뀌면 사라진 말은 저절로 빠진다.
 */
export function useTermSelection(terms: Term[]) {
	const [raw, setRaw] = useState<string[]>([]);
	const [anchor, setAnchor] = useState("");
	const keys = useMemo(() => terms.map((t) => keyOf(t.term)), [terms]);
	const picked = useMemo(() => raw.filter((k) => keys.includes(k)), [raw, keys]);
	const toggle = (i: number, e?: MouseEvent) => {
		const k = keys[i];
		const from = keys.indexOf(anchor);
		if (e?.shiftKey && from >= 0) {
			const range = keys.slice(Math.min(from, i), Math.max(from, i) + 1);
			setRaw([...new Set([...picked, ...range])]);
		} else {
			setRaw(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
			setAnchor(k);
		}
	};
	const all = () => setRaw(keys);
	const clear = () => {
		setRaw([]);
		setAnchor("");
	};
	// 칩 묶음에만 건다. 입력칸의 Ctrl+A(글자 전체 고르기)를 빼앗지 않는다.
	const onKeyDown = (e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
			e.preventDefault();
			all();
		} else if (e.key === "Escape" && picked.length) {
			e.stopPropagation();
			clear();
		}
	};
	/** 고른 말을 원래 표기로 돌려준다. */
	const pickedTerms = terms.filter((t) => picked.includes(keyOf(t.term))).map((t) => t.term);
	return { picked: pickedTerms, count: picked.length, has: (t: Term) => picked.includes(keyOf(t.term)), toggle, all, clear, onKeyDown };
}

/** 어휘 하나를 칩으로 보인다. 피할 말은 지운 줄로 「→ 쓸 말」 앞에 둔다. onSelect 를 주면 눌러 고른다. */
export function TermChip({ t, tone = "own", selected, onSelect, onRemove }: { t: Term; tone?: "own" | "shared" | "draft"; selected?: boolean; onSelect?: (e: MouseEvent) => void; onRemove?: () => void }) {
	const body = (
		<>
			{selected && <Check className="size-3.5 shrink-0 text-brand" />}
			{t.avoid.length > 0 && (
				<span className="truncate text-subtle">
					<s>{t.avoid.join(" · ")}</s> →
				</span>
			)}
			<span className="truncate font-medium">{t.term}</span>
		</>
	);
	return (
		<span
			title={t.note || undefined}
			className={cn(
				"inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors",
				tone === "own" && "border-border-strong",
				tone === "shared" && "border-border bg-secondary text-muted-foreground",
				tone === "draft" && "border-dashed border-border-strong text-muted-foreground",
				onSelect && !selected && "hover:border-foreground/50",
				selected && "border-brand bg-brand/10 text-foreground",
			)}
		>
			{onSelect ? (
				<button type="button" aria-pressed={!!selected} className="inline-flex min-w-0 items-center gap-1.5 outline-none focus-visible:underline" onClick={onSelect}>
					{body}
				</button>
			) : (
				body
			)}
			{onRemove && (
				<button type="button" className="text-subtle hover:text-foreground" aria-label={`${t.term} 빼기`} onClick={onRemove}>
					<X className="size-3.5" />
				</button>
			)}
		</span>
	);
}

/** 산출물 어휘를 더하고 뺀다. 바꿀 때마다 onChange 로 목록 전체를 넘긴다. 칩을 골라 한꺼번에 빼거나 사전으로 올린다. */
export function VocabEditor({ vocab, onChange, onPromote }: { vocab: Term[]; onChange: (list: Term[]) => void; onPromote?: (terms: string[]) => void }) {
	const [term, setTerm] = useState("");
	const [avoid, setAvoid] = useState("");
	const [note, setNote] = useState("");
	const sel = useTermSelection(vocab);
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
				<div className="flex flex-wrap gap-1.5" onKeyDown={sel.onKeyDown}>
					{vocab.map((t, i) => (
						<TermChip key={t.term} t={t} selected={sel.has(t)} onSelect={(e) => sel.toggle(i, e)} onRemove={() => onChange(vocab.filter((v) => v !== t))} />
					))}
				</div>
			)}
			{sel.count > 0 && (
				<SelectionBar count={sel.count} total={vocab.length} onAll={sel.all} onClear={sel.clear}>
					<Button
						size="xs"
						variant="ghost"
						onClick={() => {
							onChange(vocab.filter((t) => !sel.has(t)));
							sel.clear();
						}}
					>
						빼기
					</Button>
					{onPromote && (
						<Button
							size="xs"
							variant="outline"
							title="모든 산출물 · 계획에 쓰인다. 이 산출물 어휘에서는 빠진다"
							onClick={() => {
								onPromote(sel.picked);
								sel.clear();
							}}
						>
							어휘 사전으로 올리기
						</Button>
					)}
				</SelectionBar>
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
