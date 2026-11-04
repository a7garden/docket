import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, ChevronRight, Pencil, Plus, Square, Undo2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { attempt } from "@/components/ActionMenu";
import { Chip, Empty, SectionTitle } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText } from "@/lib/api";
import { useDropZone } from "@/lib/drop";
import { cost, relTime } from "@/lib/format";
import { qk, useMemory } from "@/lib/queries";
import { useUi } from "@/lib/store";
import type { MemoryDigest, MemoryEntry, MemoryKind, MemoryView, Project } from "@/lib/types";
import { cn } from "@/lib/utils";

const KINDS: [MemoryKind, string][] = [
	["rule", "지침"],
	["fact", "사실"],
	["decision", "결정"],
	["reference", "참조"],
];
const label = (kind: MemoryKind) => KINDS.find(([k]) => k === kind)?.[1] ?? kind;

type Run = (work: () => Promise<MemoryView>) => Promise<void>;

/**
 * 프로젝트 기억. 파일을 놓으면 Claude 가 읽고 지침 · 사실 · 결정 · 참조로 나눠 짧은 항목만 남긴다. 파일은 보관하지 않는다.
 * 파일에서 뽑은 지침은 사람이 넣어야 실행에 붙고, 나머지는 바로 쓴다. 용어는 어휘 사전으로 가고, 남기지 않은 내용은 소화 기록에서 되살린다.
 *
 * 목차: Memory(켜기 · 놓는 자리 · 승인 대기 · 목록) → Editor(적기 · 고치기) → EntryRow → Digests(소화 기록) → Block
 */
