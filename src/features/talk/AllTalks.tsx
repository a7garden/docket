import { useEffect } from "react";
import { ChevronDown, ChevronRight, MessageSquarePlus } from "lucide-react";
import { Empty, RunDot } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWithNewTalk } from "@/lib/newTalk";
import { lastEnded, useSeen } from "@/lib/notices";
import { useAllTalks, useAppProject, useProjects } from "@/lib/queries";
import { roveItem, useRovingList } from "@/lib/rovingList";
import { type TalkRef, useUi } from "@/lib/store";
import { GLOBAL_PID, type Issue, type Project } from "@/lib/types";
import { TalkRow, TalkSlot, useTalkKeys } from "./Talks";

/**
 * 사이드바 아래 묶음의 「대화」. 앱 대화와 프로젝트별 대화를 보는 하나뿐인 화면이다.
 * 앱 대화와 현재 프로젝트 묶음이 펼쳐져 있다. 다른 프로젝트 묶음은 접혀 있다가 필요할 때 편다.
 * 프로젝트 대화를 열어도 사이드바의 현재 프로젝트는 그대로다. 프로젝트가 하나도 없어도 열린다.
 */
export function AllTalks() {
	const { data: projects = [] } = useProjects();
	const { data: app } = useAppProject();
	const { app: savedApp, byProject: savedByProject, loading } = useAllTalks(projects);
	const withNew = useWithNewTalk();
	const appTalks = withNew(GLOBAL_PID, savedApp);
	const byProject = savedByProject.map((g) => ({ ...g, talks: withNew(g.project.id, g.talks) }));
	const sel = useUi((s) => s.talk);
	const openTalk = useUi((s) => s.openTalk);
	const openNewTalk = useUi((s) => s.openNewTalk);
	const talk = sel ? [...appTalks, ...byProject.flatMap((g) => g.talks)].find((t) => t.id === sel.id) : undefined;
	const pathOf = (pid: string) => (pid === GLOBAL_PID ? (app?.path ?? "") : (projects.find((p) => p.id === pid)?.path ?? ""));
	const projectId = useUi((s) => s.projectId);
	const home = projects.find((p) => p.id === projectId);
	// 「새 대화」 · Ctrl+N 이 만들 자리. 지금 보는 대화와 같은 자리이고, 연 대화가 없으면 현재 프로젝트다.
	const target = talk?.projectId ?? home?.id ?? GLOBAL_PID;
	const targetName = target === GLOBAL_PID ? "앱" : (projects.find((p) => p.id === target)?.name ?? "");

	// 연 대화가 여기 없으면(처음 · 지운 뒤) 현재 프로젝트의 가장 최근 대화를, 없으면 가장 최근 앱 대화를 연다.
	const fallback = byProject.find((g) => g.project.id === home?.id)?.talks[0] ?? appTalks[0];
	useEffect(() => {
		if (!loading && !talk && fallback) openTalk({ projectId: fallback.projectId, id: fallback.id });
	}, [loading, talk, fallback, openTalk]);

	// 아직 묻지 않은 대화가 그 자리에 있으면 그것을 다시 연다. 없으면 저장 전 대화를 연다 — 대화는 첫 질문을 보낼 때 만들어진다.
	const create = (pid: string) => {
		const list = pid === GLOBAL_PID ? appTalks : (byProject.find((g) => g.project.id === pid)?.talks ?? []);
		const blank = list.find((t) => t.runs.length === 0 && !t.run);
		if (blank) return openTalk({ projectId: pid, id: blank.id });
		openNewTalk(pid);
	};

	// 묶음 순서대로 넘긴다. 접힌 묶음은 건너뛴다 — 보이지 않는 줄로 옮겨 가면 어디 있는지 놓친다. 묶음을 펴는 기준은 TalkGroup 과 같다.
	const folded = useUi((s) => s.talkFolded);
	const shownOf = (key: string, list: Issue[], byDefault: boolean) => ((folded[key] ?? byDefault) && !list.some((t) => t.id === sel?.id) ? [] : list);
	const order = [...shownOf(GLOBAL_PID, appTalks, false), ...byProject.flatMap((g) => shownOf(g.project.id, g.talks, g.project.id !== home?.id))];
	useTalkKeys(order, talk?.id, (t) => openTalk({ projectId: t.projectId, id: t.id }), () => create(target));
	const rove = useRovingList();

	return (
		<>
			<h1 className="text-[18px] font-semibold tracking-[-0.02em]">대화</h1>
			<div className="flex min-h-0 flex-1 gap-4">
				<aside className="flex w-60 shrink-0 flex-col gap-2">
					<NewTalk projects={projects} target={target} targetName={targetName} onCreate={create} />
					<nav {...rove} className="-mr-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
						<TalkGroup groupKey={GLOBAL_PID} label="앱" hint="어느 프로젝트에도 묶이지 않고 이 앱의 플러그인 · 설정 · 기록을 다루는 대화" talks={appTalks} sel={sel} />
						{byProject
							.filter((g) => g.talks.length > 0)
							.map((g) => (
								<TalkGroup key={g.project.id} groupKey={g.project.id} label={g.project.name} talks={g.talks} sel={sel} foldedByDefault={g.project.id !== home?.id} />
							))}
					</nav>
				</aside>

				<section className="surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md">
					{talk ? (
						<TalkSlot key={talk.id} talk={talk} projectPath={pathOf(talk.projectId)} />
					) : (
						!loading && (
							<Empty className="grid flex-1 place-items-center leading-relaxed break-keep">
								<div>
									{target === GLOBAL_PID ? (
										<>
											어느 프로젝트에도 묶이지 않고 이 앱 자체를 두고 묻는 대화입니다.
											<br />
											플러그인을 만들거나 설정 · 기록을 살펴 달라고 할 수 있습니다.
										</>
									) : (
										<>
											메모를 쓰지 않고 이 저장소에 대해 바로 물어볼 수 있습니다.
											<br />
											묻다가 「작업 메모로 등록해 줘」라고 하면 보드에 메모를 만듭니다.
										</>
									)}
									<div className="mt-4">
										<Button onClick={() => create(target)}>
											<MessageSquarePlus />새 대화
										</Button>
									</div>
								</div>
							</Empty>
						)
					)}
				</section>
			</div>
		</>
	);
}

