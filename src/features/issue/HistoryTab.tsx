import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Chip, SectionTitle } from "@/components/bits";
import { RunEvents } from "@/components/RunLog";
import { clock, cost, duration } from "@/lib/format";
import { HISTORY_LABEL, RUN_KIND_LABEL } from "@/lib/status";
import type { Issue, RunRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

const RUN_TONE = { running: "run", ok: "muted", error: "danger", stopped: "muted" } as const;
const RUN_STATUS = { running: "실행 중", ok: "끝", error: "실패", stopped: "중지" } as const;

export function HistoryTab({ issue }: { issue: Issue }) {
	const runs = [...issue.runs].reverse();
	const current = issue.run?.runId;
	return (
		<div className="flex flex-col gap-7">
			<section className="flex flex-col gap-2">
				<SectionTitle>Claude 실행</SectionTitle>
				{issue.run?.phase === "queued" && <p className="text-[13px] text-subtle">같은 프로젝트의 앞선 작업이 끝나기를 기다립니다.</p>}
				{runs.length === 0 && !issue.run && <p className="text-[13px] text-subtle">아직 실행하지 않았습니다.</p>}
				<div className="flex flex-col gap-1.5">
					{runs.map((r) => (
						<RunRow key={r.id} issue={issue} run={r} defaultOpen={r.id === current || (!current && r === runs[0])} />
					))}
				</div>
			</section>

			<section className="flex flex-col gap-2">
				<SectionTitle>흐름</SectionTitle>
				<ol className="relative flex flex-col gap-3 border-l border-border pl-4">
					{issue.history.map((h, i) => (
						<li key={i} className="relative">
							<span className="absolute top-[7px] -left-[20.5px] size-2 rounded-full border border-[var(--border-strong)] bg-[var(--background)]" />
							<div className="flex items-baseline gap-2 text-[13px]">
								<span className="font-medium">{HISTORY_LABEL[h.kind] ?? h.kind}</span>
								<span className="text-[12px] text-subtle">{clock(h.at)}</span>
							</div>
							{h.text && (
								<p className="mt-1 text-[13px] leading-relaxed break-keep whitespace-pre-wrap text-muted-foreground selectable">{h.text}</p>
							)}
						</li>
					))}
				</ol>
			</section>
		</div>
	);
}

/**
 * 이 실행이 그때 어떤 권한으로 돌았는지. 프로젝트 설정은 나중에 바뀌므로 실행마다 남긴 값을 보인다.
 * 전역 · 저장소 설정의 규칙은 여기 없다 — CLI 가 실행 때 읽어 합친다. 프로젝트 설정의 「실제로 걸리는 규칙」에서 본다.
 */
function RunPerms({ run }: { run: RunRecord }) {
	const [open, setOpen] = useState(false);
	const rows: [string, string[]][] = [
		["허용", run.allowed],
		["거부", run.deniedRules],
		["실행한 명령", run.commands],
	];
	return (
		<div className="mb-2 border-b border-border pb-2 text-[12px]">
			<button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-subtle hover:text-foreground">
				<ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
				권한 {run.mode}
				<span className="tabular">· 허용 {run.allowed.length} · 거부 {run.deniedRules.length} · 명령 {run.commands.length}</span>
			</button>
			{open && (
				<dl className="mt-1.5 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 pl-4.5">
					{rows.map(([k, v]) => (
						<div key={k} className="contents">
							<dt className="text-subtle">{k}</dt>
							<dd className="mono flex min-w-0 flex-col text-[11.5px] text-muted-foreground selectable">
								{v.length === 0 ? <span className="font-sans text-subtle">없음</span> : v.map((x, i) => <span key={i} className="truncate" title={x}>{x}</span>)}
							</dd>
						</div>
					))}
				</dl>
			)}
		</div>
	);
}

function RunRow({ issue, run, defaultOpen }: { issue: Issue; run: RunRecord; defaultOpen: boolean }) {
	const [open, setOpen] = useState(defaultOpen);
	const live = run.status === "running";
	return (
		<div className="surface rounded-lg">
			<button type="button" onClick={() => setOpen((v) => !v)} className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px]">
				<ChevronRight className={cn("size-3.5 text-subtle transition-transform", open && "rotate-90")} />
				<span className="font-medium">{RUN_KIND_LABEL[run.kind] ?? run.kind}</span>
				<Chip tone={RUN_TONE[run.status]}>{RUN_STATUS[run.status]}</Chip>
				{run.mode && <span className="text-[12px] text-subtle">{run.mode}</span>}
				{(run.denials?.length ?? 0) > 0 && <span className="text-[12px] text-brand-text">막힘 {run.denials.length}</span>}
				<span className="flex-1" />
				<span className="tabular text-[12px] text-subtle">
					{[clock(run.startedAt), duration(run.durationMs), run.numTurns ? `${run.numTurns}턴` : "", cost(run.costUsd)].filter(Boolean).join(" · ")}
				</span>
			</button>
			{open && (
				<div className="border-t border-border px-3 py-2">
					{run.mode && <RunPerms run={run} />}
					<RunEvents projectId={issue.projectId} target="issue" targetId={issue.id} runId={run.id} live={live} />
				</div>
			)}
		</div>
	);
}
