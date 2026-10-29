/*
 * 설정 › 플러그인.
 * - 목록 Plugins · 한 줄 PluginRow · 설정 칸 PluginFields · 권한 허락 창 GrantDialog · 설명 글 summary · 권한 뜻 permissionText
 * - 매니페스트(plugin.json)는 화면에서 고치지 않는다. 인자 칸을 두면 같은 정의를 두 곳에서 고치게 된다.
 *   여기서는 설치 · 켜고 끄기 · 권한 허락 · 설정 칸 값 · 지우기 · 문제 보기만 한다.
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FileText, FolderOpen, MoreHorizontal, PackagePlus, Plus, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DropdownActions, attempt } from "@/components/ActionMenu";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api, errorText } from "@/lib/api";
import { qk, usePlugins } from "@/lib/queries";
import type { PluginField, PluginManifest, PluginView } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Group } from "./Settings";

const EVENT_TEXT: Record<string, string> = {
	planned: "계획 끝남",
	implemented: "구현 끝남",
	failed: "실패",
	reverted: "되돌림",
	done: "완료",
	dropped: "보류",
	deliverable: "산출물 새 판",
};

const PLACE_TEXT: Record<string, string> = { issue: "이슈", file: "바뀐 파일", project: "프로젝트" };

/** 아무 명령이나 돌릴 수 있는 프로그램. 실행 권한이 이름만 묶고 인자는 거르지 않으므로, 허락하면 사실상 모든 것을 허락하는 셈이다. */
const SHELLS = new Set(["cmd", "powershell", "pwsh", "bash", "sh", "wsl", "node", "python", "py", "deno", "bun", "claude", "wscript", "cscript", "mshta", "rundll32"]);

/** 허락 창에 보이는 권한의 뜻. 「무엇을 할 수 있게 되는가」를 적는다. */
function permissionText(p: string): { text: string; risky?: boolean } {
	switch (p) {
		case "issue:read":
			return { text: "이슈 · 산출물의 내용(메모 · 계획 · 결과 · 바뀐 파일)과 프로젝트 경로를 읽습니다" };
		case "notify":
			return { text: "앱 안에 알림을 띄웁니다" };
		case "open":
			return { text: "파일 · 폴더 · 웹 주소를 기본 프로그램으로 엽니다" };
		case "storage":
			return { text: "앱 데이터 안 자기 저장소에 값을 남깁니다 (1MB 까지)" };
	}
	const exe = p.match(/^process:(.+)$/)?.[1];
	if (exe) {
		const risky = SHELLS.has(exe.toLowerCase());
		return { text: `${exe} 를 실행합니다. 인자는 플러그인이 정합니다${risky ? " — 무엇이든 실행할 수 있는 프로그램입니다" : ""}`, risky };
	}
	const host = p.match(/^http:(.+)$/)?.[1];
	if (host) return { text: `${host} 로 요청을 보냅니다. 받은 자료를 그 주소로 내보낼 수 있습니다` };
	return { text: p };
}

/** 줄 아래 설명. 무엇을 더하는지 · 어떤 권한인지 · 문제가 무엇인지를 한 줄씩. */
function summary(p: PluginView): string[] {
	const c = p.contributes;
	const what = [
		c.menus.length > 0 && `메뉴: ${c.menus.map((m) => `${PLACE_TEXT[m.where] ?? m.where} 「${m.label}」`).join(" · ")}`,
		c.events.length > 0 && `사건: ${c.events.map((e) => EVENT_TEXT[e] ?? e).join(" · ")}`,
		c.terminal && `터미널: ${p.exePath || c.terminal.exe}`,
		c.settings.length > 0 && `설정 칸 ${c.settings.length}개`,
	].filter(Boolean) as string[];
	const lines = [what.join(" · ")];
	if (p.permissions.length) lines.push(`권한: ${p.permissions.join(" · ")}`);
	if (p.problem) lines.push(`쓸 수 없음: ${p.problem}`);
	else if (p.missing.length) lines.push(`허락하지 않은 권한이 있어 쉬고 있습니다: ${p.missing.join(" · ")}`);
	else if (p.warning) lines.push(p.warning);
	if (p.description) lines.push(p.description);
	return lines.filter((l) => l.trim());
}

