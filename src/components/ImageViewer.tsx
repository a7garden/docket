import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useKey } from "@/lib/keys";

export interface ViewerItem {
	url: string;
	name: string;
	/** 있으면 기본 프로그램으로 열 수 있다. 웹 주소 그림에는 없다. */
	path?: string;
}

/** 연 순간의 묶음을 그대로 쥔다. 뒤에서 답이 이어지거나 초안이 비어도 보던 자리가 밀리지 않는다. */
export interface ViewerState {
	items: ViewerItem[];
	start: number;
}

/** 위에 다른 창(? 표 · 메뉴)이 떴으면 그 창의 키다. 이 창의 키는 뒤 화면을 막는 검사를 건너뛰므로 직접 본다. */
function onTop() {
	const all = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]');
	return !!all[all.length - 1]?.hasAttribute("data-image-viewer");
}

/**
 * 그림 묶음을 크게 보며 ← → 로 넘긴다. 끝에서는 처음으로 돈다 — 끝에서 멈추면 키가 먹지 않은 것처럼 보인다.
 * 창은 그림을 그린 컴포넌트 안에서 띄운다. 옆 칸 대화를 띄워 상세 창이 비모달일 때도 React 트리 안이라 상세 창이 바깥 조작으로 알고 닫히지 않는다.
 */
export function ImageViewer({ items, start, onClose }: ViewerState & { onClose: () => void }) {
	const [at, setAt] = useState(start);
	const [broken, setBroken] = useState<string | null>(null);
	const opener = useRef(document.activeElement as HTMLElement | null);
	const item = items[at];
	const many = items.length > 1;
	const step = (dir: 1 | -1) => {
		if (!onTop()) return false;
		setAt((i) => (i + dir + items.length) % items.length);
	};
	useKey({ id: "viewer.prev", combo: "ArrowLeft", label: "이전 그림", group: "대화", series: "viewer", enabled: many, overModal: true, run: () => step(-1) });
	useKey({ id: "viewer.next", combo: "ArrowRight", label: "다음 그림", group: "대화", series: "viewer", enabled: many, overModal: true, run: () => step(1) });

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent
				data-image-viewer=""
				// 열리자마자 닫기 단추에 초점 테두리가 생기면 그림보다 단추가 먼저 눈에 띈다. 창 자체에 초점을 둔다.
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					(e.currentTarget as HTMLElement | null)?.focus();
				}}
				// 트리거 없이 연 모달은 닫힐 때 초점을 body 로 흘린다. 누른 그림으로 돌려줘야 키보드로 이어 간다.
				onCloseAutoFocus={(e) => {
					e.preventDefault();
					opener.current?.focus();
				}}
				// 포털이어도 React 사건은 그림을 그린 쪽으로 올라간다. 창 안을 누른 것이 뒤 화면의 클릭이 되지 않게 한다.
				onClick={(e) => e.stopPropagation()}
				className="pop flex h-[85vh] flex-col gap-3 outline-none sm:max-w-[min(1280px,calc(100%-4rem))]"
			>
				<div className="flex min-w-0 items-center gap-3 pr-8">
					<DialogTitle className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" title={item.name}>
						{item.name}
					</DialogTitle>
					<DialogDescription className="sr-only">그림 크게 보기</DialogDescription>
					{many && (
						<span className="shrink-0 text-[12px] text-subtle tabular-nums">
							{at + 1} / {items.length}
						</span>
					)}
					{item.path && (
						<Button size="sm" variant="ghost" onClick={() => void api.open(item.path!)}>
							<ExternalLink />
							기본 프로그램으로 열기
						</Button>
					)}
				</div>
				<div className="flex min-h-0 flex-1 items-center gap-2">
					{many && (
						<Button size="icon-sm" variant="ghost" aria-label="이전 그림" title="이전 그림 (←)" onClick={() => step(-1)}>
							<ChevronLeft />
						</Button>
					)}
					<div className="flex h-full min-w-0 flex-1 items-center justify-center">
						{broken === item.url ? (
							<span className="text-[13px] break-all text-subtle">그림을 열 수 없습니다 · {item.path ?? item.url}</span>
						) : (
							<img src={item.url} alt={item.name} onError={() => setBroken(item.url)} className="max-h-full max-w-full rounded-md object-contain" />
						)}
					</div>
					{many && (
						<Button size="icon-sm" variant="ghost" aria-label="다음 그림" title="다음 그림 (→)" onClick={() => step(1)}>
							<ChevronRight />
						</Button>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
