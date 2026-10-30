import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Empty, SectionTitle } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, errorText } from "@/lib/api";
import { qk, useGlossary } from "@/lib/queries";
import type { GlossaryEntry, GlossaryView, Project, ProjectGlossary } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 화면에서 고치는 줄. 비슷한 말은 쉼표 · 가운뎃점으로 나눈 한 칸으로 고친다. */
interface Row {
	key: number;
	term: string;
	meaning: string;
	aliases: string;
}

let seq = 0;
const toRow = (e: GlossaryEntry): Row => ({ key: ++seq, term: e.term, meaning: e.meaning, aliases: e.aliases.join(" · ") });
const toEntry = (r: Row): GlossaryEntry => ({
	term: r.term.trim(),
	meaning: r.meaning.trim(),
	aliases: r.aliases
		.split(/[,·、]/)
		.map((a) => a.trim())
		.filter(Boolean),
});
const same = (a: GlossaryEntry[], b: GlossaryEntry[]) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 프로젝트 어휘 사전. 용어 · 뜻 · 비슷한 말을 적어 두면 계획 · 대화 · 구현 · 산출물 작성 때 Claude 에게 함께 넘긴다.
 * 다른 프로젝트의 사전도 골라 함께 쓴다. 복사하지 않고 실행 때마다 읽으므로 그쪽에서 고친 것이 바로 반영된다.
 *
 * 목차: Glossary(켜기 · 함께 쓸 사전 · 용어 표 · 함께 쓰는 용어) → Block
 */
