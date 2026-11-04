import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	BookMarked,
	Brain,
	Check,
	ChevronRight,
	FilePen,
	Hand,
	FileText,
	Globe,
	ListChecks,
	Loader2,
	Search,
	SquareTerminal,
	Workflow,
	Wrench,
	X,
} from "lucide-react";
import { api } from "@/lib/api";
import { cost, duration } from "@/lib/format";
import { liveKey, toolLabel, useLive } from "@/lib/store";
import type { RunEnvelope, RunEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Diffstat } from "./bits";
import { Markdown } from "./Markdown";
import { DeniedLine } from "./Permissions";

function ToolIcon({ name }: { name: string }) {
	const c = "size-3.5 shrink-0";
	switch (name) {
		case "Read":
			return <FileText className={c} />;
		case "Grep":
		case "Glob":
			return <Search className={c} />;
		case "Edit":
		case "MultiEdit":
		case "Write":
		case "NotebookEdit":
			return <FilePen className={c} />;
		case "Bash":
		case "PowerShell":
			return <SquareTerminal className={c} />;
		case "WebFetch":
		case "WebSearch":
			return <Globe className={c} />;
		case "Task":
		case "Agent":
			return <Workflow className={c} />;
		case "Skill":
			return <BookMarked className={c} />;
		case "TodoWrite":
			return <ListChecks className={c} />;
		default:
			return <Wrench className={c} />;
	}
}

/**
 * projectId 를 주면 막힌 명령 줄에 「허용」 단추가 생긴다. base · root 는 답에 건 그림을 풀 폴더다(Markdown 과 같다).
 * follow 를 끄면 스스로 스크롤하지 않는다. 대화처럼 여러 기록이 한 칸에 쌓이면 칸이 따라갈지를 정한다 —
 * 기록마다 따로 정하면 새 차례가 「바닥에 붙어 있다」고 믿고 위를 읽던 사람을 끌어내린다.
 */
export function RunLog({
	events,
	live,
	className,
	projectId,
	base,
	root,
	follow = true,
}: {
	events: RunEvent[];
	live?: boolean;
	className?: string;
	projectId?: string;
	base?: string;
	root?: string;
	follow?: boolean;
}) {
	const box = useRef<HTMLOListElement>(null);
	const stick = useRef(true);
	const results = new Map<string, boolean>();
	const outputs = new Map<string, string>();
	for (const e of events)
		if (e.t === "toolDone") {
			results.set(e.id, e.ok);
			if (e.output) outputs.set(e.id, e.output);
		}
	// 흘러 오는 글은 길이만 바뀌고 사건 수는 그대로라, 따라 내려갈 때 그 길이도 본다.
	const tail = events[events.length - 1];
	const grow = tail?.t === "delta" ? tail.text.length : 0;

	// 실행 중에는 새 줄을 따라 내려간다. 사용자가 위로 올려 읽고 있으면 붙잡지 않는다.
	useLayoutEffect(() => {
		const el = box.current?.closest("[data-scroll]") as HTMLElement | null;
		if (follow && live && el && stick.current) el.scrollTop = el.scrollHeight;
	}, [events.length, grow, live, follow]);
	useEffect(() => {
		const el = box.current?.closest("[data-scroll]") as HTMLElement | null;
		if (!follow || !el) return;
		const on = () => (stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60);
		el.addEventListener("scroll", on);
		return () => el.removeEventListener("scroll", on);
	}, [follow]);

	if (events.length === 0) {
		return <div className={cn("py-3 text-[12.5px] text-subtle", className)}>{live ? "Claude 를 띄우는 중입니다" : "남은 기록이 없습니다"}</div>;
	}

	return (
		// 글 조각마다 Markdown 이 따로라, 한 실행의 그림을 함께 넘기도록 묶음은 기록 전체로 잡는다.
		<ol ref={box} data-image-group="" className={cn("flex flex-col", className)}>
			{events.map((e, i) => {
				switch (e.t) {
					case "init":
						return (
							<li key={i} className="pb-1 text-[11.5px] text-subtle">
								{e.model}
							</li>
						);
					case "text":
						return (
							<li key={i} className="py-1.5">
								<Markdown text={e.text} base={base} root={root} className="text-[13px] leading-relaxed text-muted-foreground" />
							</li>
						);
					case "delta":
						return (
							<li key={i} className="py-1.5">
								<Markdown text={e.text} base={base} root={root} className="text-[13px] leading-relaxed text-muted-foreground" />
							</li>
						);
					case "thinking":
						return (
							<li key={i}>
								<Fold label="생각" icon={<Brain className="size-3.5 shrink-0" />}>
									<div className="text-[12.5px] leading-relaxed whitespace-pre-wrap text-subtle selectable">{e.text}</div>
								</Fold>
							</li>
						);
					case "ask":
						return (
							<li key={i} className="flex min-h-7 items-center gap-2 text-[12.5px] text-subtle">
								<Hand className="size-3.5 shrink-0" />
								<span className="shrink-0 font-medium">{e.tool === "AskUserQuestion" ? "되물음" : "허락을 물음"}</span>
								<span className="mono min-w-0 flex-1 truncate text-[12px]" title={e.summary}>
									{e.tool === "AskUserQuestion" ? "" : `${toolLabel(e.tool)} ${e.summary}`}
								</span>
							</li>
						);
					case "tool": {
						const r = results.get(e.id);
						const pending = r === undefined;
						const out = outputs.get(e.id);
						const head = (
							<>
								<span className="text-subtle">
									<ToolIcon name={e.name} />
								</span>
								<span className="shrink-0 font-medium text-muted-foreground">{toolLabel(e.name)}</span>
								<span className="mono min-w-0 flex-1 truncate text-left text-[12px] text-subtle" title={e.summary}>
									{e.summary}
								</span>
								{pending ? (
									live ? (
										<Loader2 className="size-3.5 animate-spin text-run" />
									) : null
								) : r ? (
									<Check className="size-3.5 text-subtle" />
								) : (
									<X className="size-3.5 text-danger" aria-label="실패" />
								)}
							</>
						);
						// 결과 글이 있으면 줄을 눌러 펼친다. 터미널처럼 명령 출력 · 읽은 내용을 볼 수 있게 한다.
						return out ? (
							<li key={i}>
								<ToolOutput head={head} output={out} failed={r === false} />
							</li>
						) : (
							<li key={i} className="flex min-h-7 items-center gap-2 text-[12.5px]">
								{head}
							</li>
						);
					}
					case "change":
						return (
							<li key={i} className="flex min-h-7 items-center gap-2 pl-5.5 text-[12px]">
								<span className="mono min-w-0 flex-1 truncate text-foreground">{e.rel}</span>
								{e.kind === "create" && <span className="text-[11px] text-ok">새 파일</span>}
								<Diffstat added={e.added} removed={e.removed} />
							</li>
						);
					case "denied":
						return (
							<li key={i} className="pl-0">
								<DeniedLine denial={e} projectId={projectId} />
							</li>
						);
					case "done":
						return (
							<li key={i} className={cn("mt-2 border-t border-border pt-2 text-[12px]", e.ok ? "text-subtle" : "text-danger")}>
								{e.ok ? "끝" : "실패"}
								{[duration(e.durationMs), e.numTurns ? `${e.numTurns}턴` : "", cost(e.costUsd)].filter(Boolean).map((x) => ` · ${x}`)}
								{!e.ok && e.error && <div className="mt-1 whitespace-pre-wrap text-danger/90 selectable">{e.error}</div>}
							</li>
						);
					default:
						return null;
				}
			})}
		</ol>
	);
}

