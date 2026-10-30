/*
 * 설정 › 산출물 › 「문서 도구」 줄. 산출물을 파일로 만들 때 쓰는 프로그램이 이 PC 에 있는지 점검한다.
 * 무엇을 보는지는 앱에 실은 플러그인의 scripts/doctor.py 가 정한다. 화면은 그 결과를 늘어놓기만 한다.
 */
import { useState } from "react";
import { Check, Copy, Minus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, errorText } from "@/lib/api";
import type { DocTool, DocTools as Result } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Row } from "./Settings";

export function DocTools() {
	const [result, setResult] = useState<Result | null>(null);
	const [busy, setBusy] = useState(false);

	// 파이썬 · 한컴 · Office 를 하나씩 띄워 보므로 몇 초 걸린다. 설정 화면을 열 때마다 돌리지 않고 누를 때만 본다.
	const check = async () => {
		setBusy(true);
		try {
			setResult(await api.docTools());
		} catch (e) {
			toast.error(errorText(e));
		} finally {
			setBusy(false);
		}
	};

	const missingRequired = result?.items.filter((i) => i.need === "required" && !i.ok) ?? [];

	return (
		<Row
			label="문서 도구"
			hint="산출물을 한글 · 워드 · 엑셀 · 파워포인트 파일로 만들 때 쓰는 프로그램입니다. 「필수」가 없으면 그 형식을 만들 수 없고, 「확인용」이 없으면 쪽 그림 확인 같은 검사를 건너뜁니다."
		>
			<div className="flex flex-col gap-2.5">
				<div className="flex items-center gap-2">
					<Button variant="outline" size="sm" onClick={() => void check()} disabled={busy}>
						<RefreshCw className={busy ? "animate-spin" : undefined} />
						{busy ? "점검 중…" : result ? "다시 점검" : "점검"}
					</Button>
					{result && !result.error && (
						<span className={cn("text-[12.5px]", missingRequired.length ? "text-danger" : "text-subtle")}>
							{missingRequired.length ? `필수 ${missingRequired.length}개가 없습니다` : "필수 도구가 모두 있습니다"}
						</span>
					)}
				</div>
				{result?.error && <p className="text-[12.5px] text-danger">{result.error}</p>}
				{result && result.items.length > 0 && (
					<ul className="flex flex-col rounded-lg border border-border">
						{result.items.map((t) => (
							<ToolLine key={t.key} t={t} />
						))}
					</ul>
				)}
				{result && !result.python && !result.error && (
					<p className="text-[12.5px] leading-relaxed break-keep text-subtle">Python 이 없어 나머지를 보지 못했습니다. python.org 에서 Python 3 을 깔고 다시 점검합니다.</p>
				)}
				{result?.install && <Install command={result.install} />}
			</div>
		</Row>
	);
}

function ToolLine({ t }: { t: DocTool }) {
	const Icon = t.ok ? Check : t.need === "required" ? X : Minus;
	return (
		<li className="flex items-center gap-2.5 border-b border-border px-3 py-1.5 last:border-b-0">
			<Icon className={cn("size-3.5 shrink-0", t.ok ? "text-ok" : t.need === "required" ? "text-danger" : "text-subtle")} />
			<span className="w-32 shrink-0 truncate text-[13px]">{t.label}</span>
			<span className="mono min-w-0 flex-1 truncate text-[12px] text-muted-foreground selectable" title={t.detail}>
				{t.detail}
			</span>
			<span className="hidden shrink-0 text-[12px] text-subtle sm:inline">{t.usedFor}</span>
			<span className={cn("shrink-0 rounded px-1.5 py-px text-[11px]", t.need === "required" ? "bg-muted text-muted-foreground" : "text-subtle")}>{t.need === "required" ? "필수" : "확인용"}</span>
		</li>
	);
}

function Install({ command }: { command: string }) {
	return (
		<div className="flex flex-col gap-1">
			<p className="text-[12.5px] text-subtle">빠진 Python 패키지는 터미널에서 이 명령으로 깝니다.</p>
			<div className="flex items-center gap-2">
				<code className="mono min-w-0 flex-1 truncate rounded-md border border-border bg-secondary px-2.5 py-1.5 text-[12px] selectable">{command}</code>
				<Button
					variant="outline"
					size="icon"
					aria-label="명령 복사"
					onClick={() =>
						void navigator.clipboard.writeText(command).then(
							() => toast.success("복사했습니다"),
							(e) => toast.error(errorText(e)),
						)
					}
				>
					<Copy />
				</Button>
			</div>
		</div>
	);
}