export function Memory({ project }: { project: Project }) {
	const qc = useQueryClient();
	const { data: m } = useMemory(project.id);
	const run: Run = async (work) => {
		try {
			qc.setQueryData(qk.memory(project.id), await work());
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	const digest = async (paths: string[]) => {
		try {
			const n = await api.memoryDigest(project.id, paths);
			toast(`${n}개를 읽기 시작합니다`, { description: "파일은 보관하지 않습니다" });
			void qc.invalidateQueries({ queryKey: qk.memory(project.id) });
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	const [dropRef, over] = useDropZone<HTMLDivElement>(digest);
	const [adding, setAdding] = useState(false);

	if (!m) return <div ref={dropRef} className="flex-1" />;
	const p = m.progress;
	const pending = m.entries.filter((e) => e.status === "pending");
	const active = m.entries.filter((e) => e.status === "active");
	const archived = m.entries.filter((e) => e.status === "archived");
	const counts = KINDS.map(([k, name]) => [name, active.filter((e) => e.kind === k).length] as const).filter(([, n]) => n > 0);
	const pick = async () => {
		const picked = await openDialog({ multiple: true, title: "기억으로 소화할 파일" });
		if (Array.isArray(picked) && picked.length) await digest(picked);
	};

	return (
		<div ref={dropRef} className="relative flex min-h-0 flex-1 flex-col gap-4">
			<div className="flex items-center gap-2">
				<label className="flex items-center gap-2.5 text-[13.5px] font-medium">
					<Switch checked={m.enabled} onCheckedChange={(v) => void run(() => api.memorySaveSettings(project.id, v))} />
					기억 쓰기
				</label>
				{p.running && <Chip tone="run">{`읽는 중 ${p.done + 1}/${p.total} · ${p.file}`}</Chip>}
				<div className="flex-1" />
				{p.running && (
					<Button variant="outline" onClick={() => void attempt(() => api.memoryStop(project.id))}>
						<Square />
						중지
					</Button>
				)}
				<Button variant="outline" onClick={() => setAdding((v) => !v)}>
					<Plus />
					직접 적기
				</Button>
				<Button variant="outline" disabled={!m.enabled} onClick={() => void pick()}>
					<Upload />
					파일 넣기
				</Button>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex max-w-4xl flex-col gap-7 pb-10">
					<p className="rounded-md border border-border px-4 py-3 text-[13px] leading-relaxed break-keep text-muted-foreground">
						{m.enabled ? "파일을 이 화면에 끌어다 놓으면 읽고 나눠 기억으로 남깁니다." : "켜면 파일을 넣을 수 있고, 계획 · 대화 · 구현 · 산출물을 쓸 때 승인한 지침과 일과 가까운 항목을 Claude 에게 함께 넘깁니다."} 읽을 때 문서 내용이 Claude 로 가고 구현 모델의 호출 비용이 듭니다. 파일은 보관하지 않으니 표 · 수치 · 조항을 원문으로 다시 봐야 하는 문서는 지식베이스에 넣습니다.
					</p>
					{!p.running && p.message && <p className="text-[12.5px] text-danger">{p.message}</p>}
					{!m.glossaryEnabled && m.digests.some((d) => d.terms > 0) && (
						<p className="text-[12.5px] leading-relaxed break-keep text-subtle">
							넘긴 용어는 어휘 사전에 있지만 사전이 꺼져 있어 실행에 붙지 않습니다.{" "}
							<button type="button" className="underline hover:text-foreground" onClick={() => useUi.getState().setView("glossary")}>
								어휘 사전 열기
							</button>
						</p>
					)}

					{adding && (
						<Editor
							initialKind="rule"
							initial=""
							submit="넣기"
							onCancel={() => setAdding(false)}
							onSave={async (kind, text) => {
								await run(() => api.memoryAdd(project.id, kind, text));
								setAdding(false);
							}}
						/>
					)}

					{pending.length > 0 && (
						<Block title={`승인 대기 ${pending.length}`}>
							<p className="text-[12.5px] leading-relaxed break-keep text-subtle">넣기 전에는 실행에 붙지 않습니다. 파일에서 뽑은 지침과, 직접 적은 항목을 밀어내려는 내용이 여기 옵니다.</p>
							<ul className="surface divide-y divide-border overflow-hidden rounded-md">
								{pending.map((e) => (
									<EntryRow key={e.id} projectId={project.id} e={e} run={run} target={m.entries.find((t) => t.id === e.replaces)} />
								))}
							</ul>
						</Block>
					)}

					<Block title={`전체 ${active.length}${counts.length ? ` · ${counts.map(([n, c]) => `${n} ${c}`).join(" · ")}` : ""}`}>
						{active.length === 0 ? (
							<Empty>아직 기억이 없습니다.</Empty>
						) : (
							<ul className="surface divide-y divide-border overflow-hidden rounded-md">
								{KINDS.flatMap(([k]) => active.filter((e) => e.kind === k)).map((e) => (
									<EntryRow key={e.id} projectId={project.id} e={e} run={run} />
								))}
							</ul>
						)}
					</Block>

					{archived.length > 0 && (
						<Fold title={`밀린 항목 ${archived.length}`}>
							<ul className="surface divide-y divide-border overflow-hidden rounded-md">
								{archived.map((e) => (
									<EntryRow key={e.id} projectId={project.id} e={e} run={run} />
								))}
							</ul>
						</Fold>
					)}

					{m.digests.length > 0 && (
						<Block title="소화 기록">
							<ul className="surface divide-y divide-border overflow-hidden rounded-md">
								{m.digests.map((d) => (
									<DigestRow key={d.id} projectId={project.id} d={d} run={run} />
								))}
							</ul>
						</Block>
					)}
				</div>
			</div>

			{over && (
				<div className="pointer-events-none absolute inset-0 grid place-items-center rounded-md border-2 border-dashed border-foreground/40 bg-background/80 text-[14px] font-medium text-foreground">
					{m.enabled ? "놓으면 읽고 기억으로 남깁니다 · 파일은 보관하지 않습니다" : "기억을 켜면 파일을 넣을 수 있습니다"}
				</div>
			)}
		</div>
	);
}

function Editor({ initialKind, initial, submit, onSave, onCancel }: { initialKind: MemoryKind; initial: string; submit: string; onSave: (kind: MemoryKind, text: string) => Promise<void>; onCancel: () => void }) {
	const [kind, setKind] = useState(initialKind);
	const [text, setText] = useState(initial);
	return (
		<form
			className="flex flex-col gap-2 px-3.5 py-2.5"
			onSubmit={(e) => {
				e.preventDefault();
				void onSave(kind, text);
			}}
		>
			<div className="flex gap-1" role="radiogroup" aria-label="종류">
				{KINDS.map(([k, name]) => (
					<Button key={k} type="button" size="xs" variant={k === kind ? "secondary" : "ghost"} role="radio" aria-checked={k === kind} onClick={() => setKind(k)}>
						{name}
					</Button>
				))}
			</div>
			<Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="한두 문장으로 적습니다" className="text-[13px]" />
			<div className="flex justify-end gap-1.5">
				<Button type="button" size="xs" variant="ghost" onClick={onCancel}>
					취소
				</Button>
				<Button type="submit" size="xs" disabled={!text.trim()}>
					{submit}
				</Button>
			</div>
		</form>
	);
}

function EntryRow({ projectId, e, run, target }: { projectId: string; e: MemoryEntry; run: Run; target?: MemoryEntry }) {
	const [editing, setEditing] = useState(false);
	if (editing) {
		return (
			<li>
				<Editor
					initialKind={e.kind}
					initial={e.text}
					submit="저장"
					onCancel={() => setEditing(false)}
					onSave={async (kind, text) => {
						await run(() => api.memoryEdit(projectId, e.id, kind, text));
						setEditing(false);
					}}
				/>
			</li>
		);
	}
	const isPending = e.status === "pending";
	const isArchived = e.status === "archived";
	return (
		<li className={cn("group flex items-start gap-3 px-3.5 py-2.5 text-[13px]", isArchived && "text-subtle")}>
			<span className="w-8 shrink-0 font-medium">{label(e.kind)}</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="leading-relaxed break-keep whitespace-pre-wrap selectable">{e.text}</span>
				{target && <span className="text-[12px] text-subtle">넣으면 밀려남: {target.text}</span>}
				<span className="text-[12px] text-subtle">{e.source ? `${e.source} · ${relTime(e.createdAt)}` : `직접 적음 · ${relTime(e.createdAt)}`}</span>
			</div>
			<div className="flex shrink-0 items-center gap-0.5">
				{isPending && (
					<Button size="xs" variant="outline" onClick={() => void run(() => api.memoryApprove(projectId, e.id))}>
						<Check />
						넣기
					</Button>
				)}
				{isArchived && (
					<Button size="xs" variant="ghost" onClick={() => void run(() => api.memoryApprove(projectId, e.id))}>
						<Undo2 />
						되돌리기
					</Button>
				)}
				{!isArchived && (
					<Button size="icon-xs" variant="ghost" aria-label="고치기" title="고치기" onClick={() => setEditing(true)}>
						<Pencil />
					</Button>
				)}
				<Button size="icon-xs" variant="ghost" aria-label={isPending ? "버리기" : "지우기"} title={isPending ? "버리기" : "지우기"} onClick={() => void run(() => api.memoryDelete(projectId, e.id))}>
					<X />
				</Button>
			</div>
		</li>
	);
}

function DigestRow({ projectId, d, run }: { projectId: string; d: MemoryDigest; run: Run }) {
	const [open, setOpen] = useState(false);
	const parts: string[] = [];
	if (d.added) parts.push(`넣음 ${d.added}`);
	if (d.pending) parts.push(`승인 대기 ${d.pending}`);
	if (d.terms) parts.push(`어휘 ${d.terms}`);
	if (d.dropped.length) parts.push(`버림 ${d.dropped.length}`);
	if (d.costUsd) parts.push(cost(d.costUsd));
	return (
		<li className="flex flex-col text-[13px]">
			<button type="button" disabled={d.dropped.length === 0} onClick={() => setOpen((v) => !v)} className="flex min-h-10 w-full items-center gap-2.5 px-3 text-left transition-colors enabled:hover:bg-hover">
				<ChevronRight className={cn("size-3.5 shrink-0 text-subtle transition-transform", open && "rotate-90", d.dropped.length === 0 && "invisible")} />
				<span className="min-w-0 flex-1 truncate" title={d.file}>
					{d.file}
				</span>
				<span className="tabular shrink-0 text-[12px] text-subtle">{parts.join(" · ")}</span>
				<span className="w-20 shrink-0 text-right text-[12px] text-subtle">{relTime(d.at)}</span>
			</button>
			{d.note && <p className="px-9 pb-2 text-[12.5px] break-keep text-subtle">{d.note}</p>}
			{open && (
				<ul className="flex flex-col gap-1.5 px-9 pb-3">
					{d.dropped.map((x, i) => (
						<li key={i} className="flex items-start gap-2 text-[12.5px]">
							<div className="min-w-0 flex-1 leading-relaxed">
								<span className="text-muted-foreground selectable">{x.text}</span>
								<span className="text-subtle"> · {x.reason}</span>
							</div>
							<Button size="xs" variant="ghost" onClick={() => void run(() => api.memoryRestore(projectId, d.id, i))}>
								<Undo2 />
								되살리기
							</Button>
						</li>
					))}
				</ul>
			)}
		</li>
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

function Fold({ title, children }: { title: string; children: ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<section className="flex flex-col gap-2">
			<button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[12.5px] text-subtle hover:text-foreground">
				<ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
				{title}
			</button>
			{open && children}
		</section>
	);
}
