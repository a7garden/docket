import type { ReactElement } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { comboLabel, useKeyDef } from "@/lib/keys";

/**
 * 키가 걸린 단추 · 탭의 툴팁. 이름과 키를 등록부에서 읽어 「대화 · Ctrl 2」로 보인다.
 * 키는 마우스를 올리거나 초점이 갈 때만 보인다 — 늘 보이는 Kbd 는 화면마다 주 단추 하나뿐이다.
 * 키가 지금 등록되어 있지 않으면 툴팁 없이 그대로 그린다.
 */
export function KeyTip({ id, extra, side, children }: { id: string; extra?: string; side?: "top" | "right" | "bottom" | "left"; children: ReactElement }) {
	const def = useKeyDef(id);
	if (!def) return children;
	return (
		<Tooltip>
			<TooltipTrigger asChild>{children}</TooltipTrigger>
			<TooltipContent side={side}>
				{extra ? `${def.label} · ${extra}` : def.label}
				<Kbd>{comboLabel(def.combo)}</Kbd>
			</TooltipContent>
		</Tooltip>
	);
}
