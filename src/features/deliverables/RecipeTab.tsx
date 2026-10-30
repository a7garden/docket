/**
 * 산출물 상세의 「만드는 법」 탭.
 *
 * 목차
 * 1. RecipeTab — 템플릿 · 참고 자료 · 작성법 · 어휘 · 작성 지침 · 파일 형식 · 자동 관리 길잡이 · 파일 이름 · 저장 폴더
 * 2. LearnBar — 작성법 뽑기 상태 · 다시 뽑기 · 중지 · 기록 · 제안 한꺼번에 처리
 * 3. Suggest · Block — 제안 줄과 칸 틀
 */
import { useEffect, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { BookA, ChevronDown, ExternalLink, FileText, FolderOpen, Loader2, Plus, RefreshCw, Square, Stamp, X } from "lucide-react";
import { toast } from "sonner";
import { attempt, ContextActions, fileActions } from "@/components/ActionMenu";
import { RunEvents } from "@/components/RunLog";
import { Markdown } from "@/components/Markdown";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { SelectionBar } from "@/components/SelectionBar";
import { Chip, SectionTitle } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText } from "@/lib/api";
import { useDropZone } from "@/lib/drop";
import { bytes, cost, extOf, joinPath, relTime } from "@/lib/format";
import { qk, useGlossary } from "@/lib/queries";
import { useUi } from "@/lib/store";
import type { Deliverable, DeliverablePatch, Project, RefFile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { docFormat, FileIcon } from "./Deliverables";
import { TermChip, useTermSelection, VocabEditor } from "./VocabEditor";

/** 템플릿으로 삼을 수 있는 형식. 백엔드 recipe::TEMPLATE_EXTS 와 같다. */
const TEMPLATE_EXTS = ["hwpx", "docx", "xlsx", "pptx"];

const REF_STATE: Record<RefFile["kind"], (r: RefFile) => string> = {
	direct: () => "그대로 읽음",
	extract: (r) => (r.textPath ? "글자를 뽑아 둠" : "글자를 뽑지 못함"),
	none: () => "읽지 못하는 형식",
};

/**
 * 산출물을 「어떻게 만드는지」를 모은다. Claude 에게 쓰게 할 때마다 이 재료를 그대로 넘긴다.
 * 글은 칸을 벗어날 때 저장한다. 고칠 때마다 저장하면 목록 정렬이 계속 흔들린다.
 */
export function RecipeTab({ project, d, onAuto }: { project: Project; d: Deliverable; onAuto: () => void }) {
	const [guide, setGuide] = useState(d.guide);
	const [naming, setNaming] = useState(d.naming);
	const [subdir, setSubdir] = useState(d.subdir);
	const [skill, setSkill] = useState(d.skill);
	const [format, setFormat] = useState(d.format);
	const [preview, setPreview] = useState(d.nextName);
	useEffect(() => {
		setGuide(d.guide);
		setNaming(d.naming);
		setSubdir(d.subdir);
		setSkill(d.skill);
		setFormat(d.format);
	}, [d.guide, d.naming, d.subdir, d.skill, d.format]);
	const qc = useQueryClient();
	const { data: glossary } = useGlossary(project.id);
	const setView = useUi((s) => s.setView);
	const shared = glossary?.glossary.enabled ? [...glossary.entries, ...glossary.shared] : [];

	const nextN = Math.max(0, ...d.versions.map((v) => v.n)) + 1;
	useEffect(() => {
		const t = setTimeout(() => {
			api.namingPreview(project.id, naming || project.naming, d.title, nextN).then(setPreview, () => {});
		}, 150);
		return () => clearTimeout(t);
	}, [naming, d.title, nextN, project.id, project.naming]);

	const save = (patch: Partial<DeliverablePatch>) => {
		const full: DeliverablePatch = { title: d.title, note: d.note, guide, naming, subdir, autoUpdate: d.autoUpdate, ...patch };
		api.deliverableUpdate(project.id, d.id, full).catch((e) => toast.error(errorText(e)));
	};

	const addRefs = async (paths: string[]) => {
		try {
			await api.deliverableRefsAdd(project.id, d.id, paths);
		} catch (e) {
			toast.error(errorText(e));
		}
	};
	const [dropRef, over] = useDropZone<HTMLDivElement>(addRefs);
	const ext = docFormat(d);
	const dr = d.draft;
	const hasDraft = !!(dr.skill || dr.vocab.length || dr.format || dr.naming || dr.template);
	const draftAct = (field: string, apply: boolean, terms?: string[]) => void attempt(() => api.deliverableDraftApply(project.id, d.id, field, apply, terms));
	const setTemplate = (name: string) => void attempt(() => api.deliverableSetTemplate(project.id, d.id, name));
	const draftSel = useTermSelection(dr.vocab);
	const onPicked = (act: (terms: string[]) => void) => () => {
		act(draftSel.picked);
		draftSel.clear();
	};
	/** 고른 말을 사전으로 한 번에 올리고 알림은 한 번만 띄운다. */
	const promote = async (terms: string[]) => {
		try {
			const { added, merged } = await api.deliverableVocabPromote(project.id, d.id, terms);
			await qc.invalidateQueries({ queryKey: qk.glossary(project.id) });
			const what = terms.length === 1 ? `「${terms[0]}」 을` : `어휘 ${added + merged}개를`;
			const both = terms.length > 1 && merged > 0 ? ` (${merged}개는 이미 있어 뜻 · 비슷한 말만 보탬)` : "";
			toast(`${what} 어휘 사전으로 올렸습니다${both}${glossary?.glossary.enabled ? "" : ". 사전이 꺼져 있어 켜야 쓰입니다"}`);
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	return (
		<div className="flex flex-col gap-7">
			<LearnBar project={project} d={d} hasDraft={hasDraft} onAll={(apply) => draftAct("all", apply)} />
			<Block
				title="템플릿 · 참고 자료"
				action={
					<Button
						size="sm"
						variant="outline"
						onClick={async () => {
							const picked = await openDialog({ multiple: true, title: "템플릿 · 참고 자료" });
							if (Array.isArray(picked) && picked.length) await addRefs(picked);
						}}
					>
						<Plus />
						파일 넣기
					</Button>
				}
			>
				<div ref={dropRef} className={cn("rounded-md", over && "ring-2 ring-foreground/40")}>
					{d.refs.length === 0 ? (
						<div className="rounded-md border border-dashed border-border-strong px-4 py-6 text-center text-[13px] leading-relaxed break-keep text-subtle">
							양식 파일이나 지난 산출물 · 회의록을 끌어다 놓으세요.
							<br />
							hwpx · docx · xlsx · pptx 는 앱이 글자를 뽑아 Claude 에게 넘깁니다. hwp 는 읽지 못하니 hwpx 나 PDF 로 넣으세요.
						</div>
					) : (
						<ul className="surface divide-y divide-border overflow-hidden rounded-md">
							{d.refs.map((r) => (
								<ContextActions
									key={r.name}
									items={[
										...fileActions(joinPath(d.dir, "refs", r.name)),
										// 뽑은 글자는 Claude 가 실제로 읽는 쪽이다. 템플릿을 어떻게 읽었는지 볼 때 연다.
										!!r.textPath && { label: "뽑은 글자 열기", icon: <FileText />, onSelect: () => void attempt(() => api.open(r.textPath)) },
										r.template
											? { label: "템플릿에서 빼기", icon: <Stamp />, onSelect: () => setTemplate("") }
											: TEMPLATE_EXTS.includes(extOf(r.name)) && { label: "템플릿으로 쓰기", icon: <Stamp />, onSelect: () => setTemplate(r.name) },
										"sep",
										{ label: "빼기", icon: <X />, destructive: true, onSelect: () => void attempt(() => api.deliverableRefDelete(project.id, d.id, r.name)) },
									]}
								>
									<li className="flex h-10 items-center gap-3 px-3 text-[13px]">
										<FileIcon name={r.name} className="text-subtle" />
										<span className="min-w-0 flex-1 truncate">{r.name}</span>
										{r.template && <Chip tone="brand">템플릿</Chip>}
										<span className="tabular text-[12px] text-subtle">{bytes(r.size)}</span>
										<span className={cn("w-28 text-right text-[12px]", r.kind === "none" || (r.kind === "extract" && !r.textPath) ? "text-danger" : "text-subtle")}>
											{REF_STATE[r.kind](r)}
										</span>
										<Button size="icon-xs" variant="ghost" aria-label={`${r.name} 열기`} onClick={() => void api.open(joinPath(d.dir, "refs", r.name)).catch((e) => toast.error(errorText(e)))}>
											<ExternalLink />
										</Button>
										<Button
											size="icon-xs"
											variant="ghost"
											aria-label={`${r.name} 빼기`}
											onClick={() => void api.deliverableRefDelete(project.id, d.id, r.name).catch((e) => toast.error(errorText(e)))}
										>
											<X />
										</Button>
									</li>
								</ContextActions>
							))}
						</ul>
					)}
				</div>
				{dr.template && (
					<Suggest onApply={() => draftAct("template", true)} onDiscard={() => draftAct("template", false)}>
						템플릿으로 <span className="font-medium text-foreground">{dr.template}</span> 이 더 맞아 보입니다
					</Suggest>
				)}
			</Block>

			<Block title="작성법" hint="템플릿 · 지난 판에서 뽑음 · 고칠 수 있음">
				<MarkdownEditor
					value={skill}
					onChange={setSkill}
					onBlur={() => skill !== d.skill && save({ skill })}
					placeholder={"구성 · 문체 · 표기 규칙. 파일을 넣으면 Claude 가 뽑아 채웁니다.\n## 구성\n1. 개요\n2. 표 — 열: …"}
					minHeight="7rem"
					maxHeight="22rem"
					className="rounded-md border border-border"
				/>
				{dr.skill && (
					<Suggest onApply={() => draftAct("skill", true)} onDiscard={() => draftAct("skill", false)} block>
						<span>새로 뽑은 작성법 — 적용하면 지금 작성법을 바꿉니다</span>
						<Markdown text={dr.skill} className="mt-1.5 max-h-48 overflow-y-auto text-[12.5px]" />
					</Suggest>
				)}
			</Block>

			<Block title="어휘" hint="이 문서에서 쓸 말 · 눌러 골라 한꺼번에 빼거나 사전으로 올림">
				<VocabEditor vocab={d.vocab} onChange={(vocab) => save({ vocab })} onPromote={(t) => void promote(t)} />
				{dr.vocab.length > 0 && (
					<Suggest
						onApply={() => draftAct("vocab", true)}
						onDiscard={() => draftAct("vocab", false)}
						block
						// 고르지 않았으면 지금처럼 전부에, 고르면 고른 것에만 건다.
						actions={
							draftSel.count > 0 && (
								<SelectionBar count={draftSel.count} total={dr.vocab.length} onAll={draftSel.all} onClear={draftSel.clear} className="w-full border-0 bg-transparent px-0 py-0">
									<Button size="xs" variant="ghost" onClick={onPicked((t) => draftAct("vocab", false, t))}>
										버리기
									</Button>
									<Button size="xs" variant="ghost" onClick={onPicked((t) => void promote(t))}>
										사전으로 바로 올리기
									</Button>
									<Button size="xs" variant="outline" onClick={onPicked((t) => draftAct("vocab", true, t))}>
										적용
									</Button>
								</SelectionBar>
							)
						}
					>
						<span>새로 찾은 말 {dr.vocab.length}개 — 적용하면 덧붙입니다. 눌러 고르면 그 말만 처리합니다</span>
						<div className="mt-1.5 flex flex-wrap gap-1.5" onKeyDown={draftSel.onKeyDown}>
							{dr.vocab.map((t, i) => (
								<TermChip key={t.term} t={t} tone="draft" selected={draftSel.has(t)} onSelect={(e) => draftSel.toggle(i, e)} />
							))}
						</div>
					</Suggest>
				)}
				<div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-subtle">
					{glossary?.glossary.enabled ? (
						<>
							<span>프로젝트 어휘 사전 {shared.length}개도 함께 붙습니다. 같은 말이면 위의 것을 따릅니다.</span>
							{shared.slice(0, 8).map((e) => (
								<TermChip key={e.term} t={{ term: e.term, avoid: [], note: e.meaning }} tone="shared" />
							))}
							{shared.length > 8 && <span>외 {shared.length - 8}개</span>}
						</>
					) : (
						<span>프로젝트 어휘 사전은 꺼져 있습니다. 켜면 모든 산출물에 함께 붙습니다.</span>
					)}
					<Button size="xs" variant="ghost" onClick={() => setView("glossary")}>
						<BookA />
						어휘 사전
					</Button>
				</div>
			</Block>

			<Block title="작성 지침" hint="내가 적는 칸 · 다시 뽑아도 바뀌지 않음">
				<Textarea
					value={guide}
					onChange={(e) => setGuide(e.target.value)}
					onBlur={() => guide !== d.guide && save({ guide })}
					placeholder="누가 읽는지, 무엇을 담는지, 말투. 예: 발주처 보고용. 표는 템플릿과 같은 열로. 확인하지 못한 것은 확인하지 못했다고 적는다."
					className="min-h-28 resize-y bg-transparent text-[13.5px] leading-relaxed"
				/>
			</Block>

			{/* 2026.10.29 : 「마크다운으로 받기」를 없앴다. 마크다운도 형식의 하나로 Claude 가 파일로 만든다 */}
			<Block title="파일 형식">
				<div className="flex items-center gap-2">
					<Input
						value={format}
						onChange={(e) => setFormat(e.target.value)}
						onBlur={() => format !== d.format && save({ format })}
						placeholder={d.template ? "비우면 템플릿을 따름" : "비우면 md"}
						className="mono h-8 w-40 text-[13px] md:text-[13px]"
					/>
					<span className="text-[12.5px] text-subtle">{d.template ? `템플릿 ${d.template}` : "템플릿 없음"} · 이번에 만들 형식 {ext}</span>
				</div>
				<p className="text-[12.5px] leading-relaxed break-keep text-subtle">
					한글(hwpx) · 워드 · 엑셀 · 파워포인트 · 마크다운 등으로 만듭니다. 문서 스킬을 돌리느라 명령 실행을 허용합니다. 저장소 안 편집은 막지만 명령으로 쓰는 것까지 막지는 못합니다.
				</p>
				{dr.format && (
					<Suggest onApply={() => draftAct("format", true)} onDiscard={() => draftAct("format", false)}>
						파일 형식을 <span className="mono font-medium text-foreground">{dr.format}</span> 로 {d.format ? `(지금 ${d.format})` : ""}
					</Suggest>
				)}
			</Block>

			{/* 자동 갱신 스위치 · 기록은 「자동 관리」 탭이 맡는다. 예전 자리를 찾는 사람을 위해 길잡이 한 줄만 둔다 */}
			<div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px]">
				<span className="min-w-0 flex-1 break-keep text-muted-foreground">코드가 바뀌면 자동 갱신 · {d.autoUpdate ? "켜짐" : "꺼짐"}</span>
				<Button size="sm" variant="ghost" onClick={onAuto}>
					자동 관리 탭에서 바꾸기
				</Button>
			</div>

			<Block title="파일 이름">
				<Input
					value={naming}
					onChange={(e) => setNaming(e.target.value)}
					onBlur={() => naming !== d.naming && save({ naming })}
					placeholder={project.naming || "{제목}_v{판}_{날짜}"}
					className="h-8 text-[13px] md:text-[13px]"
				/>
				<p className="text-[12.5px] leading-relaxed text-subtle">
					비우면 산출물 설정의 기본 규칙을 따릅니다. 쓸 수 있는 자리: <span className="mono text-muted-foreground">{"{제목} {판} {날짜} {시각} {프로젝트}"}</span>
				</p>
				<p className="text-[13px]">
					<span className="text-subtle">다음 판 </span>
					<span className="font-medium">{preview.replace(/\.md$/, `.${ext}`)}</span>
				</p>
				<p className="text-[12.5px] text-subtle">가져온 파일은 받은 이름 그대로 둡니다.</p>
				{dr.naming && (
					<Suggest onApply={() => draftAct("naming", true)} onDiscard={() => draftAct("naming", false)}>
						파일 이름에서 찾은 규칙 <span className="mono font-medium text-foreground">{dr.naming}</span>
					</Suggest>
				)}
			</Block>

			<Block title="저장 폴더">
				<div className="flex items-center gap-2">
					<code className="mono min-w-0 flex-1 truncate rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[12.5px] selectable">{d.outputDir}</code>
					<Button size="icon" variant="outline" aria-label="폴더 열기" onClick={() => void api.open(d.outputDir).catch((e) => toast.error(errorText(e)))}>
						<FolderOpen />
					</Button>
				</div>
				{project.deliverablesDir ? (
					<div className="flex items-center gap-2">
						<span className="shrink-0 text-[13px] text-muted-foreground">하위 폴더</span>
						<Input
							value={subdir}
							onChange={(e) => setSubdir(e.target.value)}
							onBlur={() => subdir !== d.subdir && save({ subdir })}
							placeholder="예: API_명세서"
							className="h-8 text-[13px]"
						/>
					</div>
				) : (
					<p className="text-[12.5px] leading-relaxed break-keep text-subtle">산출물 화면의 「산출물 설정」에서 산출물 폴더를 정하면 그 폴더에 둡니다. 지금은 앱 데이터 폴더에 판마다 폴더를 나눠 둡니다.</p>
				)}
			</Block>
		</div>
	);
}

/**
 * 작성법 뽑기의 상태 줄. 뽑는 중 · 실패 · 마지막으로 뽑은 때와 비용을 보이고, 다시 뽑기와 제안 한꺼번에 처리를 둔다.
 * 뽑기는 구현 모델로 돌아 비용이 들어서, 언제 얼마나 썼는지를 늘 보인다.
 * 뽑는 동안은 중지 단추를 두고 기록을 펼쳐 둔다. 끝난 뒤에도 「기록」으로 마지막 응답을 다시 본다.
 */
function LearnBar({ project, d, hasDraft, onAll }: { project: Project; d: Deliverable; hasDraft: boolean; onAll: (apply: boolean) => void }) {
	const learning = !!d.learn;
	const queued = d.learn?.phase === "queued";
	const runId = d.learn?.runId || d.learnLastRun;
	const [showLog, setShowLog] = useState(learning);
	useEffect(() => {
		if (learning) setShowLog(true);
	}, [learning]);
	const state = queued
		? "앞선 뽑기를 기다리는 중 — 뽑기는 동시에 둘까지만 돕니다"
		: learning
			? "템플릿 · 자료 · 지난 판을 읽고 작성법 · 어휘 · 형식을 뽑는 중"
			: d.learnedAt
			? `${relTime(d.learnedAt)}에 뽑음${d.learnCostUsd ? ` · 지금까지 ${cost(d.learnCostUsd)}` : ""}`
			: "파일을 넣거나 등록하면 작성법 · 어휘 · 형식 · 템플릿 · 이름 규칙을 뽑아 아래 칸을 채웁니다";
	return (
		<div className="surface flex flex-col gap-2 rounded-md px-3.5 py-3">
			<div className="flex items-center gap-2">
				{learning ? <Loader2 className="size-4 animate-spin text-run" /> : <RefreshCw className="size-4 text-subtle" />}
				<span className="min-w-0 flex-1 text-[13px] break-keep text-muted-foreground">{state}</span>
				{hasDraft && !learning && (
					<>
						<Button size="sm" variant="ghost" onClick={() => onAll(false)}>
							제안 모두 버리기
						</Button>
						<Button size="sm" variant="outline" onClick={() => onAll(true)}>
							제안 모두 적용
						</Button>
					</>
				)}
				{runId && !queued && (
					<Button size="sm" variant="ghost" aria-expanded={showLog} onClick={() => setShowLog((s) => !s)}>
						기록
						<ChevronDown className={cn("transition-transform", showLog && "rotate-180")} />
					</Button>
				)}
				{learning ? (
					<Button size="sm" variant="outline" onClick={() => void attempt(() => api.deliverableLearnStop(project.id, d.id))}>
						<Square className="fill-current" />
						{queued ? "줄에서 빼기" : "중지"}
					</Button>
				) : (
					<Button size="sm" variant="outline" onClick={() => void attempt(() => api.deliverableLearn(project.id, d.id))}>
						<RefreshCw />
						{d.learnedAt ? "다시 뽑기" : "작성법 뽑기"}
					</Button>
				)}
			</div>
			{showLog && runId && !queued && (
				<div className="rounded-md border border-border px-3 py-2">
					<RunEvents projectId={project.id} target="learn" targetId={d.id} runId={runId} live={learning} />
				</div>
			)}
			{d.learnError && !learning && <p className="text-[12.5px] leading-relaxed break-keep text-danger selectable">{d.learnError}</p>}
			{!learning && (
				<p className="text-[12px] leading-relaxed break-keep text-subtle">
					빈 칸은 바로 채우고, 값이 있는 칸은 아래에 제안으로만 둡니다. 작성 지침은 바꾸지 않습니다. 뽑은 내용은 앱 데이터에만 둡니다.
				</p>
			)}
		</div>
	);
}

/** 값이 있는 칸에 들어갈 뽑은 값. 적용해야 칸이 바뀐다. actions 를 주면 기본 「버리기 · 적용」 대신 그것을 둔다. */
function Suggest({ children, onApply, onDiscard, block, actions }: { children: ReactNode; onApply: () => void; onDiscard: () => void; block?: boolean; actions?: ReactNode }) {
	return (
		<div className={cn("flex gap-2 rounded-md border border-dashed border-brand/45 bg-brand/6 px-3 py-2 text-[12.5px] text-muted-foreground", block ? "flex-col" : "items-center")}>
			<div className={cn("min-w-0 break-keep", !block && "flex-1")}>{children}</div>
			{actions || (
				<div className="flex shrink-0 justify-end gap-1">
					<Button size="xs" variant="ghost" onClick={onDiscard}>
						버리기
					</Button>
					<Button size="xs" variant="outline" onClick={onApply}>
						적용
					</Button>
				</div>
			)}
		</div>
	);
}

function Block({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<div className="flex min-h-7 items-center gap-2">
				<SectionTitle>{title}</SectionTitle>
				{hint && <span className="text-[12px] text-subtle">{hint}</span>}
				<div className="flex-1" />
				{action}
			</div>
			{children}
		</section>
	);
}