export function Glossary({ project }: { project: Project }) {
	const qc = useQueryClient();
	const { data: g } = useGlossary(project.id);
	const [rows, setRows] = useState<Row[]>([]);
	// 저장은 한 줄로 세운다. 칸을 빠르게 옮겨 다니면 저장이 겹쳐 앞의 것이 「먼저 고쳤다」로 거절된다.
	const chain = useRef(Promise.resolve());
	const stamp = useRef(0);
	const mine = useRef<GlossaryView | null>(null);

	// 서버 값이 바뀌면 표를 다시 맞춘다. 아직 용어를 적지 않은 새 줄은 남긴다 — 저장되지 않은 줄이라 서버 값에 없다.
	// 이 화면이 저장해 받은 값이면 맞추지 않는다. 저장하는 사이 다른 칸에 쓰던 글이 지워지지 않게.
	useEffect(() => {
		if (!g) return;
		stamp.current = g.updatedAt;
		if (g === mine.current) return;
		setRows((prev) => [...g.entries.map(toRow), ...prev.filter((r) => !r.term.trim())]);
	}, [g]);

	if (!g) return <div className="flex-1" />;
	const set = (v: GlossaryView) => qc.setQueryData(qk.glossary(project.id), v);

	const saveSettings = async (patch: Partial<ProjectGlossary>) => {
		try {
			set(await api.glossarySaveSettings(project.id, { ...g.glossary, ...patch }));
			void qc.invalidateQueries({ queryKey: qk.projects });
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	const commit = (next: Row[]) => {
		setRows(next);
		const entries = next.filter((r) => r.term.trim()).map(toEntry);
		chain.current = chain.current.then(async () => {
			const cur = qc.getQueryData<GlossaryView>(qk.glossary(project.id));
			if (cur && same(entries, cur.entries)) return;
			try {
				const v = await api.glossarySaveEntries(project.id, entries, stamp.current);
				stamp.current = v.updatedAt;
				mine.current = v;
				set(v);
			} catch (e) {
				toast.error(errorText(e));
				void qc.invalidateQueries({ queryKey: qk.glossary(project.id) });
			}
		});
	};
	const edit = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
	const include = new Set(g.glossary.include);
	const on = g.glossary.enabled;

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4">
			<div className="flex items-center gap-2">
				<label className="flex items-center gap-2.5 text-[13.5px] font-medium">
					<Switch checked={on} onCheckedChange={(v) => void saveSettings({ enabled: v })} />
					어휘 사전 쓰기
				</label>
				<div className="flex-1" />
				<Button variant="outline" onClick={() => setRows((rs) => [...rs, { key: ++seq, term: "", meaning: "", aliases: "" }])}>
					<Plus />
					용어 추가
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex max-w-4xl flex-col gap-7 pb-10">
					{!on && (
						<p className="rounded-md border border-border px-4 py-3 text-[13px] leading-relaxed break-keep text-muted-foreground">
							켜면 계획 · 대화 · 구현 · 산출물을 쓸 때 이 사전을 Claude 에게 함께 넘깁니다. Claude 를 따로 부르지 않아 비용은 들지 않고, 길면 메모나 질문에 나온 용어부터 8,000자 안팎에서 자릅니다.
						</p>
					)}

					<Block title="함께 쓸 다른 프로젝트의 사전">
						{g.others.length === 0 ? (
							<p className="text-[12.5px] text-subtle">다른 프로젝트가 없습니다.</p>
						) : (
							<div className="flex flex-wrap gap-1.5">
								{g.others.map((o) => {
									const picked = include.has(o.id);
									return (
										<button
											key={o.id}
											type="button"
											onClick={() => void saveSettings({ include: picked ? g.glossary.include.filter((x) => x !== o.id) : [...g.glossary.include, o.id] })}
											className={cn(
												"flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12.5px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground",
												picked && "border-foreground/60 bg-secondary text-foreground",
											)}
										>
											{picked ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
											{o.name}
											<span className="tabular text-subtle">{o.count}</span>
										</button>
									);
								})}
							</div>
						)}
						<p className="text-[12.5px] leading-relaxed break-keep text-subtle">
							고른 프로젝트의 사전을 복사하지 않고 실행 때마다 읽습니다. 같은 용어가 있으면 이 프로젝트의 것이 앞섭니다. 고른 프로젝트가 다시 고른 사전까지는 따라가지 않습니다.
						</p>
					</Block>

					<Block title={`용어 ${g.entries.length}`}>
						{rows.length === 0 ? (
							<Empty>아직 적은 용어가 없습니다. 「용어 추가」로 적어 보세요.</Empty>
						) : (
							<div className="surface overflow-hidden rounded-md">
								<div className="grid grid-cols-[11rem_1fr_14rem_2rem] gap-2 border-b border-border px-3 py-2 text-[12px] text-subtle">
									<span>용어</span>
									<span>뜻</span>
									<span>비슷한 말 (쉼표로 나눔)</span>
									<span />
								</div>
								{rows.map((r) => (
									<div key={r.key} className="grid grid-cols-[11rem_1fr_14rem_2rem] items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0">
										<Input
											value={r.term}
											autoFocus={!r.term && r.key === rows[rows.length - 1].key}
											onChange={(e) => edit(r.key, { term: e.target.value })}
											onBlur={() => commit(rows)}
											placeholder="용어"
											className="h-8 text-[13px] font-medium md:text-[13px]"
										/>
										<Input value={r.meaning} onChange={(e) => edit(r.key, { meaning: e.target.value })} onBlur={() => commit(rows)} placeholder="이 프로젝트에서 뜻하는 것" className="h-8 text-[13px] md:text-[13px]" />
										<Input value={r.aliases} onChange={(e) => edit(r.key, { aliases: e.target.value })} onBlur={() => commit(rows)} placeholder="예: 결과 통보, 회신문" className="h-8 text-[13px] md:text-[13px]" />
										<Button size="icon-xs" variant="ghost" aria-label={`${r.term || "새 용어"} 지우기`} onClick={() => commit(rows.filter((x) => x.key !== r.key))}>
											<X />
										</Button>
									</div>
								))}
							</div>
						)}
					</Block>

					{g.shared.length > 0 && (
						<Block title={`함께 쓰는 용어 ${g.shared.length}`}>
							<div className="surface overflow-hidden rounded-md">
								{g.shared.map((s) => (
									<div key={`${s.from}-${s.term}`} className="grid grid-cols-[11rem_1fr_14rem] gap-2 border-b border-border px-3 py-2 text-[13px] last:border-b-0">
										<span className="flex min-w-0 flex-col">
											<span className="truncate">{s.term}</span>
											<span className="truncate text-[11.5px] text-subtle">{s.from}</span>
										</span>
										<span className="text-muted-foreground">{s.meaning}</span>
										<span className="text-[12.5px] text-subtle">{s.aliases.join(" · ")}</span>
									</div>
								))}
							</div>
							<p className="text-[12.5px] text-subtle">고치려면 그 프로젝트의 어휘 사전에서 고칩니다.</p>
						</Block>
					)}
				</div>
			</div>
		</div>
	);
}

function Block({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<SectionTitle>{title}</SectionTitle>
			{children}
		</section>
	);
}
