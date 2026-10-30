import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Empty, RunDot } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, errorText } from "@/lib/api";
import { newId } from "@/lib/format";
import { lastEnded, useSeen } from "@/lib/notices";
import { useAllTalks, useAppProject, useProjects } from "@/lib/queries";
import { type TalkRef, useUi } from "@/lib/store";
import { GLOBAL_PID, type Issue, type Project } from "@/lib/types";
import { TalkRow, TalkSlot } from "./Talks";

/**
 * 사이드바 아래 묶음의 「대화」. 앱 대화와 프로젝트별 대화를 한곳에서 본다.
 * 앱을 손보는 자리(Claude 설정 · 설정)와 함께 두고, 앱 대화가 위에 펼쳐져 있다. 프로젝트 묶음은 접혀 있다가 필요할 때 편다.
 * 프로젝트 대화를 열어도 사이드바의 현재 프로젝트는 그대로다. 프로젝트가 하나도 없어도 열린다.
 */
export function AllTalks() {
	const { data: projects = [] } = useProjects();
	const { data: app } = useAppProject();
	const { app: appTalks, byProject, loading } = useAllTalks(projects);
	const sel = useUi((s) => s.talk);
	const openTalk = useUi((s) => s.openTalk);
	const [busy, setBusy] = useState(false);
	const talk = sel ? [...appTalks, ...byProject.flatMap((g) => g.talks)].find((t) => t.id === sel.id) : undefined;
	const pathOf = (pid: string) => (pid === GLOBAL_PID ? (app?.path ?? "") : (projects.find((p) => p.id === pid)?.path ?? ""));

	// 연 대화가 여기 없으면(처음 · 지운 뒤) 가장 최근 앱 대화를 연다.
	useEffect(() => {
		if (!loading && !talk && appTalks.length) openTalk({ projectId: GLOBAL_PID, id: appTalks[0].id });
	}, [loading, talk, appTalks, openTalk]);

	// 아직 묻지 않은 대화가 그 자리에 있으면 그것을 다시 연다. 「새 대화」를 누를 때마다 빈 대화가 쌓이지 않게 한다.
	const create = async (pid: string) => {
		const list = pid === GLOBAL_PID ? appTalks : (byProject.find((g) => g.project.id === pid)?.talks ?? []);
		const blank = list.find((t) => t.runs.length === 0 && !t.run);
		if (blank) return openTalk({ projectId: pid, id: blank.id });
		setBusy(true);
		try {
			const t = await api.talkCreate(pid, newId());
			openTalk({ projectId: pid, id: t.id });
		} catch (e) {
			toast.error(errorText(e));
		}
		setBusy(false);
	};

	return (
		<>
			<h1 className="text-[18px] font-semibold tracking-[-0.02em]">대화</h1>
			<div className="flex min-h-0 flex-1 gap-4">
				<aside className="flex w-60 shrink-0 flex-col gap-2">
					<NewTalk projects={projects} busy={busy} onCreate={(pid) => void create(pid)} />
					<nav className="-mr-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
						<TalkGroup groupKey={GLOBAL_PID} label="앱" hint="어느 프로젝트에도 묶이지 않고 이 앱의 플러그인 · 설정 · 기록을 다루는 대화" talks={appTalks} sel={sel} />
						{byProject
							.filter((g) => g.talks.length > 0)
							.map((g) => (
								<TalkGroup key={g.project.id} groupKey={g.project.id} label={g.project.name} talks={g.talks} sel={sel} foldedByDefault />
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
									아직 앱 대화가 없습니다.
									<div className="mt-4">
										<Button disabled={busy} onClick={() => void create(GLOBAL_PID)}>
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

/** 본체는 앱 대화를 만들고, ▾ 에서 어느 프로젝트에 만들지 고른다. 대화가 없는 프로젝트도 여기서 시작한다. */
function NewTalk({ projects, busy, onCreate }: { projects: Project[]; busy: boolean; onCreate: (pid: string) => void }) {
	return (
		<div className="flex">
			<Button variant="outline" disabled={busy} className="flex-1 rounded-r-none" onClick={() => onCreate(GLOBAL_PID)}>
				<MessageSquarePlus />새 대화
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" size="icon" disabled={busy} aria-label="어디에 새 대화를 만들지 고르기" className="-ml-px rounded-l-none">
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
			<button type="button" onClick={() => setFold(groupKey, open)} aria-expanded={open} title={hint} className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left hover:bg-hover">
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
