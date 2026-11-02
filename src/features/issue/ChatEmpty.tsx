import type { Draft } from "@/features/issue/ChatTab";
import { useProjects } from "@/lib/queries";
import { focusInput, soon } from "@/lib/regions";
import { GLOBAL_PID, type Issue } from "@/lib/types";
import { cn } from "@/lib/utils";

/** 아직 시작하지 않은 대화인가. 터미널 기록은 세션이 있어야 읽으므로 세션이 없으면 보일 차례가 없다. */
export function isBlankChat(issue: Issue) {
	return !issue.sessionId && issue.runs.length === 0 && !issue.run && !issue.queue?.length;
}

interface Starter {
	label: string;
	prompt: string;
}

/** 대화 기본 모드가 읽기 전용이라 읽기만으로 답할 수 있는 것만 둔다. */
const PROJECT_STARTERS: Starter[] = [
	{ label: "저장소 구조 설명", prompt: "이 저장소의 구조를 설명해 줘. 주요 폴더와 진입점을 짚어 줘." },
	{ label: "시험 돌리는 법", prompt: "이 저장소의 빌드와 시험은 어떻게 돌려?" },
	{ label: "최근 바뀐 것 요약", prompt: "최근 커밋에서 바뀐 것을 요약해 줘." },
];

const APP_STARTERS: Starter[] = [
	{ label: "플러그인 만드는 법", prompt: "이 앱의 플러그인은 어떻게 만들어?" },
	{ label: "설정 살펴보기", prompt: "지금 설정을 살펴보고 눈여겨볼 것을 알려 줘." },
	{ label: "최근 기록 요약", prompt: "최근 대화와 실행 기록을 요약해 줘." },
];

const ISSUE_STARTERS: Starter[] = [
	{ label: "구현 방법 설명", prompt: "이 메모를 어떻게 구현하면 좋을지 설명해 줘." },
	{ label: "관련 코드 찾기", prompt: "이 메모와 관련된 코드를 찾아 줘." },
	{ label: "빠진 점 짚기", prompt: "이 메모에서 빠졌거나 모호한 점을 짚어 줘." },
];

function startersOf(issue: Issue) {
	if (!issue.talk) return ISSUE_STARTERS;
	return issue.projectId === GLOBAL_PID ? APP_STARTERS : PROJECT_STARTERS;
}

/** 시작 화면의 제목과 설명. 어느 저장소 · 메모를 두고 묻는지 바로 알게 한다. */
export function ChatIntro({ issue, compact = false }: { issue: Issue; compact?: boolean }) {
	const { data: projects = [] } = useProjects();
	const name = projects.find((p) => p.id === issue.projectId)?.name;
	const [title, desc] = !issue.talk
		? ["이 메모로 무엇부터 할까요?", `아래에 적으면 메모${issue.plan ? " · 계획" : ""}을 읽고 새 세션을 엽니다. 묻기만 할 수도, 바로 고치게 할 수도 있고 고친 파일은 변경 탭에 쌓입니다.`]
		: issue.projectId === GLOBAL_PID
			? ["이 앱에 대해 무엇을 물어볼까요?", "어느 프로젝트에도 묶이지 않고 플러그인 · 설정 · 기록을 다룹니다."]
			: [`${name ?? "이 저장소"} 에 대해 무엇을 물어볼까요?`, "Claude 가 코드를 읽고 답합니다. 묻다가 「작업 메모로 등록해 줘」라고 하면 보드에 메모를 만듭니다."];
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 text-center break-keep">
			<h3 className={cn("font-semibold tracking-[-0.02em] text-foreground", compact ? "text-[16px]" : "text-[21px]")}>{title}</h3>
			<p className="text-[13px] leading-relaxed text-subtle">{desc}</p>
		</div>
	);
}

/** 시작 문구. 토큰을 쓰지 않고 권한 모드를 볼 틈을 주려고 보내지 않고 입력칸에 채운다. 쓰던 글이 있으면 그 뒤에 잇는다. */
export function ChatStarters({ issue, draft, onDraft }: { issue: Issue; draft: Draft; onDraft: (d: Draft) => void }) {
	const pick = (prompt: string) => {
		onDraft({ ...draft, text: draft.text.trim() ? `${draft.text.trimEnd()}\n\n${prompt}` : prompt });
		soon(() => focusInput());
	};
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-wrap justify-center gap-1.5">
			{startersOf(issue).map((s) => (
				<button
					key={s.label}
					type="button"
					title={s.prompt}
					onClick={() => pick(s.prompt)}
					className="rounded-full border border-border px-3 py-1 text-[12.5px] text-muted-foreground transition-colors outline-none hover:border-border-strong hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					{s.label}
				</button>
			))}
		</div>
	);
}
