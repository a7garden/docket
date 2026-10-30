import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, ArrowDownUp, CalendarDays, Check, Eye, EyeOff, Search, Trash2, X } from "lucide-react";
import type { ActionList } from "@/components/ActionMenu";
import { Empty, RunDot } from "@/components/bits";
import { SelectionBar } from "@/components/SelectionBar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useKey } from "@/lib/keys";
import { useIssues, useSettings } from "@/lib/queries";
import { needsDecision, STAGES, stageOf, type Stage } from "@/lib/status";
import { useUi } from "@/lib/store";
import type { Issue, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useBoardFocus, useBoardKeys, usePublishBoardOrder } from "./boardFocus";
import { Composer } from "./Composer";
import { IssueCard, type Hit } from "./IssueCard";
import { BulkDeleteConfirm, deletable, dropMany, droppable, useBoardSelection } from "./Selection";

/* ---------- 정렬 ---------- */

const SORTS = [
	// 결정할 차례인 이슈를 위로, 나머지는 최근에 움직인 순서로 둔다.
	{
		id: "decide",
		label: "결정할 것 먼저",
		cmp: (a: Issue, b: Issue) =>
			Number(needsDecision(b)) - Number(needsDecision(a)) || Number(!!b.run) - Number(!!a.run) || b.updatedAt - a.updatedAt,
	},
	{ id: "recent", label: "최근 움직인 순", cmp: (a: Issue, b: Issue) => b.updatedAt - a.updatedAt },
	{ id: "number", label: "번호 큰 순", cmp: (a: Issue, b: Issue) => b.number - a.number },
] as const;

type SortId = (typeof SORTS)[number]["id"];

/* ---------- 걸러 보기 ---------- */

