import { useEffect, useState } from "react";
import { relTime } from "@/lib/format";
import { useUsage } from "@/lib/queries";
import type { Usage, UsageWindow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/** claude 가 보내는 창 이름. 모르는 창은 받은 이름 그대로 보인다 — 새 창이 생겨도 빠뜨리지 않는다. */
const WINDOW_LABEL: Record<string, string> = {
	five_hour: "5시간",
	seven_day: "7일",
	seven_day_opus: "7일 Opus",
	seven_day_sonnet: "7일 Sonnet",
};

const label = (w: UsageWindow) => WINDOW_LABEL[w.key] ?? w.key;
const pct = (w: UsageWindow) => Math.round(w.utilization * 100);
/** 다시 찬 창의 옛 값은 0 으로 보지 않고 따로 적는다. 새 값은 다음 실행 때 온다. */
const expired = (w: UsageWindow, now: number) => w.resetsAt > 0 && w.resetsAt * 1000 <= now;

function tone(w: UsageWindow) {
	if (w.status === "rejected" || w.utilization >= 0.95) return "danger";
	if (w.utilization >= 0.8) return "warn";
	return "";
}

function resetText(sec: number, now: number) {
	const m = Math.max(1, Math.round((sec * 1000 - now) / 60_000));
	if (m < 60) return `${m}분 뒤`;
	const h = Math.floor(m / 60);
	if (h < 24) return m % 60 ? `${h}시간 ${m % 60}분 뒤` : `${h}시간 뒤`;
	const d = new Date(sec * 1000);
	return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시`;
}

/** 「N분 전」 · 「N분 뒤」가 묵지 않게 30초마다 다시 그린다. */
function useNow() {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(t);
	}, []);
	return now;
}

/**
 * 제목 줄의 구독 사용률. 실행이 돌 때 claude 가 함께 보내 온 마지막 값을 보이고, 따로 묻지 않는다.
 * 한 번도 받지 않았으면(API 키로 쓰는 경우 등) 그리지 않는다.
 */
export function UsageMeter() {
	const { data } = useUsage();
	const now = useNow();
	if (!data?.windows.length) return null;
	// 단추에는 5시간 · 7일만 둔다. 모델별 창은 펼쳐서 본다.
	const main = data.windows.filter((w) => w.key === "five_hour" || w.key === "seven_day");
	const shown = main.length ? main : data.windows.slice(0, 2);
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					title={`Claude 사용량 · ${relTime(data.seenAt, now)} 기준`}
					className="mr-1 flex h-7 items-center gap-3 rounded-md px-2.5 text-[12px] text-muted-foreground transition-colors outline-none hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-hover data-[state=open]:text-foreground"
				>
					{shown.map((w) => (
						<span key={w.key} className="flex items-center gap-1.5">
							<span className="tabular">
								{label(w)} {expired(w, now) ? "—" : `${pct(w)}%`}
							</span>
							<Bar w={w} now={now} className="w-8" />
						</span>
					))}
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="pop w-72 p-0">
				<Detail usage={data} now={now} />
			</PopoverContent>
		</Popover>
	);
}

function Bar({ w, now, className }: { w: UsageWindow; now: number; className?: string }) {
	const t = tone(w);
	const width = expired(w, now) ? 0 : Math.min(100, Math.max(0, w.utilization * 100));
	return (
		<span className={cn("relative h-1 overflow-hidden rounded-full bg-border", className)} aria-hidden>
			<span className={cn("absolute inset-y-0 left-0 rounded-full", t === "danger" ? "bg-danger" : t === "warn" ? "bg-brand" : "bg-muted-foreground")} style={{ width: `${width}%` }} />
		</span>
	);
}

function Detail({ usage, now }: { usage: Usage; now: number }) {
	return (
		<div className="flex flex-col">
			<div className="px-3 pt-2.5 pb-1 text-[12.5px] font-medium">Claude 사용량</div>
			<ul className="flex flex-col gap-2.5 px-3 py-2">
				{usage.windows.map((w) => {
					const t = tone(w);
					const gone = expired(w, now);
					return (
						<li key={w.key} className="flex flex-col gap-1">
							<span className="flex items-baseline justify-between gap-2 text-[12.5px]">
								<span>{label(w)}</span>
								<span className={cn("tabular", !gone && t === "danger" && "text-danger", !gone && t === "warn" && "text-brand-text")}>{gone ? "다시 참" : `${pct(w)}% 씀`}</span>
							</span>
							<Bar w={w} now={now} className="w-full" />
							<span className="text-[11.5px] text-subtle">
								{gone ? "다음 실행 때 새 값을 받습니다" : w.resetsAt > 0 ? `${resetText(w.resetsAt, now)} 다시 참` : ""}
								{!gone && w.status === "rejected" && " · 지금은 한도에 걸려 있습니다"}
							</span>
						</li>
					);
				})}
			</ul>
			<div className="border-t border-border px-3 py-2 text-[11.5px] text-subtle">
				{relTime(usage.seenAt, now)} 실행에서 받은 값입니다{usage.overage && " · 추가 사용분으로 도는 중"}
			</div>
		</div>
	);
}
