/**
 * 산출물 상세의 「자동 관리」 탭과 목록이 함께 쓰는 상태 판단.
 *
 * 목차
 * 1. stateOf · needsCare — 산출물 하나의 상태(작성 중 · 실패 · 검토 필요 · 반영 대기 · 최신 · 수동)
 * 2. AutoTab — 자동 갱신 스위치 · 반영 대기와 「밀린 변경 반영」 · 자동 관리 기록
 */
import { useEffect, useState } from "react";
import { GitPullRequestArrow, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Chip, SectionTitle } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api, errorText } from "@/lib/api";
import { relTime } from "@/lib/format";
import { useUi } from "@/lib/store";
import type { AutoEntry, Deliverable, Project } from "@/lib/types";
import type { Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

/** 한 번에 반영하는 이슈 수의 상한. 백엔드 kb::CATCH_UP_MAX 와 같다. */
const CATCH_UP_MAX = 10;

export interface DState {
	key: "writing" | "failed" | "review" | "pending" | "fresh" | "manual" | "empty";
	label: string;
	tone: Tone;
	/** 목록 줄 아래에 보일 까닭. 비어 있으면 평소 설명을 보인다 */
	why: string;
}

/**
 * 산출물의 상태 하나. 앞의 것이 이긴다 — 작성 중 > 실패 > 검토 필요 > 반영 대기 > 최신.
 * 자동 갱신을 끈 산출물은 반영 대기를 세지 않으므로 「수동」이다. 그래도 실패 · 검토 필요는 보인다.
 */
export function stateOf(d: Deliverable): DState {
	if (d.job) return { key: "writing", label: d.job.phase === "queued" ? "대기 중" : "작성 중", tone: "run", why: "" };
	if (d.error) return { key: "failed", label: "실패", tone: "danger", why: "" };
	const review = [...d.versions].reverse().find((v) => v.review);
	if (review) return { key: "review", label: "검토 필요", tone: "brand", why: `v${review.n} · ${review.note || "자동으로 쓴 판"} · ${relTime(review.addedAt)}` };
	if (d.pending.length) return { key: "pending", label: `반영 대기 ${d.pending.length}`, tone: "brand", why: `${d.pending.map((p) => `#${p.number}`).join(" · ")} 완료 뒤 그대로` };
	if (!d.versions.length) return { key: "empty", label: "판 없음", tone: "muted", why: "" };
	if (!d.autoUpdate) return { key: "manual", label: "수동", tone: "muted", why: "" };
	return { key: "fresh", label: "최신", tone: "ok", why: "" };
}

/** 「손볼 것」 거르기에 걸리는가. 작성 중인 것은 기다리면 되므로 넣지 않는다. */
export function needsCare(d: Deliverable) {
	const k = stateOf(d).key;
	return k === "failed" || k === "review" || k === "pending";
}

const VERDICT: Record<AutoEntry["verdict"], { label: string; tone: Tone }> = {
	updated: { label: "갱신", tone: "muted" },
	catchup: { label: "밀린 변경 반영", tone: "muted" },
	skipped: { label: "고칠 것 없음", tone: "muted" },
	unrelated: { label: "관계없음", tone: "muted" },
	busy: { label: "작성 중이라 건너뜀", tone: "brand" },
	failed: { label: "실패", tone: "danger" },
	stopped: { label: "중지", tone: "brand" },
	discarded: { label: "판을 버림", tone: "brand" },
};

/**
 * 이 산출물이 코드 변경을 언제 · 어떻게 따라왔는지를 모은다. 「만드는 법」은 어떻게 쓰는지만 다룬다.
 * 반영 대기는 자동 갱신을 켠 산출물만 센다 — 끈 산출물은 손으로 관리하는 문서라 숫자를 쌓지 않는다.
 */
export function AutoTab({ project, d }: { project: Project; d: Deliverable }) {
	const openIssue = useUi((s) => s.openIssue);
	// 처음엔 반영 대기를 모두 고른다. 새로 생긴 이슈도 고른 채로 보이게 대기 목록이 바뀌면 다시 맞춘다.
	const ids = d.pending.map((p) => p.id).join(",");
	const [picked, setPicked] = useState<Set<string>>(() => new Set(d.pending.map((p) => p.id)));
	useEffect(() => setPicked(new Set(ids ? ids.split(",") : [])), [ids]);
	const [busy, setBusy] = useState(false);

	const toggle = (on: boolean) =>
		api
			.deliverableUpdate(project.id, d.id, { title: d.title, note: d.note, guide: d.guide, naming: d.naming, subdir: d.subdir, autoUpdate: on })
			.catch((e) => toast.error(errorText(e)));
	const catchUp = async () => {
		setBusy(true);
		try {
			await api.deliverableCatchUp(project.id, d.id, [...picked]);
			toast(`${picked.size}건을 반영한 새 판을 씁니다`);
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setBusy(false);
		}
	};
	const log = [...d.autoLog].reverse();
	const over = picked.size > CATCH_UP_MAX;

	return (
		<div className="flex flex-col gap-7">
			<section className="flex flex-col gap-2">
				<div className="flex min-h-7 items-center gap-2">
					<SectionTitle>코드가 바뀌면 자동 갱신</SectionTitle>
					<div className="flex-1" />
					<Switch checked={d.autoUpdate} onCheckedChange={(on) => void toggle(on)} aria-label="자동 갱신" />
				</div>
				<p className="text-[12.5px] leading-relaxed break-keep text-subtle">
					이슈를 완료하면 그 코드 변경이 이 산출물에 반영되어야 하는지 Claude 가 가리고, 반영할 것이 있으면 새 판을 씁니다. 고칠 것이 없으면 판을 만들지 않습니다.
					판이 하나는 있어야 돕니다. 자동으로 쓴 판에는 「검토 필요」 표지가 붙습니다.
				</p>
			</section>

			<section className="flex flex-col gap-2">
				<div className="flex min-h-7 items-center gap-2">
					<SectionTitle>반영 대기</SectionTitle>
					{d.pending.length > 0 && <span className="tabular text-[12px] text-subtle">{d.pending.length}</span>}
					<div className="flex-1" />
					{d.pending.length > 0 && (
						<Button size="sm" disabled={busy || !!d.job || picked.size === 0 || over} onClick={() => void catchUp()}>
							{busy ? <Loader2 className="animate-spin" /> : <GitPullRequestArrow />}
							밀린 변경 반영{picked.size > 0 && ` (${picked.size})`}
						</Button>
					)}
				</div>
				{!d.autoUpdate ? (
					<p className="text-[12.5px] leading-relaxed break-keep text-subtle">자동 갱신을 켜면 판 이후에 완료된 이슈 가운데 이 산출물에 아직 반영되지 않은 것을 셉니다.</p>
				) : !d.versions.length ? (
					<p className="text-[12.5px] leading-relaxed break-keep text-subtle">판이 하나는 있어야 반영 대기를 셉니다.</p>
				) : d.pending.length === 0 ? (
					<p className="text-[13px] text-muted-foreground">반영 대기가 없습니다. 마지막 판 이후 완료된 이슈는 모두 판정을 마쳤습니다.</p>
				) : (
					<>
						<p className="text-[12.5px] leading-relaxed break-keep text-subtle">
							마지막 판 이후 완료됐지만 아직 반영하지 못한 이슈입니다. 자동 갱신이 꺼져 있었거나, 판정이 실패했거나, 그때 이미 작성 중이었던 것입니다. 고른 이슈를 한 번에 반영한 새 판을 씁니다.
						</p>
						<ul className="surface divide-y divide-border overflow-hidden rounded-md">
							{d.pending.map((p) => (
								<li key={p.id} className="flex h-10 items-center gap-3 px-3 text-[13px]">
									<input
										type="checkbox"
										className="size-3.5 accent-foreground"
										checked={picked.has(p.id)}
										aria-label={`#${p.number} 고르기`}
										onChange={(e) =>
											setPicked((s) => {
												const next = new Set(s);
												if (e.target.checked) next.add(p.id);
												else next.delete(p.id);
												return next;
											})
										}
									/>
									<button type="button" className="mono text-[12.5px] text-subtle hover:text-foreground" onClick={() => openIssue(p.id)}>
										#{p.number}
									</button>
									<span className="min-w-0 flex-1 truncate">{p.title || "제목 없는 메모"}</span>
									<span className="text-[12px] text-subtle">{relTime(p.doneAt)} 완료</span>
								</li>
							))}
						</ul>
						{over && <p className="text-[12.5px] text-danger">한 번에 {CATCH_UP_MAX}건까지 반영합니다. 나눠서 고르세요.</p>}
					</>
				)}
			</section>

			<section className="flex flex-col gap-2">
				<div className="flex min-h-7 items-center gap-2">
					<SectionTitle>기록</SectionTitle>
					<span className="text-[12px] text-subtle">완료한 이슈마다 판정 · 작성 결과 · 최근 50건</span>
				</div>
				{log.length === 0 ? (
					<p className="text-[13px] text-subtle">아직 기록이 없습니다.</p>
				) : (
					<ul className="surface divide-y divide-border overflow-hidden rounded-md">
						{log.map((e, i) => {
							const v = e.version ? d.versions.find((x) => x.n === e.version) : undefined;
							const meta = VERDICT[e.verdict] ?? { label: e.verdict, tone: "muted" as Tone };
							return (
								<li key={`${e.issueId}-${e.at}-${i}`} className="flex min-h-10 items-center gap-3 px-3 py-1.5 text-[13px]">
									<button type="button" className="mono w-10 shrink-0 text-left text-[12.5px] text-subtle hover:text-foreground" onClick={() => openIssue(e.issueId)}>
										#{e.number}
									</button>
									<Chip tone={meta.tone}>{e.version ? `v${e.version} ${meta.label}` : meta.label}</Chip>
									{v?.review && <Chip tone="brand">검토 필요</Chip>}
									<span className={cn("min-w-0 flex-1 truncate text-[12.5px]", e.verdict === "failed" ? "text-danger" : "text-muted-foreground")} title={e.reason}>
										{e.reason}
									</span>
									<span className="shrink-0 text-[12px] text-subtle">{relTime(e.at)}</span>
								</li>
							);
						})}
					</ul>
				)}
			</section>
		</div>
	);
}
