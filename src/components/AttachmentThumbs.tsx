import { useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { fileUrl, isImage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ImageViewer, type ViewerState } from "./ImageViewer";

/** 대화 · 메모에 붙인 첨부. 그림은 누르면 크게 보며 같은 묶음을 넘겨 보고, 나머지는 기본 프로그램으로 연다. onRemove 를 주면 보내기 전에 뺄 수 있다. */
export function AttachmentThumbs({ names, pathOf, onRemove, className }: { names: string[]; pathOf: (name: string) => string; onRemove?: (name: string) => void; className?: string }) {
	const [view, setView] = useState<ViewerState | null>(null);
	const openThumb = (name: string) => {
		if (!isImage(name)) return void api.open(pathOf(name));
		const shown = names.filter(isImage);
		setView({
			items: shown.map((n) => ({ url: fileUrl(pathOf(n)), name: n, path: pathOf(n) })),
			start: shown.indexOf(name),
		});
	};
	return (
		<div className={cn("flex flex-wrap gap-2", className)}>
			{view && <ImageViewer {...view} onClose={() => setView(null)} />}
			{names.map((name) => (
				<div key={name} className="relative">
					<button type="button" title={isImage(name) ? `${name} 크게 보기` : `${name} 열기`} onClick={() => openThumb(name)}>
						{isImage(name) ? (
							<img src={fileUrl(pathOf(name))} alt={name} className="h-16 w-24 rounded-md border border-border object-cover" />
						) : (
							<div className="flex h-16 w-24 items-center justify-center rounded-md border border-border px-2 text-center text-[11px] break-all text-muted-foreground">{name}</div>
						)}
					</button>
					{onRemove && (
						<button
							type="button"
							aria-label={`${name} 빼기`}
							title="빼기"
							onClick={() => onRemove(name)}
							className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-border bg-popover text-muted-foreground hover:text-foreground"
						>
							<X className="size-3" />
						</button>
					)}
				</div>
			))}
		</div>
	);
}

/** 파일을 끌고 있을 때 입력 카드 전체에 덮는다. 부모는 relative 여야 한다. */
export function DropOverlay() {
	return (
		<div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit] border-2 border-dashed border-foreground/40 bg-card/90 text-[13px] font-medium text-foreground">
			여기에 놓기
		</div>
	);
}
