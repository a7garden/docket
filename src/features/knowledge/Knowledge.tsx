import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronRight, FolderPlus, Layers, Loader2, RefreshCw, Search, Square, Undo2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { attempt, ContextActions, fileActions } from "@/components/ActionMenu";
import { Chip, Empty, SectionTitle } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FileIcon } from "@/features/deliverables/Deliverables";
import { api, errorText } from "@/lib/api";
import { useDropZone } from "@/lib/drop";
import { bytes, cost, isUnder, relTime } from "@/lib/format";
import { qk, useKb } from "@/lib/queries";
import type { KbFileView, KbHit, KbView, Project, ProjectKb } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOURCE: Record<string, string> = { folder: "참조 폴더", inbox: "넣은 자료", deliverable: "산출물" };
/** 목록이 길면 앞부분만 그린다. 큰 참조 폴더에서 화면이 무거워지지 않게. */
const SHOWN = 200;

function baseName(path: string) {
	return path.split(/[\\/]/).pop() || path;
}

/**
 * 프로젝트 지식베이스. 참조 폴더 · 넣은 자료 · 산출물을 모아 두면, 계획 · 대화 · 산출물 작성 때 앱이 가까운 구획을 찾아 Claude 에게 붙인다.
 * 구획마다 Claude 가 한 번 적어 둔 색인 카드(요약 · 핵심어 · 비슷한 말)로 뜻이 같은 다른 말도 찾는다.
 *
 * 낡은 자료는 넣기 전에 거른다 — 빼는 것(Exclude)은 사람이 정하고, 같은 문서의 옛 판은 앱이 판 묶기로 빼며 파일 줄의 「다시 넣기」로 되살린다.
 *
 * 목차: Knowledge(켜기 · 자료 · 실행에 붙이기) → Exclude(빼는 것) → Status(색인 상태) → Finder(찾아보기) → Files · FileRow · Cards(파일 목록과 카드)
 */
