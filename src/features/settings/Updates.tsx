import { useState } from "react";
import { ChevronRight, Download, RefreshCw } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { bytes, relTime } from "@/lib/format";
import { useUpdate } from "@/lib/updater";
import { cn } from "@/lib/utils";
import { Group, Row } from "./Settings";
// 깔린 판의 바뀐 내용은 앱에 묶어 둔다. 오프라인이어도 보이고, 릴리즈 노트와 같은 원본(CHANGELOG.md)이다.
import changelog from "../../../CHANGELOG.md?raw";

interface Release {
	version: string;
	date: string;
	body: string;
}

/**
 * 「## <판> — <날짜>」 구획마다 하나로 자른다. 맨 위 제목과 쓰는 법 안내는 이 파일을 고치는 사람에게 하는 말이라 버린다.
 * 머리 꼴이 어긋나도 구획은 버리지 않는다. 머리 줄 전체를 판 이름으로 두어 내용이 빠지지 않게 한다.
 */
function releases(md: string): Release[] {
	return md
		.split(/^(?=## )/m)
		.filter((s) => s.startsWith("## "))
		.map((s) => {
			const nl = s.indexOf("\n");
			const head = (nl < 0 ? s : s.slice(0, nl)).slice(3).trim();
			const m = /^(\S+)\s+[—–-]\s+(.+)$/.exec(head);
			return { version: m ? m[1] : head, date: m ? m[2] : "", body: nl < 0 ? "" : s.slice(nl + 1).trim() };
		});
}

const RELEASES = releases(changelog);

/** 맨 위 단계 목록 항목 수. 접힌 판에서 얼마나 바뀌었는지 가늠하게 한다. */
function itemCount(body: string) {
	return (body.match(/^[-*] /gm) ?? []).length;
}

/** 판 하나. 머리(판 · 날짜 · 표지 · 항목 수)를 누르면 본문이 펼쳐진다. */
function ReleaseCard({ release, tag, defaultOpen }: { release: Release; tag?: string; defaultOpen?: boolean }) {
	const [open, setOpen] = useState(!!defaultOpen);
	const n = itemCount(release.body);
	return (
		<div className="rounded-lg border border-border">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
			>
				<ChevronRight className={cn("size-3.5 shrink-0 text-subtle transition-transform", open && "rotate-90")} />
				<span className="tabular text-[13px] font-semibold">{release.version}</span>
				{release.date && <span className="tabular text-[12px] text-subtle">{release.date}</span>}
				{tag && <span className="rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground">{tag}</span>}
				{n > 0 && <span className="ml-auto text-[12px] text-subtle tabular">{n}건</span>}
			</button>
			{open &&
				(release.body ? (
					<Markdown text={release.body} className="px-3 pt-0.5 pb-3 pl-8.5 text-[13px] selectable" />
				) : (
					<p className="px-3 pb-3 pl-8.5 text-[12.5px] text-subtle">적힌 내용이 없습니다.</p>
				))}
		</div>
	);
}

/** 설정 › 업데이트. 지금 판 · 새 판 확인과 설치 · 자동 확인 · 판마다 바뀐 내용. */
export function Updates({ version, auto, onAutoChange }: { version?: string; auto: boolean; onAutoChange: (on: boolean) => void }) {
	const { phase, update, progress, error, checkedAt, check, requestInstall } = useUpdate();
	const busy = phase === "checking" || phase === "downloading";

	const status =
		phase === "checking"
			? "확인하는 중…"
			: phase === "latest"
				? "최신 판입니다."
				: phase === "available" && update
					? `새 판 ${update.version} 이 있습니다.`
					: phase === "downloading"
						? progress.total
							? `받는 중 ${bytes(progress.done)} / ${bytes(progress.total)}`
							: `받는 중 ${bytes(progress.done)}`
						: phase === "error"
							? `확인하지 못했습니다 · ${error}`
							: "아직 확인하지 않았습니다.";

	return (
		<Group id="updates">
			<Row label={`지금 판 ${version ?? ""}`} hint={checkedAt ? `${status} · ${relTime(checkedAt)} 확인` : status} inline>
				<Button variant="outline" size="sm" disabled={busy} onClick={() => void check().catch(() => {})}>
					<RefreshCw className={phase === "checking" ? "animate-spin" : undefined} />
					업데이트 확인
				</Button>
			</Row>
			<Row label="자동으로 확인" hint="켤 때와 켜 둔 동안 1시간마다 새 판을 확인하고, 새 판이 나오면 한 번 알립니다. 설치는 직접 고릅니다." inline>
				<Switch checked={auto} onCheckedChange={onAutoChange} />
			</Row>
			{update && (phase === "available" || phase === "downloading" || phase === "error") && (
				<Row label="새 판" hint="설치하면 앱이 꺼졌다 다시 켜집니다.">
					<ReleaseCard release={{ version: update.version, date: update.date?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "", body: update.body ?? "" }} tag="새 판" defaultOpen />
					<div>
						<Button size="sm" disabled={phase === "downloading"} onClick={requestInstall}>
							<Download />
							설치하고 다시 켜기
						</Button>
					</div>
				</Row>
			)}
			<Row label="바뀐 내용" hint="깔린 판까지의 기록입니다. 판을 누르면 펼칩니다.">
				<div className="flex flex-col gap-1.5">
					{RELEASES.map((r, n) => (
						<ReleaseCard key={r.version} release={r} tag={r.version === version ? "지금 판" : undefined} defaultOpen={n === 0} />
					))}
				</div>
			</Row>
		</Group>
	);
}
