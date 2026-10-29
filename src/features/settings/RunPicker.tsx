import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** 모델 · effort 의 첫 항목(빈 값)은 「따름」이다. 이름은 쓰는 곳이 정한다 — 설정은 「CLI 기본값」, 메모는 「설정 따름」. */
export const MODELS = [
	{ value: "", label: "" },
	{ value: "fable", label: "Fable" },
	{ value: "opus", label: "Opus" },
	{ value: "sonnet", label: "Sonnet" },
	{ value: "haiku", label: "Haiku" },
];

/** claude --effort 의 단계. 낮은 것부터 늘어놓아 지금 어디쯤인지 한눈에 보이게 한다. */
export const EFFORTS = [
	{ value: "", label: "", hint: "" },
	{ value: "low", label: "낮음", hint: "빠름" },
	{ value: "medium", label: "보통", hint: "균형" },
	{ value: "high", label: "높음", hint: "깊게" },
	{ value: "xhigh", label: "매우 높음", hint: "더 깊게" },
	{ value: "max", label: "최대", hint: "가장 깊게" },
];

export const effortLabel = (v: string) => (v ? (EFFORTS.find((e) => e.value === v)?.label ?? v) : "");
const modelLabel = (v: string) => (v ? (MODELS.find((m) => m.value === v)?.label ?? v) : "");

/**
 * 모델과 effort 를 단추 하나로 고른다. 닫혀 있을 때는 고른 것만 보이고, 열면 두 열에서 따로 고른다.
 * 칸을 둘로 나누면 설정 · 작성칸 · 메모 탭마다 줄이 늘어 어지러워서, 드롭다운 하나가 있던 자리에 그대로 들어가게 했다.
 */
export function RunPicker({
	model,
	effort,
	onModel,
	onEffort,
	followLabel,
	size = "sm",
	className,
	title,
}: {
	model: string;
	effort: string;
	onModel: (v: string) => void;
	onEffort: (v: string) => void;
	/** 빈 값의 이름. 설정은 「CLI 기본값」, 메모는 「설정 따름」. */
	followLabel: string;
	size?: "sm" | "default";
	className?: string;
	title?: string;
}) {
	const picked = [modelLabel(model), effortLabel(effort)].filter(Boolean);
	const text = picked.join(" · ") || followLabel;
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					data-size={size}
					aria-label={`모델 · effort: ${text}`}
					title={title ?? `모델 ${modelLabel(model) || followLabel} · effort ${effortLabel(effort) || followLabel}`}
					className={cn(
						"flex items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] dark:bg-input/30 dark:hover:bg-input/50",
						className,
					)}
				>
					<span className="min-w-0 truncate">{text}</span>
					<ChevronDown className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="pop w-auto flex-row gap-1 p-1.5"
				// 작성칸은 Esc 로 접힌다. 창 안의 Esc 가 React 트리를 거슬러 작성칸까지 올라가 함께 접히지 않게 여기서 멈춘다.
				onKeyDown={(e) => e.key === "Escape" && e.stopPropagation()}
			>
				<Column title="모델" items={MODELS.map((m) => ({ value: m.value, label: m.label || followLabel }))} value={model} onPick={onModel} />
				<div className="w-px self-stretch bg-border" />
				<Column title="effort" items={EFFORTS.map((e) => ({ value: e.value, label: e.label || followLabel, hint: e.hint }))} value={effort} onPick={onEffort} />
			</PopoverContent>
		</Popover>
	);
}

function Column({ title, items, value, onPick }: { title: string; items: { value: string; label: string; hint?: string }[]; value: string; onPick: (v: string) => void }) {
	return (
		<div className="flex min-w-36 flex-col" role="radiogroup" aria-label={title}>
			<div className="px-2 pt-1 pb-1.5 text-[11.5px] font-medium text-subtle">{title}</div>
			{items.map((it) => (
				<button
					key={it.value || "follow"}
					type="button"
					role="radio"
					aria-checked={it.value === value}
					onClick={() => it.value !== value && onPick(it.value)}
					className="flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
				>
					<Check className={cn("size-3.5 shrink-0", it.value !== value && "invisible")} />
					<span className="flex-1 whitespace-nowrap">{it.label}</span>
					{it.hint && <span className="text-[11.5px] whitespace-nowrap text-subtle">{it.hint}</span>}
				</button>
			))}
		</div>
	);
}