export function Knowledge({ project }: { project: Project }) {
	const qc = useQueryClient();
	const { data: kb } = useKb(project.id);
	const set = (v: KbView) => qc.setQueryData(qk.kb(project.id), v);

	const save = async (patch: Partial<ProjectKb>) => {
		if (!kb) return;
		try {
			set(await api.kbSave(project.id, { ...kb.kb, ...patch }));
			void qc.invalidateQueries({ queryKey: qk.projects });
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	const importPaths = async (paths: string[]) => {
		try {
			set(await api.kbImport(project.id, paths));
			toast(`${paths.length}개를 넣었습니다`, { description: kb?.kb.enabled ? "곧 색인합니다" : "지식베이스를 켜면 색인합니다" });
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	const [dropRef, over] = useDropZone<HTMLDivElement>(importPaths);

	if (!kb) return <div ref={dropRef} className="flex-1" />;
	const on = kb.kb.enabled;
	const p = kb.progress;

	return (
		<div ref={dropRef} className="relative flex min-h-0 flex-1 flex-col gap-4">
			<div className="flex items-center gap-2">
				<label className="flex items-center gap-2.5 text-[13.5px] font-medium">
					<Switch checked={on} onCheckedChange={(v) => void save({ enabled: v })} />
					지식베이스 쓰기
				</label>
				<div className="flex-1" />
				<Button
					variant="outline"
					onClick={async () => {
						const dir = await openDialog({ directory: true, title: "참조할 폴더", defaultPath: project.path });
						if (typeof dir === "string") await save({ folders: [...kb.kb.folders, dir] });
					}}
				>
					<FolderPlus />
					폴더 참조
				</Button>
				<Button
					variant="outline"
					onClick={async () => {
						const picked = await openDialog({ multiple: true, title: "지식베이스에 넣을 파일" });
						if (Array.isArray(picked) && picked.length) await importPaths(picked);
					}}
				>
					<Upload />
					파일 넣기
				</Button>
				{p.running ? (
					<Button variant="outline" onClick={() => void attempt(() => api.kbStop(project.id))}>
						<Square />
						중지
					</Button>
				) : (
					<Button variant="outline" disabled={!on} onClick={() => void attempt(() => api.kbReindex(project.id))}>
						<RefreshCw />
						다시 색인
					</Button>
				)}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex max-w-4xl flex-col gap-7 pb-10">
					{!on && (
						<p className="rounded-md border border-border px-4 py-3 text-[13px] leading-relaxed break-keep text-muted-foreground">
							켜면 아래 자료를 훑어 글자를 뽑고, 구획마다 Claude({kb.cardModel})가 색인 카드를 적어 둡니다. 그 뒤로 계획 · 대화 · 산출물을 쓸 때 메모나 질문과 가까운 구획을 찾아 Claude 에게 함께 넘깁니다.
							카드를 만들 때 문서 내용이 Claude 로 가고 파일마다 호출 비용이 듭니다. 자료는 꺼 둔 채로도 넣어 둘 수 있습니다.
						</p>
					)}

					<Status kb={kb} />

					<Block title="자료">
						<div className="flex flex-col gap-2.5 text-[13px]">
							<label className="flex items-center justify-between gap-3">
								<span className="flex flex-col gap-0.5">
									<span>산출물도 넣기</span>
									<span className="text-[12px] text-subtle">산출물마다 최신 판만 넣습니다. 지난 판은 넣지 않습니다.</span>
								</span>
								<Switch checked={kb.kb.includeDeliverables} onCheckedChange={(v) => void save({ includeDeliverables: v })} />
							</label>
							{kb.kb.folders.length === 0 ? (
								<p className="text-[12.5px] text-subtle">참조 폴더가 없습니다. 「폴더 참조」로 고르면 복사하지 않고 그 자리를 하위 폴더까지 훑습니다.</p>
							) : (
								<ul className="flex flex-col gap-1">
									{kb.kb.folders.map((f) => (
										<li key={f} className="flex items-center gap-2">
											<span className="text-subtle">참조 폴더</span>
											<button type="button" className="mono min-w-0 flex-1 truncate text-left text-[12.5px] hover:underline" title="탐색기에서 열기" onClick={() => void attempt(() => api.open(f))}>
												{f}
											</button>
											<Button size="icon-xs" variant="ghost" aria-label={`${f} 빼기`} onClick={() => void save({ folders: kb.kb.folders.filter((x) => x !== f) })}>
												<X />
											</Button>
										</li>
									))}
								</ul>
							)}
							<Exclude kb={kb.kb} save={save} />
							<p className="text-[12.5px] leading-relaxed break-keep text-subtle">
								같은 폴더에 한 문서의 판이 여럿이면(<span className="mono">_v4</span> · <span className="mono">_v14</span> · <span className="mono">_20261027</span> · <span className="mono">(1)</span>) 가장 높은 판만 넣고, 같은 판의 PDF 사본은 원본 형식이 있으면 넣지 않습니다.
								판 표시가 없는 파일은 그대로 넣습니다. 잘못 빠진 파일은 아래 목록에서 「다시 넣기」를 누릅니다.
							</p>
							<p className="text-[12.5px] leading-relaxed break-keep text-subtle">
								파일 · 폴더를 이 화면에 끌어다 놓으면 앱 데이터에 복사해 넣습니다. 형식은 가리지 않고 받고, 읽지 못하는 것은 아래 목록에 까닭을 보입니다.
								<br />
								읽는 형식: <span className="mono text-muted-foreground">{kb.exts.join(" · ")}</span> · hwp(옛 한글) · doc · xls · ppt · 그림 · 글자 없는 스캔 PDF 는 읽지 못합니다.
							</p>
						</div>
					</Block>

					<Block title="실행에 붙이기">
						<div className="flex flex-col gap-2.5 text-[13px]">
							<label className="flex items-center justify-between gap-3">
								<span>한 번에 붙일 구획 수</span>
								<Input
									type="number"
									min={1}
									max={30}
									defaultValue={kb.kb.topK}
									key={kb.kb.topK}
									onBlur={(e) => {
										const n = Math.min(30, Math.max(1, Math.round(Number(e.target.value) || 8)));
										if (n !== kb.kb.topK) void save({ topK: n });
									}}
									className="tabular h-8 w-20"
								/>
							</label>
							<label className="flex items-center justify-between gap-3">
								<span className="flex flex-col gap-0.5">
									<span>고르기 다듬기</span>
									<span className="text-[12px] leading-relaxed break-keep text-subtle">낱말로 고른 후보 30개를 Claude 가 한 번 더 읽고 관련 있는 것만 남깁니다. 더 정확하지만 실행마다 호출이 하나 붙습니다.</span>
								</span>
								<Switch checked={kb.kb.rerank} onCheckedChange={(v) => void save({ rerank: v })} />
							</label>
						</div>
					</Block>

					{on && <Finder projectId={project.id} />}

					<Block title={`파일 ${kb.files.length}`}>
						{kb.files.length === 0 ? (
							<Empty>아직 훑은 파일이 없습니다.</Empty>
						) : (
							<Files project={project} kb={kb} />
						)}
					</Block>
				</div>
			</div>

			{over && (
				<div className="pointer-events-none absolute inset-0 grid place-items-center rounded-md border-2 border-dashed border-foreground/40 bg-background/80 text-[14px] font-medium text-foreground">
					놓으면 지식베이스에 넣습니다
				</div>
			)}
		</div>
	);
}

/** 빼는 것. 지난 판 폴더(「이전판」) · 낡은 문서를 넣지 않게 사람이 정한다. */
function Exclude({ kb, save }: { kb: ProjectKb; save: (patch: Partial<ProjectKb>) => Promise<void> }) {
	const [v, setV] = useState("");
	const add = async () => {
		const x = v.trim();
		if (!x) return;
		await save({ exclude: [...kb.exclude, x] });
		setV("");
	};
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-wrap items-center gap-1.5">
				<span className="mr-1 text-subtle">빼는 것</span>
				{kb.exclude.map((x) => (
					<span key={x} className="mono inline-flex h-6 items-center gap-0.5 rounded-full bg-hover pr-0.5 pl-2.5 text-[12px]">
						{x}
						<Button size="icon-xs" variant="ghost" aria-label={`${x} 빼기 취소`} onClick={() => void save({ exclude: kb.exclude.filter((e) => e !== x) })}>
							<X />
						</Button>
					</span>
				))}
				<form
					className="flex"
					onSubmit={(e) => {
						e.preventDefault();
						void add();
					}}
				>
					<Input value={v} onChange={(e) => setV(e.target.value)} placeholder="폴더 · 파일 이름 조각이나 전체 경로" className="h-7 w-64 text-[12.5px]" />
				</form>
			</div>
			<span className="text-[12px] leading-relaxed break-keep text-subtle">
				이름 조각(<span className="mono">이전판</span>)은 참조 폴더 · 넣은 자료 안에서 그 말이 든 폴더 · 파일을 모두 뺍니다. 전체 경로는 그 파일이나 그 폴더 아래를 뺍니다. 뺀 파일의 카드는 지우지 않아 다시 넣어도 비용이 들지 않습니다.
			</span>
		</div>
	);
}

function Status({ kb }: { kb: KbView }) {
	const p = kb.progress;
	const parts = [`구획 ${kb.sections}`, `카드 ${kb.cards}`];
	if (kb.pending) parts.push(`카드 남음 ${kb.pending}`);
	if (kb.cardCostUsd) parts.push(`카드 비용 ${cost(kb.cardCostUsd)}`);
	if (kb.indexedAt) parts.push(`${relTime(kb.indexedAt)} 훑음`);
	return (
		<div className="flex flex-col gap-1 text-[13px]">
			<div className="flex items-center gap-2">
				{p.running ? (
					<Chip tone="run">{p.stage === "cards" ? `카드 만드는 중 ${p.done}/${p.total}` : "훑는 중"}</Chip>
				) : (
					<Chip>{kb.kb.enabled ? "켜짐" : "꺼짐"}</Chip>
				)}
				<span className="tabular text-subtle">{parts.join(" · ")}</span>
			</div>
			{!p.running && p.message && <p className="text-[12.5px] text-danger">{p.message}</p>}
			{kb.truncated && <p className="text-[12.5px] text-danger">파일이 너무 많아 일부만 훑었습니다. 참조 폴더를 문서가 있는 폴더로 좁혀 주세요.</p>}
		</div>
	);
}

/** 실행 때와 같은 로컬 찾기로 무엇이 붙을지 미리 본다. */
function Finder({ projectId }: { projectId: string }) {
	const [q, setQ] = useState("");
	const [hits, setHits] = useState<KbHit[] | null>(null);
	const [busy, setBusy] = useState(false);
	const run = async () => {
		if (!q.trim()) return;
		setBusy(true);
		try {
			setHits(await api.kbSearch(projectId, q));
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<Block title="찾아보기">
			<form
				className="flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					void run();
				}}
			>
				<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="메모나 질문처럼 적어 보세요. 실행 때 무엇이 붙을지 보입니다" className="h-8 text-[13px]" />
				<Button type="submit" variant="outline" disabled={busy}>
					{busy ? <Loader2 className="animate-spin" /> : <Search />}
					찾기
				</Button>
			</form>
			{hits && hits.length === 0 && <p className="text-[12.5px] text-subtle">가까운 구획이 없습니다.</p>}
			{hits && hits.length > 0 && (
				<ul className="surface divide-y divide-border overflow-hidden rounded-md">
					{hits.map((h, i) => (
						<li key={i} className="flex flex-col gap-1 px-3.5 py-2.5 text-[13px]">
							<div className="flex items-baseline gap-2">
								<span className="truncate font-medium" title={h.path}>
									{h.label ? `산출물 「${h.label}」` : baseName(h.path)}
								</span>
								{h.section && <span className="truncate text-subtle">› {h.section}</span>}
								<span className="flex-1" />
								<span className="tabular text-[11.5px] text-subtle">{h.score.toFixed(1)}</span>
							</div>
							{h.why && <p className="text-[12.5px] text-muted-foreground">{h.why}</p>}
							<p className="line-clamp-4 text-[12.5px] leading-relaxed whitespace-pre-wrap text-subtle selectable">{h.excerpt}</p>
						</li>
					))}
				</ul>
			)}
		</Block>
	);
}

function Files({ project, kb }: { project: Project; kb: KbView }) {
	// 읽은 파일을 앞에, 건너뛴 파일을 뒤에 둔다.
	const files = [...kb.files].sort((a, b) => Number(!!a.skipped) - Number(!!b.skipped));
	return (
		<div className="surface overflow-hidden rounded-md">
			{files.slice(0, SHOWN).map((f) => (
				<FileRow key={f.path} project={project} kb={kb} f={f} />
			))}
			{files.length > SHOWN && <p className="px-4 py-2.5 text-[12.5px] text-subtle">외 {files.length - SHOWN}개</p>}
		</div>
	);
}

function FileRow({ project, kb, f }: { project: Project; kb: KbView; f: KbFileView }) {
	const qc = useQueryClient();
	const [open, setOpen] = useState(false);
	const inbox = f.source === "inbox" && isUnder(f.path, kb.inboxDir);
	const remove = async () => qc.setQueryData(qk.kb(project.id), await api.kbInboxDelete(project.id, f.path));
	// 판 묶기에서 빠진 옛 판을 되살리거나, 되살린 것을 다시 판 묶기에 맡긴다.
	const setKeep = async (on: boolean) => qc.setQueryData(qk.kb(project.id), await api.kbSave(project.id, { ...kb.kb, keep: on ? [...kb.kb.keep, f.path] : kb.kb.keep.filter((k) => k !== f.path) }));
	const state = f.skipped ? f.skipped : f.cardError ? f.cardError : `${f.kept ? "다시 넣음 · " : ""}구획 ${f.sections} · 카드 ${f.cards}`;
	return (
		<ContextActions
			items={[
				...fileActions(f.path),
				(f.held === "version" || f.kept) && "sep",
				f.held === "version" && { label: "다시 넣기", icon: <Undo2 />, onSelect: () => void attempt(() => setKeep(true)) },
				f.kept && { label: "판 묶기에 맡기기", icon: <Layers />, onSelect: () => void attempt(() => setKeep(false)) },
				inbox && "sep",
				inbox && { label: "빼기", icon: <X />, destructive: true, onSelect: () => void attempt(remove) },
			]}
		>
			<div className="relative border-b border-border last:border-b-0">
				{f.held === "version" && (
					<Button size="xs" variant="ghost" className="absolute top-2 right-2 z-10" onClick={() => void attempt(() => setKeep(true))}>
						<Undo2 />
						다시 넣기
					</Button>
				)}
				<button
					type="button"
					disabled={!!f.skipped}
					onClick={() => setOpen((v) => !v)}
					className="flex h-10 w-full items-center gap-3 px-3 text-left text-[13px] transition-colors enabled:hover:bg-hover"
				>
					<ChevronRight className={cn("size-3.5 text-subtle transition-transform", open && "rotate-90", f.skipped && "invisible")} />
					<FileIcon name={f.path} className="text-subtle" />
					<span className="min-w-0 flex-1 truncate" title={f.path}>
						{f.label ? `${f.label} · ${baseName(f.path)}` : baseName(f.path)}
					</span>
					<span className="w-20 text-[12px] text-subtle">{SOURCE[f.source] ?? f.source}</span>
					<span className="tabular w-16 text-right text-[12px] text-subtle">{bytes(f.size)}</span>
					<span
						className={cn(
							"truncate text-right text-[12px]",
							// 「다시 넣기」 단추 자리만큼 줄여 다른 줄과 열을 맞춘다 (w-32 + mr-24 = w-56)
							f.held === "version" ? "mr-24 w-32" : "w-56",
							// 일부러 뺀 것(제외 · 옛 판)은 오류가 아니라 흐리게 보인다
							f.held ? "text-subtle" : f.skipped || f.cardError ? "text-danger" : "text-subtle",
						)}
						title={state}
					>
						{state}
					</span>
				</button>
				{open && <Cards projectId={project.id} path={f.path} />}
			</div>
		</ContextActions>
	);
}

/** 파일 하나의 구획과 카드. 펼칠 때 읽는다. */
function Cards({ projectId, path }: { projectId: string; path: string }) {
	const { data = [], isLoading } = useQuery({ queryKey: ["kbCards", projectId, path], queryFn: () => api.kbCards(projectId, path) });
	if (isLoading) return <p className="px-10 pb-3 text-[12.5px] text-subtle">읽는 중…</p>;
	return (
		<ol className="flex flex-col gap-3 px-10 pb-3">
			{data.map((s, i) => (
				<li key={i} className="flex flex-col gap-1 text-[12.5px]">
					<span className="font-medium">{s.heading || "(제목 없음)"}</span>
					{s.card ? (
						<>
							<span className="text-muted-foreground">{s.card.summary}</span>
							<span className="text-subtle">
								{[...s.card.keywords, ...s.card.aliases].join(" · ")}
							</span>
						</>
					) : (
						<span className="text-subtle">카드 없음 · {s.excerpt.slice(0, 120)}</span>
					)}
				</li>
			))}
		</ol>
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
