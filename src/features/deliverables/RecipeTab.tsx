import { useEffect, useState, type ReactNode } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ExternalLink, FolderOpen, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { SectionTitle } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, errorText } from "@/lib/api";
import { useDropZone } from "@/lib/drop";
import { bytes, joinPath } from "@/lib/format";
import type { Deliverable, DeliverablePatch, Project, RefFile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FileIcon } from "./Deliverables";

const REF_STATE: Record<RefFile["kind"], (r: RefFile) => string> = {
	direct: () => "그대로 읽음",
	extract: (r) => (r.textPath ? "글자를 뽑아 둠" : "글자를 뽑지 못함"),
	none: () => "읽지 못하는 형식",
};

/**
 * 산출물을 「어떻게 만드는지」를 모은다. Claude 에게 쓰게 할 때마다 이 재료를 그대로 넘긴다.
 * 글은 칸을 벗어날 때 저장한다. 고칠 때마다 저장하면 목록 정렬이 계속 흔들린다.
 */
export function RecipeTab({ project, d }: { project: Project; d: Deliverable }) {
	const [guide, setGuide] = useState(d.guide);
	const [naming, setNaming] = useState(d.naming);
	const [subdir, setSubdir] = useState(d.subdir);
	const [preview, setPreview] = useState(d.nextName);
	useEffect(() => {
		setGuide(d.guide);
		setNaming(d.naming);
		setSubdir(d.subdir);
	}, [d.guide, d.naming, d.subdir]);

	const nextN = Math.max(0, ...d.versions.map((v) => v.n)) + 1;
	useEffect(() => {
		const t = setTimeout(() => {
			api.namingPreview(project.id, naming || project.naming, d.title, nextN).then(setPreview, () => {});
		}, 150);
		return () => clearTimeout(t);
	}, [naming, d.title, nextN, project.id, project.naming]);

	const save = (patch: Partial<DeliverablePatch>) => {
		const full: DeliverablePatch = { title: d.title, note: d.note, guide, naming, subdir, mode: d.mode, ...patch };
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
	const asFile = d.mode === "file";
	const ext = asFile ? "(템플릿 형식)" : "md";

	return (
		<div className="flex flex-col gap-7">
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
								<li key={r.name} className="flex h-10 items-center gap-3 px-3 text-[13px]">
									<FileIcon name={r.name} className="text-subtle" />
									<span className="min-w-0 flex-1 truncate">{r.name}</span>
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
							))}
						</ul>
					)}
				</div>
			</Block>

			<Block title="작성 지침">
				<Textarea
					value={guide}
					onChange={(e) => setGuide(e.target.value)}
					onBlur={() => guide !== d.guide && save({ guide })}
					placeholder="누가 읽는지, 무엇을 담는지, 말투. 예: 발주처 보고용. 표는 템플릿과 같은 열로. 확인하지 못한 것은 확인하지 못했다고 적는다."
					className="min-h-28 resize-y bg-transparent text-[13.5px] leading-relaxed"
				/>
			</Block>

			<Block title="만드는 방식">
				<div className="grid grid-cols-2 gap-2">
					<Choice selected={!asFile} onClick={() => save({ mode: "md" })} title="마크다운으로 받기">
						Claude 는 읽기만 하고, 앱이 받은 글을 .md 로 저장합니다.
					</Choice>
					<Choice selected={asFile} onClick={() => save({ mode: "file" })} title="Claude 가 파일로 만들기">
						템플릿 형식(hwpx · docx · xlsx · pptx)으로 만듭니다. 문서 스킬을 돌리느라 명령 실행을 허용합니다. 저장소 안 편집은 막지만 명령으로 쓰는 것까지 막지는 못합니다.
					</Choice>
				</div>
			</Block>

			<Block title="파일 이름">
				<Input
					value={naming}
					onChange={(e) => setNaming(e.target.value)}
					onBlur={() => naming !== d.naming && save({ naming })}
					placeholder={project.naming || "{제목}_v{판}_{날짜}"}
					className="h-8 text-[13px] md:text-[13px]"
				/>
				<p className="text-[12.5px] leading-relaxed text-subtle">
					비우면 프로젝트 규칙을 따릅니다. 쓸 수 있는 자리: <span className="mono text-muted-foreground">{"{제목} {판} {날짜} {시각} {프로젝트}"}</span>
				</p>
				<p className="text-[13px]">
					<span className="text-subtle">다음 판 </span>
					<span className="font-medium">{asFile ? preview.replace(/\.md$/, `.${ext}`) : preview}</span>
				</p>
				<p className="text-[12.5px] text-subtle">가져온 파일은 받은 이름 그대로 둡니다.</p>
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
					<p className="text-[12.5px] leading-relaxed break-keep text-subtle">프로젝트 설정에서 산출물 폴더를 정하면 그 폴더에 둡니다. 지금은 앱 데이터 폴더에 판마다 폴더를 나눠 둡니다.</p>
				)}
			</Block>
		</div>
	);
}

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<div className="flex min-h-7 items-center gap-2">
				<SectionTitle>{title}</SectionTitle>
				<div className="flex-1" />
				{action}
			</div>
			{children}
		</section>
	);
}

function Choice({ selected, onClick, title, children }: { selected: boolean; onClick: () => void; title: string; children: ReactNode }) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onClick}
			className={cn("surface flex flex-col gap-1 rounded-md px-3.5 py-3 text-left transition-colors hover:border-border-strong", selected && "border-foreground/60")}
		>
			<span className="flex items-center gap-2 text-[13px] font-medium">
				<span className={cn("grid size-3.5 place-items-center rounded-full border", selected ? "border-foreground" : "border-border-strong")}>
					{selected && <span className="size-1.5 rounded-full bg-foreground" />}
				</span>
				{title}
			</span>
			<span className="text-[12.5px] leading-relaxed break-keep text-subtle">{children}</span>
		</button>
	);
}