/** 본체는 지금 보는 대화와 같은 자리에 만들고, ▾ 에서 다른 자리를 고른다. 대화가 없는 프로젝트도 여기서 시작한다. */
function NewTalk({ projects, target, targetName, onCreate }: { projects: Project[]; target: string; targetName: string; onCreate: (pid: string) => void }) {
	return (
		<div className="flex">
			<Button variant="outline" title={`${targetName}에 새 대화 만들기`} className="min-w-0 flex-1 rounded-r-none" onClick={() => onCreate(target)}>
				<MessageSquarePlus />새 대화
				<span className="min-w-0 truncate font-normal text-subtle">{targetName}</span>
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" size="icon" aria-label="어디에 새 대화를 만들지 고르기" className="-ml-px rounded-l-none">
						<ChevronDown />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="pop w-56">
					<DropdownMenuItem onSelect={() => onCreate(GLOBAL_PID)}>앱 대화</DropdownMenuItem>
					{projects.length > 0 && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="text-[12px] font-normal text-subtle">프로젝트 대화</DropdownMenuLabel>
						</>
					)}
					{projects.map((p) => (
						<DropdownMenuItem key={p.id} onSelect={() => onCreate(p.id)}>
							{p.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

/** 묶음 하나. 접혀 있어도 읽지 않은 답 · 도는 실행이 머리에 보인다. 연 대화가 든 묶음은 늘 편다. */
function TalkGroup({
	groupKey,
	label,
	talks,
	sel,
	hint,
	foldedByDefault = false,
}: {
	groupKey: string;
	label: string;
	hint?: string;
	talks: Issue[];
	sel: TalkRef | null;
	foldedByDefault?: boolean;
}) {
	const folded = useUi((s) => s.talkFolded[groupKey] ?? foldedByDefault);
	const setFold = useUi((s) => s.setFold);
	const openTalk = useUi((s) => s.openTalk);
	const open = !folded || talks.some((t) => t.id === sel?.id);
	const running = talks.some((t) => t.run);
	const unread = useSeen((s) => talks.some((t) => !t.run && lastEnded(t.runs) > Math.max(s.seen[t.id] ?? 0, s.since)));
	return (
		<div className="flex flex-col gap-0.5">
			<button type="button" onClick={() => setFold(groupKey, open)} aria-expanded={open} title={hint} {...roveItem()} className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
				{open ? <ChevronDown className="size-3.5 shrink-0 text-subtle" /> : <ChevronRight className="size-3.5 shrink-0 text-subtle" />}
				<span className="min-w-0 truncate text-[12px] font-semibold text-muted-foreground">{label}</span>
				<span className="tabular shrink-0 text-[11.5px] text-subtle">{talks.length}</span>
				<span className="flex-1" />
				{running && <RunDot />}
				{unread && <span aria-label="읽지 않은 답" title="읽지 않은 답" className="size-1.5 shrink-0 rounded-full bg-brand" />}
			</button>
			{open && talks.map((t) => <TalkRow key={t.id} talk={t} active={t.id === sel?.id} onOpen={() => openTalk({ projectId: t.projectId, id: t.id })} />)}
		</div>
	);
}
