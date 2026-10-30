import { useEffect, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { goProject, goTalks, PROJECT_TABS } from "@/features/project/ProjectHeader";
import { SECTION_IDS, SECTIONS, SETTING_ROWS } from "@/features/settings/Settings";
import { api } from "@/lib/api";
import { activeCommands, comboLabel, CONFIRM_MS, useKey } from "@/lib/keys";
import { focusOnly, qk, useProjects, useTalks } from "@/lib/queries";
import { recentItems } from "@/lib/recent";
import { matchScore, normalize, numberScore } from "@/lib/search";
import { needsDecision } from "@/lib/status";
import { useUi } from "@/lib/store";
import { type Deliverable, GLOBAL_PID, type Issue, type Project } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 묶음 순서 그대로다. 빈 입력일 때는 「지금 여기서」 · 「최근」 · 「결정할 차례」만 쓴다. */
const GROUPS = ["지금 여기서", "최근", "결정할 차례", "이슈", "대화", "산출물", "프로젝트", "화면", "설정"] as const;
type Group = (typeof GROUPS)[number];

/** 묶음마다 보일 줄 수. 넘치면 점수가 높은 것만 남긴다 — 다 보이면 아래 묶음(화면 · 설정)이 스크롤 밖으로 밀린다. */
const PER_GROUP = 6;
/** 빈 입력에서 보일 동작 수. 메뉴 항목까지 다 보이면 「최근」이 밀린다. 나머지는 이름으로 찾는다. */
const IDLE_COMMANDS = 8;

interface Item {
	key: string;
	group: Group;
	/** 이슈 번호. 대화에는 두지 않는다 — 화면 어디에서도 대화를 번호로 부르지 않는다. */
	num?: number;
	label: string;
	/** 오른쪽 흐린 글자. 다른 프로젝트 것인지 알 수 있게 프로젝트 이름을 둔다. */
	sub?: string;
	/** 견줄 글. 비우면 label 이다. 「docket › 산출물」은 「docket 산출물」로 찾는다. */
	text?: string;
	score: number;
	/** 같은 점수면 최근 고친 것이 위다. */
	at: number;
	go: () => void;
	/** 지금 화면의 동작이다. 창이 닫힌 뒤에 부른다 — 동작이 연 입력칸의 초점을 닫히는 창이 도로 가져가지 않게. */
	act?: boolean;
	/** 오른쪽에 보일 키 */
	combo?: string;
	/** 두 번 눌러야 실행한다. 키와 같은 규칙이다 — Ctrl+K 를 열고 Enter 한 번에 구현이 돌면 안 된다. */
	twice?: boolean;
	disabled?: boolean;
}

interface Source {
	project: Project;
	issues: Issue[];
	talks: Issue[];
	docs: Deliverable[];
}

/** 앱 대화의 자리. 항목 아래 줄에 「앱」으로 보인다. */
const APP_SOURCE = { id: GLOBAL_PID, name: "앱", path: "" } as Project;

const openIssue = (i: Issue) => useUi.getState().openTarget({ projectId: i.projectId, target: "issue", id: i.id });
const openTalk = (t: Issue) => useUi.getState().openTarget({ projectId: t.projectId, target: "issue", id: t.id, talk: true });
const openDoc = (d: Deliverable) => useUi.getState().openTarget({ projectId: d.projectId, target: "deliverable", id: d.id });

const issueItem = (group: Group, i: Issue, p: Project, score = 0): Item => ({
	key: `${group}:${i.id}`,
	group,
	num: i.number,
	label: i.title || "제목 없는 메모",
	sub: p.name,
	score,
	at: i.updatedAt,
	go: () => openIssue(i),
});
const talkItem = (group: Group, t: Issue, p: Project, score = 0): Item => ({
	key: `${group}:${t.id}`,
	group,
	label: t.title || "새 대화",
	sub: p.name,
	score,
	at: t.updatedAt,
	go: () => openTalk(t),
});
const docItem = (group: Group, d: Deliverable, p: Project, score = 0): Item => ({
	key: `${group}:${d.id}`,
	group,
	label: d.title || "제목 없는 문서",
	sub: p.name,
	score,
	at: d.updatedAt,
	go: () => openDoc(d),
});

/** 지금 등록된 동작. 키 있는 것이 먼저다. run 의 인자는 키 이벤트라 빈 것을 넘긴다 — Ctrl+K 에서 부르는 동작은 인자를 보지 않는다. */
function commandItems(): Item[] {
	const { keys, others } = activeCommands();
	const base = { group: "지금 여기서" as Group, score: 0, at: 0, act: true };
	return [
		...keys.map((d): Item => ({ ...base, key: `k:${d.id}`, label: d.label, combo: d.combo, twice: !!d.confirm, go: () => void d.run(new KeyboardEvent("keydown")) })),
		...others.map((c, n): Item => ({ ...base, key: `c:${n}:${c.label}`, label: c.label, sub: c.sub, text: c.sub ? `${c.label} ${c.sub}` : c.label, disabled: c.disabled, go: c.onSelect })),
	];
}

/** 빈 입력: 지금 화면의 동작, 최근 연 것, 결정할 차례 이슈. 목록에서 빠진(지운 · 아직 만들지 않은) 것은 건너뛴다. */
function idleItems(all: Source[], app: Source): Item[] {
	const out: Item[] = commandItems().slice(0, IDLE_COMMANDS);
	const before = out.length;
	for (const r of recentItems()) {
		const src = [...all, app].find((s) => s.project.id === r.projectId);
		if (!src) continue;
		if (r.kind === "issue") {
			const i = src.issues.find((x) => x.id === r.id);
			if (i) out.push(issueItem("최근", i, src.project));
		} else if (r.kind === "talk") {
			const t = src.talks.find((x) => x.id === r.id);
			if (t) out.push(talkItem("최근", t, src.project));
		} else {
			const d = src.docs.find((x) => x.id === r.id);
			if (d) out.push(docItem("최근", d, src.project));
		}
		if (out.length - before >= 5) break;
	}
	const decide = all
		.flatMap((s) => s.issues.filter(needsDecision).map((i) => issueItem("결정할 차례", i, s.project)))
		.sort((a, b) => b.at - a.at)
		.slice(0, PER_GROUP);
	return [...out, ...decide];
}

function searchItems(all: Source[], app: Source, q: string): Item[] {
	const out: Item[] = [];
	const add = (it: Item) => {
		const score = Math.max(it.score, matchScore(q, it.text ?? it.label));
		if (score > 0) out.push({ ...it, score });
	};
	for (const c of commandItems()) add(c);
	for (const { project: p, issues, talks, docs } of all) {
		for (const i of issues) add(issueItem("이슈", i, p, numberScore(q, i.number)));
		for (const t of talks) add(talkItem("대화", t, p));
		for (const d of docs) add(docItem("산출물", d, p));
		add({ key: `p:${p.id}`, group: "프로젝트", label: p.name, sub: p.path, score: 0, at: 0, go: () => goProject(p.id) });
		for (const [v, tab] of PROJECT_TABS) {
			add({ key: `v:${p.id}:${v}`, group: "화면", label: `${p.name} › ${tab}`, text: `${p.name} ${tab}`, score: 0, at: 0, go: () => goProject(p.id, v) });
		}
		add({ key: `v:${p.id}:talks`, group: "화면", label: `${p.name} › 대화`, text: `${p.name} 대화`, score: 0, at: 0, go: () => goTalks(p.id) });
	}
	// 앱 대화는 프로젝트가 아니다. 프로젝트 · 탭 항목 없이 대화만 넣는다.
	for (const t of app.talks) add(talkItem("대화", t, app.project));
	add({ key: "v:talks", group: "화면", label: "대화", text: "대화 앱 대화 모든 대화", score: 0, at: 0, go: () => useUi.getState().setView("talks") });
	add({ key: "v:claude", group: "화면", label: "Claude 설정", score: 0, at: 0, go: () => useUi.getState().setView("claude") });
	add({ key: "v:settings", group: "화면", label: "설정", score: 0, at: 0, go: () => useUi.getState().setView("settings") });
	for (const id of SECTION_IDS) {
		const go = () => useUi.getState().openSettings(id);
		add({ key: `s:${id}`, group: "설정", label: SECTIONS[id], sub: "설정", score: 0, at: 0, go });
		for (const row of SETTING_ROWS[id]) add({ key: `s:${id}:${row}`, group: "설정", label: row, sub: `설정 › ${SECTIONS[id]}`, score: 0, at: 0, go });
	}
	return GROUPS.flatMap((g) =>
		out
			.filter((it) => it.group === g)
			.sort((a, b) => b.score - a.score || b.at - a.at)
			.slice(0, PER_GROUP),
	);
}

/**
 * Ctrl+K 나 제목 줄 단추로 여닫는 명령어 팔레트. 모든 프로젝트의 이슈 · 대화 · 산출물과 화면 · 설정 구획으로 바로 가고, 지금 화면의 동작을 실행한다.
 * 동작은 등록부에서 읽는다 — 지금 등록된 키와 「더 보기」 메뉴 항목이 곧 「지금 여기서」다.
 * 목록은 알림함 · 사이드바가 이미 읽는 프로젝트별 캐시를 같은 열쇠로 모은 것이라 따로 묻지 않는다. 본문은 보지 않고 번호 · 제목만 본다 — 본문 검색은 보드 검색이 한다.
 */
export function CommandPalette() {
	const open = useUi((s) => s.paletteOpen);
	const setOpen = useUi((s) => s.setPaletteOpen);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	/** 한 번 더 누르면 실행될 줄 */
	const [armed, setArmed] = useState<string | null>(null);
	const list = useRef<HTMLDivElement>(null);
	/** 창을 연 자리. Esc 로 닫으면 돌려준다. */
	const opener = useRef<HTMLElement | null>(null);
	/** 줄을 골랐는지, 그 줄이 닫힌 뒤에 부를 동작 */
	const picked = useRef<{ later?: () => void } | null>(null);

	// 어느 길로 열어도 여기를 지난다. 렌더 중에 맞춰야 창이 지난 검색어를 비추지 않고, 초점이 입력칸으로 가기 전에 연 자리를 잡는다.
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		// 열 때마다 빈 입력에서 시작한다. 지난 검색어가 남아 있으면 「최근」을 보려고 지워야 한다.
		if (open) {
			opener.current = document.activeElement as HTMLElement | null;
			picked.current = null;
			setQuery("");
			setActive(0);
		}
		setArmed(null);
	}
	useKey({ id: "palette", combo: "Mod+K", label: "명령어 팔레트", group: "어디서나", overModal: true, run: () => setOpen(!open) });

	const { data: projects = [] } = useProjects();
	const issues = useQueries({ queries: projects.map((p) => ({ queryKey: qk.issues(p.id), queryFn: () => api.issues(p.id), ...focusOnly(p.id) })) });
	const talks = useQueries({ queries: projects.map((p) => ({ queryKey: qk.talks(p.id), queryFn: () => api.talks(p.id), ...focusOnly(p.id) })) });
	const docs = useQueries({ queries: projects.map((p) => ({ queryKey: qk.deliverables(p.id), queryFn: () => api.deliverables(p.id), ...focusOnly(p.id) })) });
	const { data: appTalks = [] } = useTalks(GLOBAL_PID);

	const q = normalize(query);
	// 렌더마다 다시 거른다. 프로젝트 몇 개의 번호 · 제목이라 가볍고, useQueries 는 렌더마다 새 배열을 줘서 메모해도 걸러 둔 것을 다시 쓰지 못한다.
	let items: Item[] = [];
	if (open) {
		const all: Source[] = projects.map((project, n) => ({ project, issues: issues[n]?.data ?? [], talks: talks[n]?.data ?? [], docs: docs[n]?.data ?? [] }));
		const app: Source = { project: APP_SOURCE, issues: [], talks: appTalks, docs: [] };
		items = q ? searchItems(all, app, q) : idleItems(all, app);
	}

	const cur = Math.min(active, Math.max(items.length - 1, 0));
	useEffect(() => {
		list.current?.querySelector(`[data-index="${cur}"]`)?.scrollIntoView({ block: "nearest" });
	}, [cur]);
	// 다른 줄로 옮기거나 검색어를 바꾸면, 시간이 지나면 처음부터다.
	useEffect(() => setArmed(null), [cur, query]);
	useEffect(() => {
		if (!armed) return;
		const t = setTimeout(() => setArmed(null), CONFIRM_MS);
		return () => clearTimeout(t);
	}, [armed]);

	const pick = (it: Item | undefined) => {
		if (!it || it.disabled) return;
		if (it.twice && armed !== it.key) return setArmed(it.key);
		picked.current = it.act ? { later: it.go } : {};
		setArmed(null);
		setOpen(false);
		if (!it.act) it.go();
	};

	const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive(Math.min(cur + 1, items.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive(Math.max(cur - 1, 0));
		} else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
			// 한글 조합 중의 Enter 는 글자를 확정하는 것이라 넘기지 않는다.
			e.preventDefault();
			pick(items[cur]);
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent
				showCloseButton={false}
				onCloseAutoFocus={(e) => {
					e.preventDefault();
					const p = picked.current;
					picked.current = null;
					if (p) p.later?.();
					else if (opener.current?.isConnected) opener.current.focus();
				}}
				className="pop top-[14vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
			>
				<DialogTitle className="sr-only">명령어 팔레트</DialogTitle>
				<DialogDescription className="sr-only">모든 프로젝트의 이슈 · 대화 · 산출물 · 화면 · 설정을 번호나 제목으로 찾아 열고, 지금 화면의 동작을 실행합니다.</DialogDescription>
				<label className="flex h-12 items-center gap-2.5 border-b border-border px-4">
					<Search className="size-4 shrink-0 text-subtle" />
					<input
						autoFocus
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setActive(0);
						}}
						onKeyDown={onKey}
						placeholder="#번호 · 제목 · 화면 · 설정 · 동작"
						role="combobox"
						aria-expanded
						aria-controls="palette-list"
						aria-activedescendant={items[cur] ? `palette-${cur}` : undefined}
						className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
					/>
				</label>
				<div ref={list} id="palette-list" role="listbox" className="max-h-[56vh] overflow-y-auto p-1.5">
					{items.length === 0 && <p className="px-2.5 py-6 text-center text-[13px] text-subtle">{q ? "맞는 것이 없습니다" : "최근 연 것과 결정할 이슈가 없습니다"}</p>}
					{items.map((it, n) => (
						<div key={it.key}>
							{(n === 0 || items[n - 1].group !== it.group) && <div className="px-2.5 pt-2 pb-1 text-[11.5px] font-semibold text-subtle">{it.group}</div>}
							<div
								id={`palette-${n}`}
								data-index={n}
								role="option"
								aria-selected={n === cur}
								aria-disabled={it.disabled || undefined}
								// 마우스가 움직일 때만 고른다. 키로 내려가며 목록이 스크롤될 때 멈춰 있는 포인터 밑의 줄이 골라지면 안 된다.
								onMouseMove={() => n !== cur && setActive(n)}
								onClick={() => pick(it)}
								className={cn("flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px]", n === cur && "bg-hover", it.disabled && "opacity-50")}
							>
								{it.num !== undefined && <span className="mono tabular w-10 shrink-0 text-[12px] text-subtle">#{it.num}</span>}
								<span className="min-w-0 flex-1 truncate">{it.label}</span>
								{it.sub && <span className="max-w-[40%] shrink-0 truncate text-[12px] text-subtle">{it.sub}</span>}
								{armed === it.key ? <span className="shrink-0 text-[12px] font-medium text-danger">한 번 더 Enter</span> : it.combo && <Kbd className="shrink-0">{comboLabel(it.combo)}</Kbd>}
							</div>
						</div>
					))}
				</div>
				<div className="border-t border-border px-4 py-2 text-[11.5px] text-subtle">↑↓ 고르기 · Enter 열기 · 실행 · Esc 닫기</div>
			</DialogContent>
		</Dialog>
	);
}
