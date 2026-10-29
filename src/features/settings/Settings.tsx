/*
 * 설정 화면.
 * - 목차 SECTIONS · 화면 Settings (왼쪽 목차 + 본문 두 단)
 * - 구획: Claude · 자동 계획 · 지식베이스 · 산출물 · 플러그인(Plugins.tsx) · 화면 · 업데이트(Updates.tsx) · 저장 위치
 * - 틀: Group · Row (Updates.tsx · Plugins.tsx 도 쓴다)
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorText } from "@/lib/api";
import { qk, useAppInfo, useSettings } from "@/lib/queries";
import type { Settings as S } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Plugins } from "./Plugins";
import { RunPicker } from "./RunPicker";
import { Updates } from "./Updates";

/** 제목은 한 줄이라 가벼운 모델이면 된다. 비싼 모델은 목록에 두지 않는다. */
const TITLE_MODELS = [
	{ value: "off", label: "끄기 (첫 줄)" },
	{ value: "haiku", label: "Haiku" },
	{ value: "sonnet", label: "Sonnet" },
];

/** 색인 카드는 파일마다 부르는 호출이라 가벼운 모델만 둔다. */
const KB_MODELS = [
	{ value: "default", label: "제목 모델 따름" },
	{ value: "haiku", label: "Haiku" },
	{ value: "sonnet", label: "Sonnet" },
];

/** 구획 id 와 제목. 목차와 각 Group 의 제목이 여기 한 곳에서 나온다. 순서가 화면 순서다. */
const SECTIONS = {
	claude: "Claude",
	autoPlan: "자동 계획",
	knowledge: "지식베이스",
	deliverables: "산출물",
	plugins: "플러그인",
	screen: "화면",
	updates: "업데이트",
	storage: "저장 위치",
} as const;
type SectionId = keyof typeof SECTIONS;
const SECTION_IDS = Object.keys(SECTIONS) as SectionId[];
const sectionDom = (id: SectionId) => `settings-${id}`;

/**
 * 스크롤 칸 위쪽 30% 띠에 걸린 구획 가운데 맨 앞 것을 목차의 불로 둔다.
 * 목차로 옮긴 구획은 스크롤이 멈출 때까지 그대로 둔다. 맨 아래 짧은 구획은 맨 위까지 못 올라와 띠 판정만으로는 불이 들어오지 않는다.
 */
