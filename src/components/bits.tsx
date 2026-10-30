import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/status";

const TONE: Record<Tone, string> = {
	brand: "bg-brand/12 text-brand-text border-brand/45",
	run: "bg-run/12 text-run-text border-run/40",
	danger: "bg-danger/12 text-danger border-danger/25",
	ok: "bg-secondary text-muted-foreground border-border",
	muted: "bg-secondary text-muted-foreground border-border",
};

export function Chip({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
	return (
		<span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap", TONE[tone], className)}>
			{tone === "run" && <RunDot />}
			{children}
		</span>
	);
}

export function RunDot({ className }: { className?: string }) {
	return <span aria-hidden className={cn("run-dot inline-block size-1.5 rounded-full bg-run", className)} />;
}

/** 칸 이름. 본문보다 작고 옅게, 그러나 자리를 잡을 만큼은 굵게. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("text-[12px] font-semibold tracking-[-0.005em] text-muted-foreground", className)}>{children}</div>;
}

/** 상세 창 안의 구획 이름. 본문 마크다운의 소제목보다 낮아 보이지 않게 둔다. 낮으면 앱의 구조가 Claude 가 쓴 글 속에 묻힌다. */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
	return <h4 className={cn("text-[13px] font-semibold tracking-[-0.01em] text-foreground/85", className)}>{children}</h4>;
}

export function Empty({ children, className }: { children: ReactNode; className?: string }) {
	return <div className={cn("py-10 text-center text-[13px] text-subtle", className)}>{children}</div>;
}

export function Diffstat({ added, removed }: { added: number; removed: number }) {
	return (
		<span className="mono tabular text-[11.5px]">
			<span className="text-ok">+{added}</span> <span className="text-danger">−{removed}</span>
		</span>
	);
}
