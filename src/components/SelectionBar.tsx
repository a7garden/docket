import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 칩을 하나라도 고르면 뜨는 동작 줄. 왼쪽은 고르기, 오른쪽은 고른 것에 할 일. */
export function SelectionBar({ count, total, onAll, onClear, children, className }: { count: number; total: number; onAll: () => void; onClear: () => void; children: ReactNode; className?: string }) {
	return (
		<div className={cn("flex flex-wrap items-center gap-1 rounded-md border border-brand/35 bg-brand/6 px-2 py-1.5 text-[12.5px]", className)}>
			<span className="px-1 font-medium tabular">{count}개 고름</span>
			{count < total && (
				<Button size="xs" variant="ghost" onClick={onAll}>
					모두 고르기
				</Button>
			)}
			<Button size="xs" variant="ghost" onClick={onClear}>
				풀기
			</Button>
			<div className="flex-1" />
			<div className="flex shrink-0 gap-1">{children}</div>
		</div>
	);
}