function useActiveSection(ready: boolean) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState<SectionId>(SECTION_IDS[0]);
	const pinned = useRef(false);
	useEffect(() => {
		const root = scrollRef.current;
		if (!ready || !root) return;
		const seen = new Set<SectionId>();
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					const id = (e.target as HTMLElement).dataset.section as SectionId;
					if (e.isIntersecting) seen.add(id);
					else seen.delete(id);
				}
				const first = SECTION_IDS.find((id) => seen.has(id));
				if (first && !pinned.current) setActive(first);
			},
			{ root, rootMargin: "0px 0px -70% 0px" },
		);
		root.querySelectorAll<HTMLElement>("[data-section]").forEach((el) => io.observe(el));
		const unpin = () => (pinned.current = false);
		root.addEventListener("scrollend", unpin);
		return () => {
			io.disconnect();
			root.removeEventListener("scrollend", unpin);
		};
	}, [ready]);
	const go = (id: SectionId) => {
		pinned.current = true;
		setActive(id);
		document.getElementById(sectionDom(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
	};
	return { scrollRef, active, go };
}

export function Settings() {
	const qc = useQueryClient();
	const { data: settings } = useSettings();
	const { data: info, refetch: refetchInfo } = useAppInfo();
	const [s, setS] = useState<S | null>(null);
	useEffect(() => {
		if (settings) setS(settings);
	}, [settings]);
	const { scrollRef, active, go } = useActiveSection(s !== null);

	const save = async (patch: Partial<S>) => {
		if (!s) return;
		const next = { ...s, ...patch };
		setS(next);
		try {
			qc.setQueryData(qk.settings, await api.settingsSave(next));
			if ("claudePath" in patch) void refetchInfo();
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	if (!s) return null;

	// 켠 상태는 설정에 있고 목록의 enabled 는 서버가 그것으로 채운다. 저장한 뒤 목록을 다시 읽어야 대화 탭의 단추 이름이 따라온다.
	const togglePlugin = async (id: string, on: boolean) => {
		const rest = s.enabledPlugins.filter((x) => x !== id);
		await save({ enabledPlugins: on ? [...rest, id] : rest });
		void qc.invalidateQueries({ queryKey: qk.plugins });
	};

	return (
		// 넓은 창에서 본문만 왼쪽에 붙이면 오른쪽이 텅 빈다. 목차와 본문을 한 덩어리로 묶어 가운데에 둔다.
		// 목차는 스크롤 칸 안에 있어야 sticky 로 따라온다.
		<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
			<div className="mx-auto flex w-full max-w-4xl gap-10">
				<nav className="sticky top-0 hidden w-44 shrink-0 flex-col gap-0.5 self-start lg:flex">
					<h1 className="px-2.5 pb-3 text-[18px] font-semibold tracking-[-0.02em]">설정</h1>
					{SECTION_IDS.map((id) => (
						<button
							key={id}
							type="button"
							onClick={() => go(id)}
							className={cn(
								"h-8 rounded-md px-2.5 text-left text-[13px] font-medium text-muted-foreground hover:text-foreground",
								active === id && "bg-hover text-foreground",
							)}
						>
							{SECTIONS[id]}
						</button>
					))}
				</nav>
				<div className="flex min-w-0 flex-1 flex-col gap-8 pb-10">
					<h1 className="-mb-3 text-[18px] font-semibold tracking-[-0.02em] lg:hidden">설정</h1>
					<Group id="claude">
						<Row label="실행 파일" hint={info?.claudePath ? `${info.claudeVersion || "버전 확인 못 함"} · ${info.claudePath}` : "찾지 못했습니다. 경로를 지정하세요."}>
							<div className="flex gap-2">
								<Input
									defaultValue={s.claudePath}
									placeholder="비우면 PATH 에서 찾습니다"
									onBlur={(e) => e.target.value !== s.claudePath && void save({ claudePath: e.target.value.trim() })}
									className="mono h-8 text-[12.5px] placeholder:font-sans md:text-[12.5px]"
								/>
								<Button
									variant="outline"
									onClick={async () => {
										const p = await openDialog({ title: "claude 실행 파일", filters: [{ name: "claude", extensions: ["exe", "cmd"] }] });
										if (typeof p === "string") void save({ claudePath: p });
									}}
								>
									찾아보기
								</Button>
							</div>
						</Row>
						{(
							[
								["planModel", "planEffort", "계획 모델", "메모를 읽고 계획을 세울 때 씁니다."],
								["implModel", "implEffort", "구현 모델", "승인한 계획대로 고치고 되돌릴 때, 산출물을 쓸 때 씁니다."],
								["chatModel", "chatEffort", "대화 모델", "이슈와 프로젝트 대화에서 씁니다."],
							] as const
						).map(([modelKey, effortKey, label, hint]) => (
							<Row key={modelKey} label={label} hint={`${hint} effort 를 높일수록 깊이 따지지만 느리고 비용이 듭니다. 메모에서 고른 값이 이보다 앞섭니다.`}>
								<RunPicker
									model={s[modelKey]}
									effort={s[effortKey]}
									onModel={(v) => void save({ [modelKey]: v } as Partial<S>)}
									onEffort={(v) => void save({ [effortKey]: v } as Partial<S>)}
									followLabel="CLI 기본값"
									size="default"
									className="w-48"
								/>
							</Row>
						))}
						<Row label="제목 모델" hint="새 메모의 제목을 이 모델이 지어 붙입니다. 메모를 고치면 몇 초 뒤 다시 짓습니다. 끄면 첫 줄이 제목입니다.">
							<Select value={s.titleModel || "off"} onValueChange={(v) => void save({ titleModel: v === "off" ? "" : v })}>
								<SelectTrigger className="w-48">
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="pop">
									{TITLE_MODELS.map((m) => (
										<SelectItem key={m.value} value={m.value}>
											{m.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Row>
						<Row label="MCP 서버" hint="끄면 Claude 가 MCP 서버를 하나도 띄우지 않습니다. 외부 문서 도구가 모르게 쓰이는 것을 막습니다." inline>
							<Switch checked={s.useMcp} onCheckedChange={(v) => void save({ useMcp: v })} />
						</Row>
					</Group>

					<Group id="autoPlan">
						<Row label="새 메모에 켜기" hint="켜 두면 메모를 붙이고 정한 시간이 지난 뒤 Claude 가 계획을 세웁니다. 메모마다 끌 수 있습니다." inline>
							<Switch checked={s.autoPlan} onCheckedChange={(v) => void save({ autoPlan: v })} />
						</Row>
						<Row label="기다리는 시간" hint="메모를 마지막으로 고친 뒤 이만큼 지나야 시작합니다. 쓰다 만 메모로 계획이 돌지 않게 하는 여유입니다.">
							<div className="flex items-center gap-2">
								<Input
									type="number"
									min={0}
									step={10}
									defaultValue={s.autoPlanDelaySec}
									onBlur={(e) => {
										const n = Math.max(0, Math.round(Number(e.target.value) || 0));
										if (n !== s.autoPlanDelaySec) void save({ autoPlanDelaySec: n });
									}}
									className="tabular h-8 w-24"
								/>
								<span className="text-[13px] text-muted-foreground">초</span>
							</div>
						</Row>
					</Group>

					<Group id="knowledge">
						<Row
							label="카드 모델"
							hint="프로젝트마다 켠 지식베이스의 문서를 이 모델이 읽고 구획마다 색인 카드를 적습니다. 산출물 자동 갱신의 판정에도 씁니다. 파일마다 부르니 가벼운 모델을 권합니다. 「제목 모델 따름」은 제목 모델이 꺼져 있으면 Haiku 입니다."
						>
							<Select value={s.kbCardModel || "default"} onValueChange={(v) => void save({ kbCardModel: v === "default" ? "" : v })}>
								<SelectTrigger className="w-48">
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="pop">
									{KB_MODELS.map((m) => (
										<SelectItem key={m.value} value={m.value}>
											{m.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Row>
					</Group>

					<Group id="deliverables">
						<Row
							label="파일을 넣으면 작성법 뽑기"
							hint="산출물에 템플릿 · 참고 자료를 넣거나 새 산출물을 등록하면 Claude 가 글을 읽고 작성법 · 어휘 · 형식 · 템플릿 · 이름 규칙을 뽑아 「만드는 법」을 채웁니다. 산출물 작성과 같은 구현 모델로 돌아 넣을 때마다 비용이 듭니다. 끄면 이름 규칙 · 형식 · 템플릿만 앱이 정하고, 작성법은 「작성법 뽑기」를 눌러야 뽑습니다."
							inline
						>
							<Switch checked={s.recipeAuto} onCheckedChange={(v) => void save({ recipeAuto: v })} />
						</Row>
					</Group>

					<Plugins enabled={s.enabledPlugins} onToggle={togglePlugin} />

					<Group id="screen">
						<Row label="테마" inline>
							<div className="inline-flex rounded-lg bg-secondary p-0.5">
								{(
									[
										["system", "시스템"],
										["dark", "어둡게"],
										["light", "밝게"],
									] as const
								).map(([v, label]) => (
									<button
										key={v}
										type="button"
										onClick={() => void save({ theme: v })}
										className={cn("h-7 rounded-md px-3 text-[12.5px] font-medium text-muted-foreground", s.theme === v && "bg-hover text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]")}
									>
										{label}
									</button>
								))}
							</div>
						</Row>
						<Row label="보내기 키" hint="대화 · 다시 계획 · 수정 요청 입력칸에서 씁니다. Enter 를 고르면 Shift+Enter 로 줄을 바꾸고, Ctrl+Enter 로도 보냅니다." inline>
							<div className="inline-flex rounded-lg bg-secondary p-0.5">
								{(
									[
										["ctrlEnter", "Ctrl+Enter"],
										["enter", "Enter"],
									] as const
								).map(([v, label]) => (
									<button
										key={v}
										type="button"
										onClick={() => void save({ sendKey: v })}
										className={cn("h-7 rounded-md px-3 text-[12.5px] font-medium text-muted-foreground", s.sendKey === v && "bg-hover text-foreground shadow-[inset_0_0_0_1px_var(--border-strong)]")}
									>
										{label}
									</button>
								))}
							</div>
						</Row>
					</Group>

					<Updates version={info?.version} />

					<Group id="storage">
						<Row
							label="앱 데이터"
							hint="이슈 · 첨부 · 실행 기록 · 산출물을 모두 여기 둡니다. 프로젝트 폴더에는 쓰지 않습니다. 옮기려면 DOCKET_HOME 환경 변수에 폴더를 지정하고 앱을 다시 켭니다."
						>
							<PathLine path={info?.dataRoot} />
						</Row>
						<Row label="Claude 설정 폴더" hint="전역 지침과 스킬을 여기서 읽고 씁니다.">
							<PathLine path={info?.claudeHome} />
						</Row>
					</Group>
				</div>
			</div>
		</div>
	);
}

function PathLine({ path }: { path?: string }) {
	return (
		<div className="flex items-center gap-2">
			<code className="mono min-w-0 flex-1 truncate rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[12.5px] selectable">{path}</code>
			<Button variant="outline" size="icon" aria-label="폴더 열기" disabled={!path} onClick={() => path && void api.open(path).catch((e) => toast.error(errorText(e)))}>
				<FolderOpen />
			</Button>
		</div>
	);
}

export function Group({ id, children }: { id: SectionId; children: ReactNode }) {
	return (
		<section id={sectionDom(id)} data-section={id} className="flex flex-col gap-1">
			<h2 className="px-1 pb-2 text-[15px] font-semibold tracking-[-0.01em]">{SECTIONS[id]}</h2>
			<div className="surface flex flex-col divide-y divide-border rounded-xl">{children}</div>
		</section>
	);
}

export function Row({ label, hint, inline, children }: { label: string; hint?: string; inline?: boolean; children: ReactNode }) {
	return (
		<div className={cn("flex gap-4 px-4 py-3.5", inline ? "items-center" : "flex-col gap-2")}>
			<div className={cn("flex flex-col gap-0.5", inline && "flex-1")}>
				<Label className="text-[13px] text-foreground">{label}</Label>
				{hint && <p className="text-[12.5px] leading-relaxed break-keep text-subtle">{hint}</p>}
			</div>
			{children}
		</div>
	);
}
