/**
 * 산출물 표지. 화면에 보일 때만 묻는다 — 첫 쪽을 그리는 데 오래 걸릴 수 있고, 그동안은 형식 이름을 그린 대체 표지가 보인다.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { extOf, fileUrl } from "@/lib/format";
import { useThumb } from "@/lib/queries";
import type { Deliverable } from "@/lib/types";
import { cn } from "@/lib/utils";
import { docFormat, FileIcon } from "./Deliverables";

export function Cover({ project, d }: { project: string; d: Deliverable }) {
	const ref = useRef<HTMLDivElement>(null);
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el || seen) return;
		const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "200px" });
		io.observe(el);
		return () => io.disconnect();
	}, [seen]);

	const last = d.versions[d.versions.length - 1];
	const { data } = useThumb(project, d.id, last, seen);
	const [broken, setBroken] = useState("");
	const busy = !!d.job || !!d.learn;
	const image = data?.kind === "image" && data.path !== broken ? data.path : "";

	return (
		<div ref={ref} className="relative aspect-[3/4] w-full overflow-hidden rounded-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.25),2px_3px_8px_rgb(0_0_0/0.18)]">
			{image ? (
				<img src={fileUrl(image)} alt="" onError={() => setBroken(image)} className="size-full bg-white object-cover object-top" />
			) : data?.kind === "text" ? (
				<div className="size-full bg-white p-2.5 text-[8px] leading-[1.45] break-words whitespace-pre-wrap text-neutral-700 select-none">{data.text}</div>
			) : (
				<div className={cn("flex size-full flex-col items-center justify-center gap-1.5 text-subtle", last ? "bg-secondary" : "rounded-[3px] border border-dashed border-border bg-transparent")}>
					{last ? (
						<>
							<FileIcon name={last.file} className="size-7" />
							<span className="mono text-[11px] uppercase">{extOf(last.file) || docFormat(d)}</span>
						</>
					) : (
						<span className="px-2 text-center text-[12px]">아직 판 없음</span>
					)}
				</div>
			)}
			{busy && (
				<div className="absolute inset-0 grid place-items-center bg-background/60">
					<Loader2 className="size-5 animate-spin text-run" />
				</div>
			)}
		</div>
	);
}
