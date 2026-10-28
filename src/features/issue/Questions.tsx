import { useEffect, useRef, useState } from "react";
import { Check, CornerDownLeft, PencilLine } from "lucide-react";
import { Label } from "@/components/bits";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import type { Question } from "@/lib/types";

/**
 * Claude 가 계획과 함께 낸 질문에 고르거나 적어서 답한다. Claude Code 의 질문 창처럼 한 번에 한 질문을 보이고,
 * 하나를 고르면 다음 안 답한 질문으로 넘어간다. 답은 상세 창(IssueDetail)이 들고 있다가 아래 단추줄이 글로 묶어 보낸다.
 */

export interface Answer {
	picked: number[];
	other: string;
}

export interface Answers {
	byQuestion: Record<number, Answer>;
	note: string;
}

export const NO_ANSWERS: Answers = { byQuestion: {}, note: "" };

export function isAnswered(a: Answer | undefined) {
	return !!a && (a.picked.length > 0 || a.other.trim() !== "");
}

export function answeredCount(qs: Question[], a: Answers) {
	return qs.filter((_, i) => isAnswered(a.byQuestion[i])).length;
}

/** 다시 계획 · 구현 때 Claude 에게 넘길 글. 답하지 않은 질문도 적어 두어야 Claude 가 그것을 자기 판단에 맡긴 줄 안다. */
export function answersText(qs: Question[], a: Answers) {
	const lines = ["Claude 가 물은 것에 대한 답"];
	qs.forEach((q, i) => {
		const ans = a.byQuestion[i];
		lines.push("", `${i + 1}. ${q.header ? `[${q.header}] ` : ""}${q.question}`);
		if (!isAnswered(ans)) {
			lines.push("   → (답하지 않음 · 판단에 맡김)");
			return;
		}
		for (const n of ans.picked) {
			const o = q.options[n];
			if (o) lines.push(`   → ${o.label}${o.description ? ` — ${o.description}` : ""}`);
		}
		if (ans.other.trim()) lines.push(`   → ${q.options.length ? "(직접 적음) " : ""}${ans.other.trim().replace(/\n/g, "\n     ")}`);
	});
	if (a.note.trim()) lines.push("", "덧붙일 말", a.note.trim());
	return lines.join("\n");
}

export function Questions({ questions, answers, onChange }: { questions: Question[]; answers: Answers; onChange: (a: Answers) => void }) {
	const [cur, setCur] = useState(0);
	const done = answeredCount(questions, answers);
	const q = questions[cur];
	const ans: Answer = answers.byQuestion[cur] ?? { picked: [], other: "" };

	const setAns = (i: number, next: Answer) => onChange({ ...answers, byQuestion: { ...answers.byQuestion, [i]: next } });
	// 하나만 고르는 질문은 고르자마자 다음 안 답한 질문으로 간다. 다 답했으면 그 자리에 둔다.
	const advance = (from: number, after: Answers) => {
		for (let k = 1; k <= questions.length; k++) {
			const j = (from + k) % questions.length;
			if (!isAnswered(after.byQuestion[j])) return setCur(j);
		}
	};
	const pick = (n: number) => {
		if (q.multi) {
			setAns(cur, { ...ans, picked: ans.picked.includes(n) ? ans.picked.filter((x) => x !== n) : [...ans.picked, n].sort() });
			return;
		}
		const next: Answers = { ...answers, byQuestion: { ...answers.byQuestion, [cur]: { picked: [n], other: "" } } };
		onChange(next);
		advance(cur, next);
	};

	return (
		<section className="overflow-hidden rounded-lg border border-brand/70 bg-card">
			<div className="flex items-center gap-2 border-b border-border px-4 pt-3 pb-2.5">
				<Label className="text-brand-text">Claude 가 묻습니다</Label>
				<span className="tabular text-[12px] text-subtle">
					{done}/{questions.length} 답함
				</span>
			</div>

			{questions.length > 1 && (
				<div role="tablist" className="flex flex-wrap gap-1.5 px-4 pt-3">
					{questions.map((x, i) => {
						const ok = isAnswered(answers.byQuestion[i]);
						return (
							<button
								key={i}
								role="tab"
								aria-selected={i === cur}
								onClick={() => setCur(i)}
								className={cn(
									"inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
									i === cur ? "border-foreground/70 bg-foreground text-background" : "border-border text-muted-foreground hover:bg-hover",
								)}
							>
								{ok ? <Check className="size-3" /> : <span className="tabular opacity-70">{i + 1}</span>}
								<span className="max-w-[12em] truncate">{x.header || `질문 ${i + 1}`}</span>
							</button>
						);
					})}
				</div>
			)}

			{q && <QuestionBody key={cur} q={q} ans={ans} onPick={pick} onOther={(other) => setAns(cur, { picked: q.multi ? ans.picked : [], other })} onNext={() => advance(cur, answers)} />}

			<div className="border-t border-border px-4 py-3">
				<textarea
					value={answers.note}
					onChange={(e) => onChange({ ...answers, note: e.target.value })}
					placeholder="덧붙일 말 (선택) — 질문 밖에서 계획에 바라는 것"
					rows={1}
					className="field-sizing-content w-full resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-subtle"
				/>
			</div>
		</section>
	);
}

