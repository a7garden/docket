/**
 * 산출물 상세의 「자동 관리」 탭과 목록이 함께 쓰는 상태 판단.
 *
 * 목차
 * 1. stateOf · needsCare · triggerText — 산출물 하나의 상태(작성 중 · 실패 · 검토 필요 · 반영 대기 · 최신 · 수동)와 트리거 한 줄
 * 2. AutoTab — 트리거(코드 · DB 자료) 고르기 · 반영 대기와 「밀린 변경 반영」 · 자동 관리 기록
 */
import { type ReactNode, useEffect, useState } from "react";
import { Code2, Database, GitPullRequestArrow, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Chip, SectionTitle } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { api, errorText } from "@/lib/api";
import { relTime } from "@/lib/format";
import { useDbSources } from "@/lib/queries";
import { useUi } from "@/lib/store";
import { type AutoEntry, type Deliverable, isAuto, type PendingIssue, type Project, TRIGGER_CODE, TRIGGER_DB } from "@/lib/types";
import type { Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { DbSourcesDialog } from "./DbSources";

/** 한 번에 반영하는 변경 수의 상한. 백엔드 kb::CATCH_UP_MAX 와 같다. */
const CATCH_UP_MAX = 10;

export interface DState {
	key: "writing" | "failed" | "review" | "pending" | "fresh" | "manual" | "empty";
	label: string;
	tone: Tone;
	/** 목록 줄 아래에 보일 까닭. 비어 있으면 평소 설명을 보인다 */
	why: string;
}

/** 반영 대기 한 줄의 짧은 이름. 이슈는 #번호, DB 는 자료 이름이다. */
const pendingName = (p: PendingIssue) => (p.kind === "db" ? `DB ${p.title}` : `#${p.number}`);

/**
 * 산출물의 상태 하나. 앞의 것이 이긴다 — 작성 중 > 실패 > 검토 필요 > 반영 대기 > 최신.
 * 트리거가 없는 산출물은 반영 대기를 세지 않으므로 「수동」이다. 그래도 실패 · 검토 필요는 보인다.
 */
export function stateOf(d: Deliverable): DState {
	if (d.job) return { key: "writing", label: d.job.phase === "queued" ? "대기 중" : "작성 중", tone: "run", why: "" };
	if (d.error) return { key: "failed", label: "실패", tone: "danger", why: "" };
	const review = [...d.versions].reverse().find((v) => v.review);
	if (review) return { key: "review", label: "검토 필요", tone: "brand", why: `v${review.n} · ${review.note || "자동으로 쓴 판"} · ${relTime(review.addedAt)}` };
	if (d.pending.length) return { key: "pending", label: `반영 대기 ${d.pending.length}`, tone: "brand", why: `${d.pending.map(pendingName).join(" · ")} 아직 반영 안 됨` };
	if (!d.versions.length) return { key: "empty", label: "판 없음", tone: "muted", why: "" };
	if (!isAuto(d)) return { key: "manual", label: "수동", tone: "muted", why: "" };
	return { key: "fresh", label: "최신", tone: "ok", why: "" };
}

/** 「손볼 것」 거르기에 걸리는가. 작성 중인 것은 기다리면 되므로 넣지 않는다. */
export function needsCare(d: Deliverable) {
	const k = stateOf(d).key;
	return k === "failed" || k === "review" || k === "pending";
}

/** 트리거를 한 줄로 — 「코드 · DB 운영 DB 구조」. 없으면 빈 글이다. 지운 DB 자료는 건너뛴다. */
export function triggerText(d: Pick<Deliverable, "triggers">, project: Project) {
	return (d.triggers ?? [])
		.map((t) => {
			if (t === TRIGGER_CODE) return "코드";
			const src = project.dbSources?.find((s) => `${TRIGGER_DB}${s.id}` === t);
			return src ? `DB ${src.name}` : "";
		})
		.filter(Boolean)
		.join(" · ");
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
 * 이 산출물이 코드 · DB 변경을 언제 · 어떻게 따라왔는지를 모은다. 「만드는 법」은 어떻게 쓰는지만 다룬다.
 * 반영 대기는 트리거를 고른 산출물만 센다 — 수동 산출물은 손으로 관리하는 문서라 숫자를 쌓지 않는다.
 */
export function AutoTab({ project, d }: { project: Project; d: Deliverable }) {
	const openIssue = useUi((s) => s.openIssue);
	const { data: dbViews = [] } = useDbSources(project.id);
	const [dbOpen, setDbOpen] = useState(false);
	// 처음엔 반영 대기를 모두 고른다. 새로 생긴 변경도 고른 채로 보이게 대기 목록이 바뀌면 다시 맞춘다.
	const ids = d.pending.map((p) => p.id).join(",");
	const [picked, setPicked] = useState<Set<string>>(() => new Set(d.pending.map((p) => p.id)));
	useEffect(() => setPicked(new Set(ids ? ids.split(",") : [])), [ids]);
	const [busy, setBusy] = useState(false);

	const sources = project.dbSources ?? [];
	const triggers = d.triggers ?? [];
	// 지운 DB 자료를 가리키는 트리거. 화면에서 뺄 수 있게 따로 보인다.
	const dangling = triggers.filter((t) => t.startsWith(TRIGGER_DB) && !sources.some((s) => `${TRIGGER_DB}${s.id}` === t));
	const setTrigger = (t: string, on: boolean) => {
		const next = on ? [...triggers.filter((x) => x !== t), t] : triggers.filter((x) => x !== t);
		api.deliverableUpdate(project.id, d.id, { title: d.title, note: d.note, guide: d.guide, naming: d.naming, subdir: d.subdir, triggers: next }).catch((e) => toast.error(errorText(e)));
	};
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
	const sourceName = (tag: string) => sources.find((s) => `${TRIGGER_DB}${s.id}` === tag)?.name ?? "지운 DB 자료";

	return (
		<div className="flex flex-col gap-7">
			<section className="flex flex-col gap-2">
				<div className="flex min-h-7 items-center gap-2">
					<SectionTitle>무엇이 바뀌면 새 판을 쓸까</SectionTitle>
					<div className="flex-1" />
					<Button variant="ghost" size="sm" onClick={() => setDbOpen(true)}>
						<Database />
						DB 자료
					</Button>
				</div>
				<ul className="surface divide-y divide-border overflow-hidden rounded-md">
					<TriggerRow on={triggers.includes(TRIGGER_CODE)} onChange={(on) => setTrigger(TRIGGER_CODE, on)} icon={<Code2 />} label="코드" hint="이슈를 완료할 때 그 코드 변경" />
					{sources.map((s) => {
						const v = dbViews.find((x) => x.id === s.id);
						const hint = v?.error ? v.error : v?.checkedAt ? `${relTime(v.checkedAt)} 받음${v.snapshots[0] ? ` · ${v.snapshots[0].rows.toLocaleString()}행` : ""}` : "아직 받지 않음";
						const tag = `${TRIGGER_DB}${s.id}`;
						return <TriggerRow key={s.id} on={triggers.includes(tag)} onChange={(on) => setTrigger(tag, on)} icon={<Database />} label={`DB · ${s.name}`} hint={hint} danger={!!v?.error} />;
					})}
					{dangling.map((t) => (
						<TriggerRow key={t} on onChange={() => setTrigger(t, false)} icon={<Database />} label="지운 DB 자료" hint="DB 자료에서 빠졌습니다. 끄면 트리거에서 뺍니다." danger />
					))}
				</ul>
				<p className="text-[12.5px] leading-relaxed break-keep text-subtle">
					고른 것이 바뀌면 이 산출물에 반영해야 하는지 Claude 가 가리고, 반영할 것이 있으면 새 판을 씁니다. 코드와 DB 가 같은 차례에 바뀌면 한 판에 함께 반영합니다. 아무것도 고르지 않으면
					수동입니다. 판이 하나는 있어야 돌고, 자동으로 쓴 판에는 「검토 필요」 표지가 붙습니다.
					{sources.length === 0 && " DB 구조를 따르게 하려면 「DB 자료」에서 조회 명령을 더하세요."}
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
				{!isAuto(d) ? (
					<p className="text-[12.5px] leading-relaxed break-keep text-subtle">트리거를 고르면 판 이후의 변경 가운데 이 산출물에 아직 반영되지 않은 것을 셉니다.</p>
				) : !d.versions.length ? (
					<p className="text-[12.5px] leading-relaxed break-keep text-subtle">판이 하나는 있어야 반영 대기를 셉니다.</p>
				) : d.pending.length === 0 ? (
					<p className="text-[13px] text-muted-foreground">반영 대기가 없습니다. 마지막 판 이후의 변경은 모두 판정을 마쳤습니다.</p>
				) : (
					<>
						<p className="text-[12.5px] leading-relaxed break-keep text-subtle">
							마지막 판 이후 생겼지만 아직 반영하지 못한 변경입니다. 트리거가 꺼져 있었거나, 판정이 실패했거나, 그때 이미 작성 중이었던 것입니다. 고른 변경을 한 번에 반영한 새 판을 씁니다.
						</p>
						<ul className="surface divide-y divide-border overflow-hidden rounded-md">
							{d.pending.map((p) => (
								<li key={p.id} className="flex h-10 items-center gap-3 px-3 text-[13px]">
									<input
										type="checkbox"
										className="size-3.5 accent-foreground"
										checked={picked.has(p.id)}
										aria-label={`${pendingName(p)} 고르기`}
										onChange={(e) =>
											setPicked((s) => {
												const next = new Set(s);
												if (e.target.checked) next.add(p.id);
												else next.delete(p.id);
												return next;
											})
										}
									/>
									{p.kind === "db" ? (
										<>
											<Database className="size-3.5 shrink-0 text-subtle" />
											<span className="min-w-0 truncate">DB · {p.title}</span>
											<span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">{p.summary}</span>
											<span className="text-[12px] text-subtle">{relTime(p.doneAt)} 받음</span>
										</>
									) : (
										<>
											<button type="button" className="mono text-[12.5px] text-subtle hover:text-foreground" onClick={() => openIssue(p.id)}>
												#{p.number}
											</button>
											<span className="min-w-0 flex-1 truncate">{p.title || "제목 없는 메모"}</span>
											<span className="text-[12px] text-subtle">{relTime(p.doneAt)} 완료</span>
										</>
									)}
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
					<span className="text-[12px] text-subtle">변경마다 판정 · 작성 결과 · 최근 50건</span>
				</div>
				{log.length === 0 ? (
					<p className="text-[13px] text-subtle">아직 기록이 없습니다.</p>
				) : (
					<ul className="surface divide-y divide-border overflow-hidden rounded-md">
						{log.map((e, i) => {
							const v = e.version ? d.versions.find((x) => x.n === e.version) : undefined;
							const meta = VERDICT[e.verdict] ?? { label: e.verdict, tone: "muted" as Tone };
							const db = e.source?.startsWith(TRIGGER_DB);
							return (
								<li key={`${e.issueId || e.source}-${e.at}-${i}`} className="flex min-h-10 items-center gap-3 px-3 py-1.5 text-[13px]">
									{db ? (
										<span className="flex w-28 shrink-0 items-center gap-1.5 truncate text-[12.5px] text-subtle" title={sourceName(e.source!)}>
											<Database className="size-3.5 shrink-0" />
											<span className="truncate">{sourceName(e.source!)}</span>
										</span>
									) : (
										<button type="button" className="mono w-10 shrink-0 text-left text-[12.5px] text-subtle hover:text-foreground" onClick={() => openIssue(e.issueId)}>
											#{e.number}
										</button>
									)}
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
			<DbSourcesDialog project={project} open={dbOpen} onOpenChange={setDbOpen} />
		</div>
	);
}

function TriggerRow({ on, onChange, icon, label, hint, danger }: { on: boolean; onChange: (on: boolean) => void; icon: ReactNode; label: string; hint: string; danger?: boolean }) {
	return (
		<li>
			<label className="flex min-h-10 cursor-pointer items-center gap-3 px-3 py-1.5 text-[13px] hover:bg-hover">
				<input type="checkbox" className="size-3.5 accent-foreground" checked={on} onChange={(e) => onChange(e.target.checked)} />
				<span className="text-subtle [&>svg]:size-3.5">{icon}</span>
				<span className="shrink-0 font-medium">{label}</span>
				<span className={cn("min-w-0 flex-1 truncate text-[12px]", danger ? "text-danger" : "text-subtle")} title={hint}>
					{hint}
				</span>
			</label>
		</li>
	);
}