// 단계는 열이 이미 나눈다. 칩은 단계를 가로지르는 상태로 거른다 — 열마다 흩어진 「내가 볼 것」을 한눈에 모은다.
// 표시 색은 보드의 뜻을 그대로 따른다: 호박색은 결정할 것, 빨강은 실패, 실행 중은 무채색 움직이는 점.
const FILTERS = [
	{ id: "all", label: "전체", test: () => true, mark: null },
	{ id: "decide", label: "내 차례", test: needsDecision, mark: <span aria-hidden className="size-1.5 rounded-full bg-brand" /> },
	{ id: "running", label: "실행 중", test: (i: Issue) => !!i.run, mark: <RunDot /> },
	{ id: "error", label: "실패", test: (i: Issue) => !!i.error && !i.run, mark: <span aria-hidden className="size-1.5 rounded-full bg-danger" /> },
	{ id: "changed", label: "코드 바뀜", test: (i: Issue) => i.changes.length > 0, mark: null },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

/* ---------- 기간 ---------- */

const RANGES = [
	{ id: "all", label: "전체 기간", days: 0 },
	{ id: "today", label: "오늘", days: 1 },
	{ id: "7d", label: "최근 7일", days: 7 },
	{ id: "30d", label: "최근 30일", days: 30 },
	{ id: "custom", label: "직접 고르기", days: 0 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

// 만든 날로 보면 「그 주에 들어온 메모」, 움직인 날로 보면 「그 주에 손댄 메모」다. 완료한 날은 완료가 마지막 움직임이라 움직인 날로 잡힌다.
const BASES = [
	{ id: "updated", label: "움직인 날" },
	{ id: "created", label: "만든 날" },
] as const;

type BasisId = (typeof BASES)[number]["id"];

interface View {
	query: string;
	filter: FilterId;
	sort: SortId;
	showDropped: boolean;
	range: RangeId;
	basis: BasisId;
	/** 직접 고른 기간. yyyy-mm-dd, 비우면 그쪽 끝이 열려 있다. */
	from: string;
	to: string;
}

const DEFAULT_VIEW: View = { query: "", filter: "all", sort: "decide", showDropped: false, range: "all", basis: "updated", from: "", to: "" };

// 프로젝트마다 거른 조건을 기억한다. 산출물 화면에 다녀오면 보드가 다시 그려지는데 그때 풀리면 다시 걸러야 한다.
// 앱을 다시 켜면 풀린다. 켜자마자 걸러진 보드를 보면 메모가 사라진 줄 안다.
const remembered = new Map<string, View>();

// 완료 숨기기는 거르기가 아니라 보드를 보는 취향이라 앱을 다시 켜도 남긴다. 숨긴 동안에도 열 머리에 몇 건인지 보인다.
const HIDE_DONE_KEY = (pid: string) => `docket-hide-done:${pid}`;

function loadHideDone(pid: string) {
	try {
		return localStorage.getItem(HIDE_DONE_KEY(pid)) === "1";
	} catch {
		return false;
	}
}

function saveHideDone(pid: string, on: boolean) {
	try {
		if (on) localStorage.setItem(HIDE_DONE_KEY(pid), "1");
		else localStorage.removeItem(HIDE_DONE_KEY(pid));
	} catch {
		// 저장소가 막혀 있으면 이번 실행 동안만 숨긴다.
	}
}

/** 기간을 [시작, 끝) 밀리초로 바꾼다. 끝 날짜는 그날 하루를 다 넣는다. */
function rangeBounds(v: View, now = Date.now()): [number, number] | null {
	if (v.range === "all") return null;
	if (v.range === "custom") {
		const day = (s: string) => (s ? new Date(`${s}T00:00:00`).getTime() : NaN);
		const from = day(v.from);
		const to = day(v.to);
		if (Number.isNaN(from) && Number.isNaN(to)) return null;
		return [Number.isNaN(from) ? 0 : from, Number.isNaN(to) ? Infinity : to + 86_400_000];
	}
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	start.setDate(start.getDate() - (RANGES.find((r) => r.id === v.range)!.days - 1));
	return [start.getTime(), Infinity];
}

function rangeLabel(v: View) {
	if (v.range !== "custom") return RANGES.find((r) => r.id === v.range)!.label;
	const short = (s: string) => s.slice(5).replace("-", ".");
	if (!v.from && !v.to) return "기간";
	return `${v.from ? short(v.from) : ""} ~ ${v.to ? short(v.to) : ""}`.trim();
}

function words(q: string) {
	return q.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * 낱말을 띄어 쓰면 모두 들어 있어야 한다. #12 · 12 는 번호로도 맞는다.
 * 카드 제목에 안 보이는 곳에서 찾았으면 그 자리를 알려 준다. 안 그러면 왜 걸렸는지 몰라 카드를 열어 봐야 한다.
 */
function search(i: Issue, ws: string[]): Hit | null {
	if (ws.length === 0) return {};
	const fields: [string, string][] = [
		["메모", i.note],
		["계획", [i.plan?.title, i.plan?.summary].filter(Boolean).join(" · ")],
		["결과", i.result?.summary ?? ""],
		["바뀐 파일", [...new Set([...i.changes.map((c) => c.rel), ...(i.plan?.files.map((f) => f.path) ?? [])])].join("  ")],
	];
	const title = i.title.toLowerCase();
	let hit: Hit = {};
	for (const w of ws) {
		const n = w.replace(/^#/, "");
		if (/^\d+$/.test(n) && String(i.number) === n) continue;
		if (title.includes(w)) continue;
		const f = fields.find(([, text]) => text.toLowerCase().includes(w));
		if (!f) return null;
		if (!hit.where) hit = { where: f[0], snippet: around(f[1], w) };
	}
	return hit;
}

/** 찾은 낱말 앞뒤를 조금 잘라 한 줄로 보인다. */
function around(text: string, w: string) {
	const one = text.replace(/\s+/g, " ");
	const at = one.toLowerCase().indexOf(w);
	const from = Math.max(0, at - 24);
	return (from > 0 ? "…" : "") + one.slice(from, at + w.length + 48);
}

export function Board({ project }: { project: Project }) {
	const { data: issues = [], isLoading } = useIssues(project.id);
	const { data: settings } = useSettings();
	const [view, setViewState] = useState<View>(() => remembered.get(project.id) ?? DEFAULT_VIEW);
	useEffect(() => setViewState(remembered.get(project.id) ?? DEFAULT_VIEW), [project.id]);
	const set = (patch: Partial<View>) =>
		setViewState((v) => {
			const next = { ...v, ...patch };
			remembered.set(project.id, next);
			return next;
		});
	const delay = settings?.autoPlanDelaySec ?? 60;
	const [hideDone, setHideDoneState] = useState(() => loadHideDone(project.id));
	useEffect(() => setHideDoneState(loadHideDone(project.id)), [project.id]);
	const setHideDone = (on: boolean) => {
		saveHideDone(project.id, on);
		setHideDoneState(on);
	};

	const ws = useMemo(() => words(view.query), [view.query]);
	// 찾는 중에는 보류한 것도 함께 찾는다. 찾던 메모가 보류돼 있어 안 보이면 없는 줄 안다.
	const withDropped = view.showDropped || ws.length > 0;
	const bounds = useMemo(() => rangeBounds(view), [view]);
	const filtering = view.filter !== "all" || ws.length > 0 || !!bounds;
	const stages = useMemo(() => (hideDone ? STAGES.filter((s) => s.id !== "done") : STAGES), [hideDone]);

	const hits = useMemo(() => {
		const m = new Map<string, Hit>();
		for (const i of issues) {
			if (i.status === "dropped" && !withDropped) continue;
			if (bounds) {
				const at = view.basis === "created" ? i.createdAt : i.updatedAt;
				if (at < bounds[0] || at >= bounds[1]) continue;
			}
			const h = search(i, ws);
			if (h) m.set(i.id, h);
		}
		return m;
	}, [issues, ws, withDropped, bounds, view.basis]);

	const counts = useMemo(() => {
		const found = issues.filter((i) => hits.has(i.id));
		return Object.fromEntries(FILTERS.map((f) => [f.id, found.filter(f.test).length])) as Record<FilterId, number>;
	}, [issues, hits]);

	const groups = useMemo(() => {
		const test = FILTERS.find((f) => f.id === view.filter)!.test;
		const cmp = SORTS.find((s) => s.id === view.sort)!.cmp;
		const g: Record<Stage | "dropped", Issue[]> = { memo: [], plan: [], build: [], done: [], dropped: [] };
		for (const i of issues) if (hits.has(i.id) && test(i)) g[stageOf(i)].push(i);
		for (const k of Object.keys(g) as (Stage | "dropped")[]) g[k].sort(cmp);
		return g;
	}, [issues, hits, view.filter, view.sort]);

	const totals = useMemo(() => {
		const t: Record<Stage | "dropped", number> = { memo: 0, plan: 0, build: 0, done: 0, dropped: 0 };
		for (const i of issues) t[stageOf(i)]++;
		return t;
	}, [issues]);
	// 앞선 메모 id → 후속 메모 수. 연결은 후속 메모 쪽에만 있어 한 번 거꾸로 세어 카드에 넘긴다.
	const followCounts = useMemo(() => {
		const m = new Map<string, number>();
		for (const i of issues) if (i.follows) m.set(i.follows.id, (m.get(i.follows.id) ?? 0) + 1);
		return m;
	}, [issues]);

	// 열마다 그릴 카드. 메모 열에는 보류한 것을 뒤에 붙인다. 방향키 이동도 이 순서를 그대로 따른다.
	const columns = useMemo(
		() => stages.map((s) => (s.id === "memo" && withDropped ? [...groups.memo, ...groups.dropped] : groups[s.id])),
		[stages, groups, withDropped],
	);
	const ids = useMemo(() => columns.map((c) => c.map((i) => i.id)), [columns]);
	const { active, focusFirst, gridProps } = useBoardFocus(ids);
	usePublishBoardOrder(project.id, ids);
	useBoardKeys();

	// 여러 개 고르기. Shift 범위도 화면에 그린 순서(열 왼쪽부터, 열 안은 위부터)로 자른다.
	const order = useMemo(() => columns.flat(), [columns]);
	const sel = useBoardSelection(order);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const sheetOpen = useUi((s) => !!s.issueId);
	const canDrop = sel.issues.some(droppable);
	const canDelete = sel.issues.some(deletable);
	const drop = () => void dropMany(sel.issues).then(sel.clear);
	const bulk: ActionList = [
		{ label: `고른 ${sel.count}개 보류`, icon: <Archive />, disabled: !canDrop, onSelect: drop },
		{ label: `고른 ${sel.count}개 지우기`, icon: <Trash2 />, destructive: true, disabled: !canDelete, onSelect: () => setConfirmDelete(true) },
	];
	useKey({
		id: "board.selectAll",
		combo: "Mod+A",
		code: "KeyA",
		label: "카드 모두 고르기",
		group: "보드",
		inInput: "skip",
		enabled: !sheetOpen && order.length > 0,
		run: () => sel.all(),
	});
	useKey({
		id: "board.clearSelection",
		combo: "Escape",
		label: "고른 카드 풀기",
		group: "보드",
		inInput: "skip",
		enabled: !sheetOpen && sel.count > 0,
		run: () => sel.clear(),
	});

	const shown = stages.reduce((n, s) => n + groups[s.id].length, 0) + (withDropped ? groups.dropped.length : 0);
	const all = issues.length - (withDropped ? 0 : totals.dropped) - (hideDone ? totals.done : 0);
	const reset = () => set({ query: "", filter: "all", range: "all", from: "", to: "" });

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4">
			<Composer key={project.id} project={project} />
			{issues.length > 0 && (
				<FilterBar
					view={view}
					onChange={set}
					counts={counts}
					summary={filtering ? `${all}개 중 ${shown}개` : null}
					onReset={reset}
					hideDone={hideDone}
					doneCount={hideDone ? totals.done : 0}
					onHideDone={setHideDone}
					onDown={focusFirst}
				/>
			)}
			{sel.count > 0 && (
				<SelectionBar count={sel.count} total={order.length} onAll={sel.all} onClear={sel.clear}>
					<Button size="xs" variant="ghost" disabled={!canDrop} onClick={drop}>
						<Archive />
						보류
					</Button>
					<Button size="xs" variant="destructive" disabled={!canDelete} onClick={() => setConfirmDelete(true)}>
						<Trash2 />
						지우기
					</Button>
				</SelectionBar>
			)}
			{filtering && shown === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 pb-16 text-center">
					<p className="text-[14px] font-medium">맞는 메모가 없습니다</p>
					<p className="max-w-80 text-[13px] leading-relaxed break-keep text-subtle">
						{ws.length > 0
							? `제목 · 메모 · 계획 · 결과 · 바뀐 파일 어디에도 「${view.query.trim()}」 이 없습니다.`
							: bounds
								? `${rangeLabel(view)} 동안 ${view.basis === "created" ? "만든" : "움직인"} 메모가 없습니다.`
								: "이 상태의 메모가 지금은 없습니다."}
					</p>
					<Button size="sm" variant="outline" onClick={reset}>
						모두 보기
					</Button>
				</div>
			) : (
				<div {...gridProps} className={cn("grid min-h-0 flex-1 gap-3", hideDone ? "grid-cols-3" : "grid-cols-4")}>
					{stages.map((s, n) => {
						const memoCol = s.id === "memo";
						const items = columns[n];
						return (
							<Column
								key={s.id}
								label={s.label}
								count={items.length}
								total={filtering ? totals[s.id] + (memoCol && withDropped ? totals.dropped : 0) : undefined}
								extra={
									memoCol &&
									totals.dropped > 0 &&
									ws.length === 0 && (
										<Button size="xs" variant="ghost" className="ml-auto text-subtle" onClick={() => set({ showDropped: !view.showDropped })}>
											{view.showDropped ? "보류 숨기기" : `보류 ${totals.dropped}`}
										</Button>
									)
								}
							>
								{items.map((i) => (
									<IssueCard
										key={i.id}
										issue={i}
										delaySec={delay}
										words={ws}
										hit={hits.get(i.id)}
										followCount={followCounts.get(i.id) ?? 0}
										tabbable={i.id === active}
										selected={sel.has(i.id)}
										onPick={(e) => sel.toggle(i.id, e)}
										onOpen={sel.count > 0 ? sel.clear : undefined}
										// 하나만 골랐으면 그 카드의 메뉴에 이미 보류 · 지우기가 있다.
										bulk={sel.count > 1 && sel.has(i.id) ? bulk : undefined}
									/>
								))}
								{filtering && items.length === 0 && <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-[12.5px] text-subtle">없음</div>}
								{memoCol && !isLoading && issues.length === 0 && (
									<Empty className="px-3 leading-relaxed break-keep">
										메모를 붙이면 Claude 가 코드를 읽고 계획을 세웁니다. 계획을 승인하면 구현까지 합니다.
									</Empty>
								)}
							</Column>
						);
					})}
				</div>
			)}
			{/* 확인 창은 카드 밖에 둔다. 카드 안에 두면 창의 단추를 누른 것이 카드의 onClick 까지 올라간다. */}
			<BulkDeleteConfirm issues={sel.issues} open={confirmDelete} onOpenChange={setConfirmDelete} onDone={sel.clear} />
		</div>
	);
}

function FilterBar({
	view,
	onChange,
	counts,
	summary,
	onReset,
	hideDone,
	doneCount,
	onHideDone,
	onDown,
}: {
	view: View;
	onChange: (patch: Partial<View>) => void;
	counts: Record<FilterId, number>;
	summary: string | null;
	onReset: () => void;
	hideDone: boolean;
	doneCount: number;
	onHideDone: (on: boolean) => void;
	/** 검색칸에서 ↓. 카드가 없으면 false. */
	onDown: () => boolean;
}) {
	const input = useRef<HTMLInputElement>(null);
	useKey({
		id: "board.search",
		combo: "Mod+F",
		label: "메모 찾기",
		group: "보드",
		command: true,
		run: () => {
			input.current?.focus();
			input.current?.select();
		},
	});
	const sort = SORTS.find((s) => s.id === view.sort)!;

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
			<label className="flex h-8 w-72 items-center gap-2 rounded-lg border border-input bg-card px-2.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 hover:border-border-strong">
				<Search className="size-3.5 shrink-0 text-subtle" />
				<input
					ref={input}
					value={view.query}
					onChange={(e) => onChange({ query: e.target.value })}
					onKeyDown={(e) => {
						// 찾은 뒤 ↓ 로 바로 첫 카드에 간다. 마우스로 옮기지 않고 걸러 보고 열 수 있다.
						if (e.key === "ArrowDown" && !e.nativeEvent.isComposing && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
							if (onDown()) e.preventDefault();
							return;
						}
						// 처음 누르면 지우고, 빈 칸에서 한 번 더 누르면 보드로 초점을 돌려준다.
						if (e.key !== "Escape") return;
						if (view.query) onChange({ query: "" });
						else e.currentTarget.blur();
					}}
					placeholder="#번호 · 낱말 · 파일 이름으로 찾기"
					aria-label="메모 찾기"
					className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-subtle"
				/>
				{view.query ? (
					<button type="button" aria-label="찾는 말 지우기" className="rounded-sm text-subtle outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onChange({ query: "" })}>
						<X className="size-3.5" />
					</button>
				) : (
					<Kbd>Ctrl F</Kbd>
				)}
			</label>

			<div className="inline-flex rounded-lg bg-secondary p-0.5" role="radiogroup" aria-label="상태로 거르기">
				{FILTERS.map((f) => {
					const on = view.filter === f.id;
					const none = counts[f.id] === 0 && !on;
					return (
						<button
							key={f.id}
							type="button"
							role="radio"
							aria-checked={on}
							onClick={() => onChange({ filter: f.id })}
							className={cn(
								"flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
								on && "bg-card text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]",
								none && "text-subtle/70",
							)}
						>
							{f.mark && counts[f.id] > 0 && f.mark}
							{f.label}
							<span className={cn("tabular text-[11.5px] text-subtle", f.id === "decide" && counts.decide > 0 && "text-brand-text", f.id === "error" && counts.error > 0 && "text-danger")}>
								{counts[f.id]}
							</span>
						</button>
					);
				})}
			</div>

			<div className="ml-auto flex items-center gap-1">
				{summary && (
					<>
						<span className="tabular text-[12.5px] text-subtle">{summary}</span>
						<Button size="xs" variant="ghost" onClick={onReset}>
							모두 보기
						</Button>
					</>
				)}
				<RangePicker view={view} onChange={onChange} />
				<Button
					size="xs"
					variant="ghost"
					aria-pressed={hideDone}
					className={cn("text-muted-foreground", hideDone && "text-foreground")}
					title={hideDone ? "완료 열을 다시 보입니다" : "완료 열을 숨깁니다. 앱을 다시 켜도 남습니다"}
					onClick={() => onHideDone(!hideDone)}
				>
					{hideDone ? <EyeOff /> : <Eye />}
					{hideDone ? (
						<>
							완료 숨김<span className="tabular text-[11.5px] text-subtle">{doneCount}</span>
						</>
					) : (
						"완료 숨기기"
					)}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button size="xs" variant="ghost" className="text-muted-foreground">
							<ArrowDownUp />
							{sort.label}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="pop w-44">
						{SORTS.map((s) => (
							<DropdownMenuItem key={s.id} onSelect={() => onChange({ sort: s.id })}>
								<Check className={cn("size-3.5", s.id !== view.sort && "invisible")} />
								{s.label}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

/** 기간으로 거르기. 미리 정한 기간을 누르면 바로 걸리고, 직접 고를 때는 날짜 칸을 연다. */
function RangePicker({ view, onChange }: { view: View; onChange: (patch: Partial<View>) => void }) {
	const on = view.range !== "all";
	const pill = (active: boolean) =>
		cn(
			"flex h-7 items-center rounded-md px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
			active && "bg-card text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]",
		);
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button size="xs" variant="ghost" className={cn("text-muted-foreground", on && "text-foreground")}>
					<CalendarDays />
					{on ? `${rangeLabel(view)} · ${BASES.find((b) => b.id === view.basis)!.label}` : "기간"}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="pop w-72 gap-3">
				<div className="inline-flex self-start rounded-lg bg-secondary p-0.5" role="radiogroup" aria-label="어느 날로 거를지">
					{BASES.map((b) => (
						<button key={b.id} type="button" role="radio" aria-checked={view.basis === b.id} className={pill(view.basis === b.id)} onClick={() => onChange({ basis: b.id })}>
							{b.label}
						</button>
					))}
				</div>
				<div className="flex flex-col">
					{RANGES.map((r) => (
						<button
							key={r.id}
							type="button"
							onClick={() => onChange({ range: r.id })}
							className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
						>
							<Check className={cn("size-3.5", r.id !== view.range && "invisible")} />
							{r.label}
						</button>
					))}
				</div>
				{view.range === "custom" && (
					<div className="flex items-center gap-2 text-[12.5px]">
						<input
							type="date"
							aria-label="시작 날짜"
							value={view.from}
							max={view.to || undefined}
							onChange={(e) => onChange({ from: e.target.value })}
							className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-[12.5px] outline-none focus:border-ring"
						/>
						<span className="text-subtle">~</span>
						<input
							type="date"
							aria-label="끝 날짜"
							value={view.to}
							min={view.from || undefined}
							onChange={(e) => onChange({ to: e.target.value })}
							className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-[12.5px] outline-none focus:border-ring"
						/>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

function Column({ label, count, total, extra, children }: { label: string; count: number; total?: number; extra?: ReactNode; children: ReactNode }) {
	return (
		<section className="flex min-h-0 flex-col">
			<header className="flex h-7 items-center gap-2 px-1 pb-1">
				<h3 className="text-[13px] font-semibold">{label}</h3>
				<span className="tabular text-[12px] text-subtle">
					{total === undefined ? (
						count
					) : (
						<>
							<span className="text-foreground">{count}</span>/{total}
						</>
					)}
				</span>
				{extra}
			</header>
			<div className="-mr-1.5 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pt-0.5 pr-1.5 pb-3">{children}</div>
		</section>
	);
}
