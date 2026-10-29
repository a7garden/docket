import { Empty, SectionTitle } from "@/components/bits";
import { Markdown } from "@/components/Markdown";
import { RunEvents } from "@/components/RunLog";
import { clock, cost } from "@/lib/format";
import type { Issue, PlanStep } from "@/lib/types";
import { effortLabel } from "../settings/RunPicker";
import { type Answers, Questions } from "./Questions";

/** projectPath 는 계획에 건 저장소 그림을 풀 기준이다. 첨부 · 결과 화면은 이슈 폴더 기준이다. */
export function PlanTab({ issue, projectPath, answers, onAnswers }: { issue: Issue; projectPath: string; answers: Answers; onAnswers: (a: Answers) => void }) {
	const plan = issue.plan;
	const planning = issue.run?.kind === "plan";
	const run = plan ? issue.runs.find((r) => r.id === plan.runId) : undefined;
	const steps = plan?.steps ?? [];

	if (!plan) {
		if (planning && issue.run) {
			return (
				<div className="flex flex-col gap-3">
					<p className="text-[13px] text-muted-foreground">{issue.run.phase === "queued" ? "앞선 작업이 끝나면 시작합니다." : "Claude 가 코드를 읽고 있습니다."}</p>
					<RunEvents projectId={issue.projectId} target="issue" targetId={issue.id} runId={issue.run.runId} live />
				</div>
			);
		}
		return <Empty>아직 계획이 없습니다</Empty>;
	}

	return (
		<article className="flex flex-col gap-6">
			{planning && (
				<div className="rounded-md border border-border-strong bg-secondary px-3.5 py-2.5 text-[13px]">다시 계획하는 중입니다. 아래는 지난 계획입니다.</div>
			)}

			{/* Claude 가 메모를 어떻게 이해했는지가 제목과 요약에 드러난다. 창 제목(사용자 메모)과 겨루지 않게 한 단 낮춘다. */}
			<header className="flex flex-col gap-1.5">
				<h3 className="text-[15px] leading-snug font-semibold tracking-[-0.01em] break-keep">{plan.title}</h3>
				{plan.summary && <p className="text-[14px] leading-relaxed break-keep text-muted-foreground selectable">{plan.summary}</p>}
				<div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-subtle tabular">
					{steps.length > 0 && <span>단계 {steps.length}</span>}
					{plan.files.length > 0 && <span>파일 {plan.files.length}</span>}
					{plan.risks.length > 0 && <span>주의 {plan.risks.length}</span>}
					{plan.questions.length > 0 && <span className="text-brand-text">질문 {plan.questions.length}</span>}
				</div>
			</header>

			{/* 질문은 사용자가 답해야 넘어가는 칸이라 계획 본문보다 앞에 둔다. 답하면서 위아래로 오가지 않게 한다. */}
			{plan.questions.length > 0 && !planning && <Questions questions={plan.questions} answers={answers} onChange={onAnswers} />}

			{steps.length > 0 && (
				<section className="flex flex-col gap-2">
					<SectionTitle>순서</SectionTitle>
					<ol className="flex flex-col">
						{steps.map((st, i) => (
							<Step key={i} n={i + 1} step={st} last={i === steps.length - 1} base={issue.dir} root={projectPath} />
						))}
					</ol>
				</section>
			)}

			{/* steps 가 생기기 전 계획은 plan 에 순서까지 다 들어 있다. 그때는 소제목 없이 본문으로 보인다. */}
			{plan.plan.trim() &&
				(steps.length > 0 ? (
					<section className="flex flex-col gap-2">
						<SectionTitle>배경 · 가정</SectionTitle>
						<Markdown text={plan.plan} base={issue.dir} root={projectPath} className="text-[13.5px]" />
					</section>
				) : (
					<Markdown text={plan.plan} base={issue.dir} root={projectPath} className="text-[14px]" />
				))}

			{plan.files.length > 0 && (
				<section className="flex flex-col gap-2">
					<SectionTitle>바꿀 파일</SectionTitle>
					{/* 경로 칸은 가장 긴 경로에 맞춘다. 고정 폭이면 짧은 경로와 설명 사이가 크게 벌어진다. */}
					<div className="surface grid grid-cols-[fit-content(45%)_1fr] overflow-hidden rounded-lg text-[13px]">
						{plan.files.map((f, i) => (
							<div key={i} className="contents">
								<span className={`mono truncate px-3 py-2 text-[12.5px] ${i ? "border-t border-border" : ""}`} title={f.path}>
									{f.path}
								</span>
								<span className={`min-w-0 py-2 pr-3 break-keep text-muted-foreground selectable ${i ? "border-t border-border" : ""}`}>{f.change}</span>
							</div>
						))}
					</div>
				</section>
			)}

			{plan.risks.length > 0 && (
				<section className="flex flex-col gap-2">
					<SectionTitle>주의할 점</SectionTitle>
					<ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px] leading-relaxed break-keep text-muted-foreground selectable">
						{plan.risks.map((r, i) => (
							<li key={i}>{r}</li>
						))}
					</ul>
				</section>
			)}

			<footer className="text-[12px] text-subtle">
				{[`${clock(plan.createdAt)} 에 세운 계획`, run?.model, run?.effort && `effort ${effortLabel(run.effort)}`, cost(run?.costUsd ?? 0)].filter(Boolean).join(" · ")}
			</footer>
		</article>
	);
}

/** 단계 번호를 세로 줄로 이어 순서가 한눈에 읽히게 한다. 마지막 단계는 줄을 끊는다. */
function Step({ n, step, last, base, root }: { n: number; step: PlanStep; last: boolean; base: string; root: string }) {
	return (
		<li className="relative flex gap-3 pb-4 last:pb-0">
			{!last && <span aria-hidden className="absolute top-6 bottom-0 left-[11px] w-px bg-border" />}
			<span className="z-10 flex size-[23px] shrink-0 items-center justify-center rounded-full border border-border-strong bg-card text-[12px] font-semibold tabular">{n}</span>
			<div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
				<div className="text-[14px] leading-snug font-semibold break-keep selectable">{step.title}</div>
				{step.detail.trim() && <Markdown text={step.detail} base={base} root={root} className="text-[13.5px] text-muted-foreground" />}
				{step.files.length > 0 && (
					<div className="mt-0.5 flex flex-wrap gap-1">
						{step.files.map((f) => (
							<span key={f} className="mono max-w-full truncate rounded border border-border bg-secondary px-1.5 py-px text-[11.5px] text-muted-foreground" title={f}>
								{f}
							</span>
						))}
					</div>
				)}
			</div>
		</li>
	);
}