function kindText(p: PluginView) {
	return p.legacy ? "옛 정의" : p.main ? "wasm" : "선언형";
}

export function Plugins({ enabled, onToggle }: { enabled: string[]; onToggle: (id: string, on: boolean) => Promise<void> }) {
	const qc = useQueryClient();
	const { data, refetch } = usePlugins();
	const plugins = data?.plugins ?? [];
	const [grant, setGrant] = useState<PluginView | null>(null);
	const [install, setInstall] = useState<{ path: string; manifest: PluginManifest; problem: string; installed: string } | null>(null);
	const herdr = plugins.find((p) => p.id === "herdr");
	// 인자를 하나도 채우지 않은 옛 정의는 앱이 새 틀로 바꿔 준다(plugin_host create_preset). 손으로 채운 것은 건드리지 않는다.
	const t = herdr?.contributes.terminal;
	const herdrBlank = !!herdr && herdr.legacy && !herdr.problem.startsWith("정의를 읽지 못했습니다") && !!t && [t.probe, t.focus, t.attach, t.launch].every((a) => a.length === 0);

	// 설치 · 허락은 서버가 settings.json 을 고친다. 설정 화면이 쥔 사본도 다시 읽어야 다음 저장이 그것을 덮지 않는다.
	const refresh = () => {
		void qc.invalidateQueries({ queryKey: qk.settings });
		void qc.invalidateQueries({ queryKey: qk.plugins });
	};

	const toggle = (p: PluginView, on: boolean) => {
		if (on && p.missing.length > 0) setGrant(p);
		else void onToggle(p.id, on);
	};

	const pick = async () => {
		const path = await openDialog({ multiple: false, filters: [{ name: "플러그인 (zip · plugin.json)", extensions: ["zip", "json"] }] });
		if (typeof path !== "string") return;
		try {
			const r = await api.pluginInspect(path);
			setInstall({ path, ...r });
		} catch (e) {
			toast.error(errorText(e));
		}
	};

	return (
		<Group id="plugins">
			{plugins.length === 0 && (
				<p className="px-4 py-3.5 text-[12.5px] leading-relaxed break-keep text-subtle">
					아직 플러그인이 없습니다. 「설치」로 zip 이나 plugin.json 을 고르거나, 아래에서 herdr 터미널 플러그인을 만듭니다. 플러그인은 메뉴 항목 · 사건 · 설정 칸 · 터미널을 더하고, 코드는
					샌드박스(wasm)에서 허락한 권한으로만 돕니다.
				</p>
			)}
			{plugins.map((p) => (
				<PluginRow key={p.file} p={p} on={enabled.includes(p.id)} onToggle={(v) => toggle(p, v)} onGrant={() => setGrant(p)} onRemoved={refresh} />
			))}
			<div className="flex flex-wrap items-center gap-2 px-4 py-3">
				<Button variant="outline" size="sm" onClick={() => void pick()}>
					<PackagePlus />
					설치
				</Button>
				<Button variant="outline" size="sm" disabled={!data?.dir} onClick={() => data?.dir && void attempt(() => api.open(data.dir))}>
					<FolderOpen />
					폴더 열기
				</Button>
				{(!herdr || herdrBlank) && (
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							void attempt(async () => {
								await api.pluginCreatePreset("herdr");
								toast.success(herdrBlank ? "herdr 정의의 인자를 채웠습니다. 켜면 씁니다." : "herdr 정의를 만들었습니다. 켜면 씁니다.");
								void refetch();
							})
						}
					>
						<Plus />
						{herdrBlank ? "herdr 정의 새로 채우기" : "herdr 정의 만들기"}
					</Button>
				)}
				<Button variant="ghost" size="sm" onClick={() => void refetch()}>
					<RefreshCw />
					다시 읽기
				</Button>
			</div>
			<GrantDialog
				open={!!grant}
				onOpenChange={(o) => !o && setGrant(null)}
				manifest={grant}
				title={grant ? `「${grant.name}」 을 켤까요?` : ""}
				confirm="허락하고 켜기"
				onConfirm={() =>
					grant &&
					void attempt(async () => {
						await api.pluginGrant(grant.id);
						refresh();
					})
				}
			/>
			<GrantDialog
				open={!!install}
				onOpenChange={(o) => !o && setInstall(null)}
				manifest={install?.manifest ?? null}
				problem={install?.problem}
				note={install?.installed ? `이미 있는 ${install.installed === "옛 정의" ? "옛 정의" : `판 ${install.installed || "(판 없음)"}`} 을 휴지통으로 옮기고 바꿉니다.` : ""}
				title={install ? `「${install.manifest.name}」${install.manifest.version ? ` ${install.manifest.version}` : ""} 을 설치할까요?` : ""}
				confirm="설치하고 켜기"
				onConfirm={() =>
					install &&
					void attempt(async () => {
						await api.pluginInstall(install.path);
						toast.success(`「${install.manifest.name}」 을 설치했습니다`);
						refresh();
					})
				}
			/>
		</Group>
	);
}

