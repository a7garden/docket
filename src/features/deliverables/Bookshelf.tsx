/**
 * 산출물 책장 보기.
 *
 * 목차
 * 1. buildShelves · cellsOf — 하위 폴더 칸을 나무로 묶는다
 * 2. Bookshelf · ShelfSection — 접고 펴는 칸
 * 3. Card — 표지 · 제목 · 판 · 상태와 우클릭 메뉴
 * 4. MoveShelfDialog — 책장 옮기기
 */
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { ContextActions } from "@/components/ActionMenu";
import { Chip, Label } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api, errorText } from "@/lib/api";
import { useDeliverables } from "@/lib/queries";
import { useUi } from "@/lib/store";
import type { Deliverable, Issue, Project } from "@/lib/types";
import { stateOf } from "./AutoTab";
import { Cover } from "./Cover";
import { useDeliverableMenu } from "./Deliverables";

export interface Shelf {
	name: string;
	path: string;
	items: Deliverable[];
	children: Shelf[];
}

const compareName = (a: string, b: string) => a.localeCompare(b, "ko", { numeric: true });
const partsOf = (subdir: string) => subdir.split(/[\\/]/).map((c) => c.trim()).filter(Boolean);

/** 칸은 이름순(숫자 인식)이고 칸 안은 들어온 순서(고친 순서)다. 분류하지 않은 산출물은 path 가 빈 맨 위 칸에 모인다. */
export function buildShelves(list: Deliverable[]): Shelf {
	const root: Shelf = { name: "", path: "", items: [], children: [] };
	for (const d of list) {
		let at = root;
		for (const name of partsOf(d.subdir)) {
			let next = at.children.find((c) => c.name === name);
			if (!next) {
				next = { name, path: at.path ? `${at.path}/${name}` : name, items: [], children: [] };
				at.children.push(next);
			}
			at = next;
		}
		at.items.push(d);
	}
	const sort = (s: Shelf) => {
		s.children.sort((a, b) => compareName(a.name, b.name));
		s.children.forEach(sort);
	};
	sort(root);
	return root;
}

function countOf(s: Shelf): number {
	return s.items.length + s.children.reduce((n, c) => n + countOf(c), 0);
}

/** 있는 칸 전부. 상위 칸까지 함께 낸다. */
export function cellsOf(list: Deliverable[]): string[] {
	const out = new Set<string>();
	for (const d of list) {
		const parts = partsOf(d.subdir);
		parts.forEach((_, i) => out.add(parts.slice(0, i + 1).join("/")));
	}
	return [...out].sort(compareName);
}

export function Bookshelf({ project, list, issues }: { project: Project; list: Deliverable[]; issues: Issue[] }) {
	const root = useMemo(() => buildShelves(list), [list]);
	return (
		<div className="flex flex-col gap-3 pb-4">
			{root.children.map((s) => (
				<ShelfSection key={s.path} project={project} shelf={s} issues={issues} />
			))}
			{root.items.length > 0 &&
				(root.children.length > 0 ? (
					<ShelfSection project={project} shelf={{ name: "미분류", path: "", items: root.items, children: [] }} issues={issues} />
				) : (
					// 칸이 하나도 없으면 「미분류」 머리는 뜻이 없다.
					<Shelves project={project} items={root.items} issues={issues} />
				))}
		</div>
	);
}

function ShelfSection({ project, shelf, issues }: { project: Project; shelf: Shelf; issues: Issue[] }) {
	const key = `${project.id}:${shelf.path}`;
	const folded = useUi((s) => !!s.shelfFolded[key]);
	const setFold = useUi((s) => s.setShelfFold);
	return (
		<section>
			<button
				type="button"
				aria-expanded={!folded}
				onClick={() => setFold(key, !folded)}
				className="flex items-center gap-1.5 rounded-md py-1 pr-2 text-[13.5px] font-semibold outline-none hover:text-foreground focus-visible:bg-hover"
			>
				{folded ? <ChevronRight className="size-4 text-subtle" /> : <ChevronDown className="size-4 text-subtle" />}
				{shelf.name}
				<span className="tabular text-[12px] font-normal text-subtle">{countOf(shelf)}</span>
			</button>
			{!folded && (
				<div className="mt-2 flex flex-col gap-3">
					{shelf.items.length > 0 && <Shelves project={project} items={shelf.items} issues={issues} />}
					{shelf.children.length > 0 && (
						<div className="ml-4 flex flex-col gap-3">
							{shelf.children.map((c) => (
								<ShelfSection key={c.path} project={project} shelf={c} issues={issues} />
							))}
						</div>
					)}
				</div>
			)}
		</section>
	);
}