function QuestionBody({ q, ans, onPick, onOther, onNext }: { q: Question; ans: Answer; onPick: (n: number) => void; onOther: (s: string) => void; onNext: () => void }) {
	const n = q.options.length;
	// 커서는 선택지 0..n-1 과 「직접 입력」(n) 을 오간다. 선택지가 없는 질문은 처음부터 입력칸이다.
	const [focus, setFocus] = useState(() => (ans.picked.length ? ans.picked[0] : ans.other ? n : 0));
	const listRef = useRef<HTMLDivElement>(null);
	const otherRef = useRef<HTMLTextAreaElement>(null);
	// 창이 열리자마자 첫 선택지에 초점 테두리가 생기면 이미 고른 것처럼 보인다. 키로 옮길 때만 초점을 따라 옮긴다.
	const byKey = useRef(false);

	useEffect(() => {
		if (!byKey.current) return;
		if (focus === n) otherRef.current?.focus();
		else listRef.current?.querySelector<HTMLElement>(`[data-opt="${focus}"]`)?.focus();
	}, [focus, n]);

	const onKey = (e: React.KeyboardEvent) => {
		const typing = e.target instanceof HTMLTextAreaElement;
		byKey.current = true;
		if (e.key === "ArrowDown" && (!typing || !ans.other.includes("\n"))) {
			e.preventDefault();
			setFocus((f) => Math.min(f + 1, n));
		} else if (e.key === "ArrowUp" && (!typing || !ans.other.includes("\n"))) {
			e.preventDefault();
			setFocus((f) => Math.max(f - 1, 0));
		} else if (!typing && /^[1-9]$/.test(e.key) && Number(e.key) <= n + 1) {
			e.preventDefault();
			const k = Number(e.key) - 1;
			setFocus(k);
			if (k < n) onPick(k);
		} else if (typing && e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
			// 한글 조합 중의 Enter 는 글자를 확정하는 것이라 넘기지 않는다.
			e.preventDefault();
			if (ans.other.trim()) onNext();
		}
	};

	return (
		<div className="flex flex-col gap-3 px-4 pt-3 pb-4" onKeyDown={onKey}>
			<p className="text-[14.5px] leading-relaxed font-medium break-keep selectable">{q.question}</p>
			<div ref={listRef} role={q.multi ? "group" : "radiogroup"} className="flex flex-col gap-1">
				{q.options.map((o, i) => {
					const on = ans.picked.includes(i);
					return (
						<button
							key={i}
							data-opt={i}
							role={q.multi ? "checkbox" : "radio"}
							aria-checked={on}
							tabIndex={focus === i ? 0 : -1}
							onFocus={() => setFocus(i)}
							onClick={() => onPick(i)}
							className={cn(
								"group flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors outline-none",
								on ? "border-brand bg-brand/10" : "border-border hover:bg-hover",
								"focus-visible:ring-3 focus-visible:ring-ring/40",
							)}
						>
							<span
								className={cn(
									"mt-0.5 flex size-5 shrink-0 items-center justify-center border text-[11px] font-semibold tabular",
									q.multi ? "rounded" : "rounded-full",
									on ? "border-brand bg-brand text-brand-ink" : "border-border-strong text-subtle",
								)}
							>
								{on ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
							</span>
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium break-keep">
									{o.label}
									{o.recommended && <span className="rounded-full border border-brand/50 px-1.5 text-[11px] font-medium text-brand-text">권장</span>}
								</span>
								{o.description && <span className="text-[12.5px] leading-relaxed break-keep text-muted-foreground">{o.description}</span>}
							</span>
						</button>
					);
				})}

				<label
					className={cn(
						"flex w-full items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
						ans.other.trim() ? "border-brand bg-brand/10" : "border-dashed border-border focus-within:border-border-strong",
					)}
				>
					<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border-strong text-subtle">
						<PencilLine className="size-3" />
					</span>
					<textarea
						ref={otherRef}
						value={ans.other}
						onFocus={() => setFocus(n)}
						onChange={(e) => onOther(e.target.value)}
						placeholder={n ? "직접 입력…" : "답을 적어 주세요"}
						rows={1}
						className="field-sizing-content min-h-5 w-full resize-none bg-transparent text-[13.5px] leading-relaxed outline-none placeholder:text-subtle"
					/>
				</label>
			</div>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-subtle">
				{n > 0 && (
					<span>
						<Kbd>1</Kbd>–<Kbd>{Math.min(n, 9)}</Kbd> {q.multi ? "골라 켜고 끄기 · 여럿 고를 수 있음" : "고르기"}
					</span>
				)}
				<span>
					<Kbd>↑</Kbd>
					<Kbd>↓</Kbd> 옮기기
				</span>
				<span className="inline-flex items-center gap-1">
					<Kbd>
						<CornerDownLeft className="size-3" />
					</Kbd>
					입력 뒤 다음 질문
				</span>
			</div>
		</div>
	);
}