function PluginRow({ p, on, onToggle, onGrant, onRemoved }: { p: PluginView; on: boolean; onToggle: (on: boolean) => void; onGrant: () => void; onRemoved: () => void }) {
	const [confirm, setConfirm] = useState(false);
	const lines = summary(p);
	const items = [
		{ label: "기록 보기", icon: <FileText />, disabled: !p.main, onSelect: () => void attempt(() => api.open(p.log)) },
		{ label: "폴더에서 보기", icon: <FolderOpen />, onSelect: () => void attempt(() => api.reveal(p.file)) },
		"sep" as const,
		{ label: "지우기", icon: <Trash2 />, destructive: true, onSelect: () => setConfirm(true) },
	];
	return (
		<div className="flex flex-col">
			<div className="flex items-center gap-4 px-4 py-3.5">
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex items-baseline gap-2">
						<span className="text-[13px] font-semibold text-foreground">{p.name}</span>
						{p.version && <span className="tabular text-[12px] text-subtle">{p.version}</span>}
						<span className="text-[12px] text-subtle">· {kindText(p)}</span>
					</div>
					{lines.map((l, i) => (
						<p key={i} className={cn("text-[12.5px] leading-relaxed break-keep text-subtle", l.startsWith("쓸 수 없음") && "text-destructive")}>
							{l}
						</p>
					))}
					{p.failures > 0 && (
						<button type="button" className="self-start text-[12.5px] text-destructive underline-offset-2 hover:underline" onClick={() => void attempt(() => api.open(p.log))}>
							최근 7일 실패 {p.failures}건 · 기록 보기
						</button>
					)}
				</div>
				{on && p.missing.length > 0 && !p.problem && (
					<Button variant="outline" size="sm" onClick={onGrant}>
						<ShieldAlert />
						권한 허락
					</Button>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button size="icon-sm" variant="ghost" aria-label="더 보기">
							<MoreHorizontal />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="pop w-44">
						<DropdownActions items={items} />
					</DropdownMenuContent>
				</DropdownMenu>
				<Switch checked={on} onCheckedChange={onToggle} />
			</div>
			{on && !p.problem && p.missing.length === 0 && p.contributes.settings.length > 0 && <PluginFields p={p} />}
			<AlertDialog open={confirm} onOpenChange={setConfirm}>
				<AlertDialogContent className="pop">
					<AlertDialogHeader>
						<AlertDialogTitle>「{p.name}」 을 지울까요?</AlertDialogTitle>
						<AlertDialogDescription>플러그인과 그 설정 칸 값 · 저장소 · 기록을 앱 데이터의 휴지통 폴더로 옮기고, 켜기 · 허락한 권한을 지웁니다.</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>취소</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() =>
								void attempt(async () => {
									await api.pluginUninstall(p.id);
									onRemoved();
								})
							}
						>
							지우기
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

/** 매니페스트의 설정 칸. 값은 앱 데이터의 plugins-data/<id>/settings.json 에 두고, 플러그인은 입력의 settings 로 받는다. */
function PluginFields({ p }: { p: PluginView }) {
	const [values, setValues] = useState<Record<string, unknown> | null>(null);
	useEffect(() => {
		void api.pluginSettingsGet(p.id).then(setValues, (e) => toast.error(errorText(e)));
	}, [p.id]);
	if (!values) return null;
	const save = (key: string, v: unknown) => {
		const next = { ...values, [key]: v };
		setValues(next);
		void api.pluginSettingsSet(p.id, next).then(setValues, (e) => toast.error(errorText(e)));
	};
	return (
		<div className="mx-4 mb-3.5 flex flex-col gap-3 rounded-lg border border-border px-3.5 py-3">
			{p.contributes.settings.map((f) => (
				<Field key={f.key} f={f} value={values[f.key]} onChange={(v) => save(f.key, v)} />
			))}
		</div>
	);
}

function Field({ f, value, onChange }: { f: PluginField; value: unknown; onChange: (v: unknown) => void }) {
	const [text, setText] = useState(String(value ?? ""));
	useEffect(() => setText(String(value ?? "")), [value]);
	const head = (
		<div className="flex min-w-0 flex-1 flex-col gap-0.5">
			<span className="text-[12.5px] font-medium text-foreground">{f.label}</span>
			{f.hint && <span className="text-[12px] leading-relaxed break-keep text-subtle">{f.hint}</span>}
		</div>
	);
	if (f.type === "toggle")
		return (
			<div className="flex items-center gap-3">
				{head}
				<Switch checked={value === true} onCheckedChange={onChange} />
			</div>
		);
	if (f.type === "select")
		return (
			<div className="flex items-center gap-3">
				{head}
				<Select value={String(value ?? "")} onValueChange={onChange}>
					<SelectTrigger className="w-44">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{f.options.map((o) => (
							<SelectItem key={o} value={o}>
								{o}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		);
	// 글자마다 저장하지 않는다. 칸을 떠날 때 한 번 쓴다.
	return (
		<div className="flex flex-col gap-1.5">
			{head}
			<Input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== String(value ?? "") && onChange(text)} />
		</div>
	);
}

/** 켜기 · 설치 전에 권한을 보이고 허락을 받는다. 문제가 있으면 허락 단추를 막는다. */
function GrantDialog({
	open,
	onOpenChange,
	manifest,
	title,
	confirm,
	onConfirm,
	problem,
	note,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	manifest: PluginManifest | null;
	title: string;
	confirm: string;
	onConfirm: () => void;
	problem?: string;
	note?: string;
}) {
	const perms = manifest?.permissions ?? [];
	const c = manifest?.contributes;
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="pop">
				<AlertDialogHeader>
					<AlertDialogTitle>{title}</AlertDialogTitle>
					<AlertDialogDescription>
						{manifest?.description || "이 플러그인이 할 수 있게 되는 일입니다."} 코드는 샌드박스에서 돌고, 아래에 없는 일은 하지 못합니다.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="flex flex-col gap-3 text-[13px]">
					{c && (
						<ul className="flex flex-col gap-1 text-muted-foreground">
							{c.menus.map((m) => (
								<li key={`${m.where}-${m.command}`}>
									· {PLACE_TEXT[m.where] ?? m.where} 메뉴에 「{m.label}」 을 더합니다
								</li>
							))}
							{c.events.length > 0 && <li>· {c.events.map((e) => EVENT_TEXT[e] ?? e).join(" · ")} 때 불립니다</li>}
							{c.terminal && <li>· 「터미널에서 잇기」를 {c.terminal.exe} 로 엽니다</li>}
						</ul>
					)}
					<div className="flex flex-col gap-1.5">
						<span className="text-[12px] font-semibold text-muted-foreground">권한</span>
						{perms.length === 0 ? (
							<span className="text-subtle">없음 — 입력으로 받은 이슈 번호 · 프로젝트 이름만 압니다</span>
						) : (
							perms.map((p) => {
								const { text, risky } = permissionText(p);
								return (
									<div key={p} className={cn("flex flex-col rounded-md border border-border px-2.5 py-1.5", risky && "border-destructive/50")}>
										<code className="mono text-[12px]">{p}</code>
										<span className={cn("text-[12.5px] break-keep text-muted-foreground", risky && "text-destructive")}>{text}</span>
									</div>
								);
							})
						)}
					</div>
					{note && <p className="text-[12.5px] text-subtle">{note}</p>}
					{problem && <p className="text-[12.5px] text-destructive">설치할 수 없습니다: {problem}</p>}
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>취소</AlertDialogCancel>
					<AlertDialogAction disabled={!!problem} onClick={onConfirm}>
						{confirm}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
