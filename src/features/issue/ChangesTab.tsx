import { useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { ContextActions, fileActions } from "@/components/ActionMenu";
import { Empty, SectionTitle } from "@/components/bits";
import { DiffView } from "@/components/DiffView";
import { Markdown } from "@/components/Markdown";
import { DeniedBox } from "@/components/Permissions";
import { pluginActions } from "@/components/PluginResult";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { fileUrl, joinPath } from "@/lib/format";
import { useKey } from "@/lib/keys";
import { usePluginMenus } from "@/lib/queries";
import type { Issue, Shot } from "@/lib/types";

/**
 * 구현이 찍은 결과 화면. 글로 된 결과만으로는 화면이 어떻게 바뀌었는지 판단하기 어렵다.
 * 누르면 크게 보고, 크게 본 그림을 누르면 기본 프로그램으로 연다. 그림은 이슈 폴더(앱 데이터)에 있어 범위를 따로 열지 않는다.
 */
function Shots({ issue, shots }: { issue: Issue; shots: Shot[] }) {
	const [open, setOpen] = useState<Shot | null>(null);
	const path = (s: Shot) => joinPath(issue.dir, s.path);
	return (
		<div className="flex flex-col gap-1.5">
			<SectionTitle>결과 화면</SectionTitle>
			<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
				{shots.map((s) => (
					<figure key={s.path} className="flex min-w-0 flex-col gap-1">
						<ContextActions items={[{ label: "크게 보기", icon: <Maximize2 />, onSelect: () => setOpen(s) }, "sep", ...fileActions(path(s))]}>
							<button type="button" title="크게 보기" onClick={() => setOpen(s)} className="overflow-hidden rounded-md border border-border bg-secondary">
								<img src={fileUrl(path(s))} alt={s.caption} loading="lazy" className="aspect-[16/10] w-full object-cover object-top" />
							</button>
						</ContextActions>
						{s.caption && <figcaption className="text-[12.5px] leading-snug break-keep text-muted-foreground selectable">{s.caption}</figcaption>}
					</figure>
				))}
			</div>
			<Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
				<DialogContent className="flex max-h-[90vh] flex-col gap-3 sm:max-w-[min(1400px,calc(100%-4rem))]">
					<DialogTitle className="pr-8 text-[13px] text-muted-foreground">{open?.caption || "결과 화면"}</DialogTitle>
					{open && (
						<button type="button" title="기본 프로그램으로 열기" onClick={() => void api.open(path(open))} className="min-h-0 overflow-auto">
							<img src={fileUrl(path(open))} alt={open.caption} className="mx-auto max-w-full" />
						</button>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}

/** 바뀐 파일이 어디서 왔는지. 구현 · 대화 · 터미널마다 몇 차례에 걸쳐 몇 개 파일을 고쳤는지 센다. */
function sources(issue: Issue) {
	const kindOf = new Map(issue.runs.map((r) => [r.id, r.kind]));
	const by = new Map<string, { runs: Set<string>; files: Set<string> }>();
	for (const c of issue.changes) {
		const kind = c.runId.startsWith("terminal-") ? "terminal" : (kindOf.get(c.runId) ?? "implement");
		const label = { chat: "대화", terminal: "터미널" }[kind as string] ?? "구현";
		// 터미널 변경의 이름은 기록 줄마다 붙는다. 차례를 세려면 같은 차례의 줄을 묶어야 하나, 그 정보가 없어 파일 수만 센다.
		const run = kind === "terminal" ? "terminal" : c.runId;
		const g = by.get(label) ?? { runs: new Set(), files: new Set() };
		g.runs.add(run);
		g.files.add(c.rel);
		by.set(label, g);
	}
	return [...by.entries()].map(([label, g]) => (label === "터미널" || g.runs.size === 1 ? `${label} 파일 ${g.files.size}개` : `${label} ${g.runs.size}차례 · 파일 ${g.files.size}개`));
}

/**
 * 스크롤 칸 위 끝을 기준으로 다음(1) · 이전(-1) 파일 머리를 칸 맨 위로 올린다.
 * 위 끝에 걸친 머리는 「지금 보는 파일」로 친다 — 그러지 않으면 N 을 눌러도 같은 머리에 머문다.
 */
function jumpFile(root: HTMLElement | null, dir: 1 | -1) {
	const scroller = root?.closest<HTMLElement>("[data-scroll]");
	if (!root || !scroller) return;
	const top = scroller.getBoundingClientRect().top;
	const heads = [...root.querySelectorAll<HTMLElement>("[data-file-head]")];
	const target = dir === 1 ? heads.find((h) => h.getBoundingClientRect().top > top + 1) : heads.reverse().find((h) => h.getBoundingClientRect().top < top - 1);
	target?.scrollIntoView({ block: "start" });
}

// 구현 중이라는 것은 창 머리의 상태와 아랫단의 실시간 활동이 이미 말한다. 여기서는 바뀐 파일만 보인다.
export function ChangesTab({ issue, projectPath }: { issue: Issue; projectPath: string }) {
	const r = issue.result;
	const root = useRef<HTMLDivElement>(null);
	// 이 탭이 보일 때만 그려지므로 다른 탭에서는 N · P 가 걸리지 않는다. 한글 입력 상태에서도 되게 자판 자리로 본다.
	const files = issue.changes.length > 0;
	useKey({ id: "issue.file.next", combo: "N", code: "KeyN", label: "다음 바뀐 파일", group: "상세 창", series: "issue.file", inInput: "skip", enabled: files, run: () => jumpFile(root.current, 1) });
	useKey({ id: "issue.file.prev", combo: "P", code: "KeyP", label: "이전 바뀐 파일", group: "상세 창", series: "issue.file", inInput: "skip", enabled: files, run: () => jumpFile(root.current, -1) });
	const fileMenus = usePluginMenus("file");
	const implementing = issue.run?.kind === "implement" || issue.run?.kind === "chat";
	// 마지막으로 끝난 구현 · 수정 요청 · 대화에서 막힌 것. 결과의 「확인」 칸에 「권한이 없어 못 돌렸다」가 적혀 있을 때 바로 풀 수 있게 한다.
	const last = [...issue.runs].reverse().find((x) => (x.kind === "implement" || x.kind === "chat") && x.status !== "running");

	if (!r && issue.changes.length === 0) {
		return (
			<Empty>
				{implementing ? "아직 바뀐 파일이 없습니다. 고치는 대로 여기에 쌓입니다." : "아직 바뀐 파일이 없습니다. 구현 · 대화 · 터미널에서 고친 것이 여기에 쌓입니다."}
			</Empty>
		);
	}

	return (
		<div ref={root} className="flex flex-col gap-6">
			{r && (
				<section className="flex flex-col gap-5">
					<Markdown text={r.summary} base={issue.dir} root={projectPath} className="text-[14px]" />
					{r.screenshots && r.screenshots.length > 0 && <Shots issue={issue} shots={r.screenshots} />}
					{r.verification && (
						<div className="flex flex-col gap-1.5">
							<SectionTitle>확인</SectionTitle>
							<Markdown text={r.verification} base={issue.dir} root={projectPath} className="text-[13.5px] text-muted-foreground" />
						</div>
					)}
					{r.followups.length > 0 && (
						<div className="flex flex-col gap-1.5">
							<SectionTitle>이어서 할 일</SectionTitle>
							<ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px] leading-relaxed break-keep text-muted-foreground selectable">
								{r.followups.map((f, i) => (
									<li key={i}>{f}</li>
								))}
							</ul>
						</div>
					)}
				</section>
			)}
			{last && (last.denials?.length ?? 0) > 0 && <DeniedBox denials={last.denials} projectId={issue.projectId} />}
			{issue.changes.length > 0 && (
				<section className="flex flex-col gap-2">
					<div className="flex items-baseline gap-2">
						<SectionTitle>바뀐 파일</SectionTitle>
						<span className="text-[12px] text-subtle">{sources(issue).join(" · ")}</span>
					</div>
					<DiffView changes={issue.changes} fileMenu={(path) => pluginActions(fileMenus, { projectId: issue.projectId, issueId: issue.id, file: path, changes: true, session: !!issue.sessionId })} />
				</section>
			)}
		</div>
	);
}
