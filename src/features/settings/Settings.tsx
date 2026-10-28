import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorText } from "@/lib/api";
import { qk, useAppInfo, usePlugins, useSettings } from "@/lib/queries";
import type { PluginView, Settings as S } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Updates } from "./Updates";

export const MODELS = [
	{ value: "default", label: "CLI 기본값" },
	{ value: "fable", label: "Fable" },
	{ value: "opus", label: "Opus" },
	{ value: "sonnet", label: "Sonnet" },
	{ value: "haiku", label: "Haiku" },
];

/** 메모마다 고르는 모델. 「설정 따름」이면 실행 종류에 맞는 설정 모델을 쓴다. 작성칸과 상세 창이 같은 목록을 쓴다. */
export const MEMO_MODELS = [{ value: "default", label: "설정 따름" }, ...MODELS.filter((m) => m.value !== "default")];

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

export function Settings() {
	const qc = useQueryClient();
	const { data: settings } = useSettings();
	const { data: info, refetch: refetchInfo } = useAppInfo();
	const [s, setS] = useState<S | null>(null);
	useEffect(() => {
		if (settings) setS(settings);
	}, [settings]);

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
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="flex max-w-2xl flex-col gap-8 pb-10">
				<Group title="Claude">
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
							["planModel", "계획 모델", "메모를 읽고 계획을 세울 때 씁니다. 메모에서 고른 모델이 이보다 앞섭니다."],
							["implModel", "구현 모델", "승인한 계획대로 고치고 되돌릴 때, 산출물을 쓸 때 씁니다. 메모에서 고른 모델이 이보다 앞섭니다."],
							["chatModel", "대화 모델", "이슈와 프로젝트 대화에서 씁니다. 메모에서 고른 모델이 이보다 앞섭니다."],
						] as const
					).map(([key, label, hint]) => (
						<Row key={key} label={label} hint={hint}>
							<Select value={s[key] || "default"} onValueChange={(v) => void save({ [key]: v === "default" ? "" : v } as Partial<S>)}>
								<SelectTrigger className="w-48">
									<SelectValue />
								</SelectTrigger>
								<SelectContent className="pop">
									{MODELS.map((m) => (
										<SelectItem key={m.value} value={m.value}>
											{m.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
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

				<Group title="자동 계획">
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

				<Group title="지식베이스">
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

				<Plugins enabled={s.enabledPlugins} onToggle={togglePlugin} />

				<Group title="화면">
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
				</Group>

				<Updates version={info?.version} />

				<Group title="저장 위치">
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
	);
}

/**
 * 플러그인 정의는 plugins/ 폴더의 json 으로만 고친다. 화면에 인자 칸을 두면 같은 정의를 두 곳에서 고치게 된다.
 * 여기서는 켜고 끄기 · 틀 만들기 · 문제 보기만 한다.
 */
function Plugins({ enabled, onToggle }: { enabled: string[]; onToggle: (id: string, on: boolean) => Promise<void> }) {
	const { data, refetch } = usePlugins();
	const plugins = data?.plugins ?? [];
	const hasHerdr = plugins.some((p) => p.id === "herdr");
	return (
		<Group title="플러그인">
			{plugins.length === 0 && (
				<p className="px-4 py-3.5 text-[12.5px] leading-relaxed break-keep text-subtle">
					아직 플러그인이 없습니다. 플러그인 폴더에 json 정의를 두거나 아래에서 herdr 정의를 만듭니다. 켠 터미널 플러그인이 있으면 「터미널에서 잇기」가 그것으로 엽니다.
				</p>
			)}
			{plugins.map((p) => (
				<Row key={p.file} label={`${p.name} · ${p.kind || "종류 모름"}`} hint={pluginHint(p)} inline>
					<Switch checked={enabled.includes(p.id)} onCheckedChange={(v) => void onToggle(p.id, v)} />
				</Row>
			))}
			<div className="flex flex-wrap items-center gap-2 px-4 py-3">
				<Button variant="outline" size="sm" disabled={!data?.dir} onClick={() => data?.dir && void api.open(data.dir).catch((e) => toast.error(errorText(e)))}>
					<FolderOpen />
					폴더 열기
				</Button>
				{!hasHerdr && (
					<Button
						variant="outline"
						size="sm"
						onClick={async () => {
							try {
								await api.pluginCreatePreset("herdr");
								toast.success("herdr 정의를 만들었습니다. 인자를 채운 뒤 켜세요.");
								void refetch();
							} catch (e) {
								toast.error(errorText(e));
							}
						}}
					>
						<Plus />
						herdr 정의 만들기
					</Button>
				)}
				<Button variant="ghost" size="sm" onClick={() => void refetch()}>
					<RefreshCw />
					다시 읽기
				</Button>
			</div>
		</Group>
	);
}

function pluginHint(p: PluginView) {
	const lines = [p.exePath || p.file];
	if (p.problem) lines.push(`쓸 수 없음: ${p.problem}`);
	else if (p.warning) lines.push(p.warning);
	if (p.note) lines.push(p.note);
	return lines.join(" · ");
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

export function Group({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-1">
			<h2 className="px-1 pb-2 text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
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