/** 표지를 늘어놓은 선반 한 단. 아래 굵은 줄이 선반이다. */
function Shelves({ project, items, issues }: { project: Project; items: Deliverable[]; issues: Issue[] }) {
	return (
		<div className="grid grid-cols-[repeat(auto-fill,136px)] gap-x-5 gap-y-5 border-b-2 border-border px-1 pb-4">
			{items.map((d) => (
				<Card key={d.id} project={project} d={d} issueNumber={issues.find((i) => i.id === d.issueId)?.number} />
			))}
		</div>
	);
}

function Card({ project, d, issueNumber }: { project: Project; d: Deliverable; issueNumber?: number }) {
	const openDeliverable = useUi((s) => s.openDeliverable);
	const openIssue = useUi((s) => s.openIssue);
	const setView = useUi((s) => s.setView);
	const onOpen = () => openDeliverable(d.id);
	const { menu, dialogs } = useDeliverableMenu(project, d, issueNumber, onOpen, () => {
		setView("board");
		openIssue(d.issueId);
	});
	const last = d.versions[d.versions.length - 1];
	const state = stateOf(d);
	return (
		<>
			<ContextActions items={menu}>
				<div
					role="button"
					tabIndex={0}
					onClick={onOpen}
					onKeyDown={(e) => e.key === "Enter" && onOpen()}
					title={state.why || d.error.split("\n")[0] || d.title}
					className="group min-w-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
				>
					<div className="transition-transform duration-150 group-hover:-translate-y-0.5">
						<Cover project={project.id} d={d} />
					</div>
					<div className="mt-2 truncate text-[13px] font-medium">{d.title || "작성 중인 문서"}</div>
					<div className="mt-0.5 flex items-center justify-between gap-1.5">
						<span className="tabular shrink-0 text-[12px] text-muted-foreground">{last ? `v${last.n}` : ""}</span>
						<Chip tone={state.tone}>{state.label}</Chip>
					</div>
				</div>
			</ContextActions>
			{dialogs}
		</>
	);
}

/** 있는 칸을 고르거나 새 이름을 적는다. 파일이 어떻게 되는지를 프로젝트 설정에 맞게 미리 알린다. */
export function MoveShelfDialog({ project, d, open, onOpenChange }: { project: Project; d: Deliverable; open: boolean; onOpenChange: (o: boolean) => void }) {
	const { data: list = [] } = useDeliverables(open ? project.id : null);
	const [value, setValue] = useState(d.subdir);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (open) setValue(d.subdir);
	}, [open, d.subdir]);
	const cells = cellsOf(list);
	const hint = !project.deliverablesDir
		? "화면의 분류만 바뀝니다. 산출물 폴더를 정하지 않아 파일은 앱 데이터에 그대로 둡니다."
		: d.versions.length
			? "최신 판 파일을 이 폴더로 옮깁니다. 지난 판은 지금 자리에 남습니다. 비우면 산출물 폴더 바로 아래로 옮깁니다."
			: "다음 판부터 이 폴더에 놓입니다.";
	const move = async () => {
		setBusy(true);
		try {
			await api.deliverableMoveShelf(project.id, d.id, value);
			onOpenChange(false);
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="pop gap-4 p-6 sm:max-w-md">
				<DialogHeader>
					<DialogTitle>「{d.title}」 책장 옮기기</DialogTitle>
					<DialogDescription className="leading-relaxed break-keep">{hint}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1.5">
					<Label>칸</Label>
					<Input
						autoFocus
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && !busy && void move()}
						placeholder="예: 요구사항/중간보고 (비우면 미분류)"
						className="h-9"
					/>
				</div>
				{cells.length > 0 && (
					<div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
						{cells.map((c) => (
							<button key={c} type="button" onClick={() => setValue(c)} className="rounded-md border border-border px-2 py-0.5 text-[12.5px] text-muted-foreground hover:bg-hover hover:text-foreground">
								{c}
							</button>
						))}
					</div>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						취소
					</Button>
					<Button disabled={busy} onClick={() => void move()}>
						옮기기
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
