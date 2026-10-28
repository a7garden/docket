import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { Denial } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

/**
 * 막힌 호출을 프로젝트 허용 목록에 넣는다. 다음 실행부터 통과한다 — 지금 실행을 되살리지는 않는다.
 * 거부 규칙(rule)에 걸린 것은 넣지 않는다. 거부가 허용보다 앞서 넣어도 소용이 없고, 일부러 막아 둔 것이다.
 */
export function useAllow(projectId: string) {
	const qc = useQueryClient();
	return async (rules: string[]) => {
		try {
			await api.projectAllow(projectId, rules);
			await qc.invalidateQueries({ queryKey: qk.projects });
			toast(`허용 목록에 넣었습니다: ${rules.join(", ")}`, { description: "다음 실행부터 묻지 않고 통과합니다" });
		} catch (e) {
			toast.error(errorText(e));
		}
	};
}

export const DENIAL_REASON = { rule: "거부 규칙", ask: "허용 목록에 없음" } as const;

/** 실행 기록 속 한 줄. 왜 막혔는지와, 풀 수 있으면 푸는 단추. */
export function DeniedLine({ denial, projectId }: { denial: Denial; projectId?: string }) {
	const allow = useAllow(projectId ?? "");
	const [done, setDone] = useState(false);
	const rule = denial.reason === "rule";
	const Icon = rule ? ShieldX : ShieldAlert;
	return (
		<div className="flex min-h-7 items-center gap-2 text-[12.5px]">
			<Icon className={cn("size-3.5 shrink-0", rule ? "text-danger" : "text-brand-text")} />
			<span className="shrink-0 font-medium text-muted-foreground">막힘</span>
			<span className="mono min-w-0 flex-1 truncate text-[12px] text-subtle" title={denial.target}>
				{denial.target || denial.tool}
			</span>
			<span className={cn("shrink-0 text-[11.5px]", rule ? "text-danger/90" : "text-subtle")}>{DENIAL_REASON[denial.reason]}</span>
			{!rule && projectId && denial.suggest.length > 0 && (
				<Button
					size="xs"
					variant="ghost"
					disabled={done}
					title={`허용 목록에 넣을 규칙: ${denial.suggest.join(", ")}`}
					onClick={(e) => {
						e.stopPropagation();
						setDone(true);
						void allow(denial.suggest);
					}}
				>
					{done ? "넣음" : "허용"}
				</Button>
			)}
		</div>
	);
}

/** 한 실행에서 막힌 것을 모아 보인다. 같은 명령을 여러 번 시도했으면 한 번만 센다. */
export function DeniedBox({ denials, projectId, className }: { denials: Denial[]; projectId: string; className?: string }) {
	const allow = useAllow(projectId);
	const unique = denials.filter((d, i) => denials.findIndex((x) => x.target === d.target && x.reason === d.reason) === i);
	const fixable = [...new Set(unique.filter((d) => d.reason === "ask").flatMap((d) => d.suggest))];
	if (unique.length === 0) return null;
	return (
		<section className={cn("surface flex flex-col gap-1 rounded-lg px-3 py-2.5", className)}>
			<div className="flex items-center gap-2">
				<h4 className="text-[13px] font-semibold">막힌 명령 {unique.length}개</h4>
				<span className="text-[12px] text-subtle">권한이 없어 Claude 가 하지 못한 것</span>
				<div className="flex-1" />
				{fixable.length > 0 && (
					<Button size="xs" variant="outline" title={fixable.join("\n")} onClick={() => void allow(fixable)}>
						모두 허용 목록에 넣기
					</Button>
				)}
			</div>
			{unique.map((d, i) => (
				<DeniedLine key={i} denial={d} projectId={projectId} />
			))}
		</section>
	);
}