/** 접힌 채 보이는 덩어리. 생각 블록처럼 길지만 늘 볼 필요는 없는 것을 담는다. */
function Fold({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="flex flex-col">
			<button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-7 items-center gap-2 text-left text-[12.5px] text-subtle hover:text-foreground">
				{icon}
				<span className="font-medium">{label}</span>
				<ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
			</button>
			{open && <div className="mb-1 ml-5.5 border-l border-border pl-3">{children}</div>}
		</div>
	);
}

function ToolOutput({ head, output, failed }: { head: React.ReactNode; output: string; failed: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="flex flex-col">
			<button type="button" aria-expanded={open} title={open ? "결과 접기" : "결과 펼치기"} onClick={() => setOpen(!open)} className="flex min-h-7 w-full items-center gap-2 rounded text-[12.5px] hover:bg-hover">
				{head}
			</button>
			{open && (
				<pre className={cn("mono mb-1 ml-5.5 max-h-72 overflow-auto rounded-md border border-border bg-secondary/40 px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap selectable", failed ? "text-danger/90" : "text-muted-foreground")}>
					{output}
				</pre>
			)}
		</div>
	);
}

/** 실행 중이면 실시간 사건을, 끝났으면 저장된 기록을 펼친다. */
export function RunEvents({
	projectId,
	target,
	targetId,
	runId,
	live,
	base,
	root,
	follow,
}: {
	projectId: string;
	target: RunEnvelope["target"];
	targetId: string;
	runId: string;
	live: boolean;
	base?: string;
	root?: string;
	follow?: boolean;
}) {
	const liveRun = useLive((s) => s.byTarget[liveKey(target, targetId)]);
	const [saved, setSaved] = useState(!live);
	useEffect(() => setSaved(!live), [live]);
	const { data } = useQuery({
		queryKey: ["run", projectId, target, targetId, runId],
		queryFn: () => api.runEvents(projectId, target, targetId, runId),
		enabled: saved,
	});
	const events = live && liveRun?.runId === runId ? liveRun.events : (data ?? (liveRun?.runId === runId ? liveRun.events : []));
	return <RunLog events={events} live={live} projectId={projectId} base={base} root={root} follow={follow} />;
}
