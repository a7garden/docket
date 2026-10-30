import type { ReactNode } from "react";
import { Copy, ExternalLink, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { api, errorText } from "@/lib/api";
import { useCommands } from "@/lib/keys";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "./ui/context-menu";
import { DropdownMenuItem, DropdownMenuSeparator } from "./ui/dropdown-menu";

/**
 * 메뉴 항목 하나. 「더 보기」 드롭다운과 우클릭 메뉴가 같은 목록을 그린다.
 * Radix 의 두 Item 은 다른 컴포넌트라 JSX 를 따로 쓰면 한쪽에만 항목이 생기거나 조건이 어긋난다.
 */
export interface Action {
	label: string;
	icon?: ReactNode;
	onSelect: () => void;
	disabled?: boolean;
	destructive?: boolean;
}

/** `"sep"` 은 구분선. 조건에 따라 빠지는 항목은 `false` 로 둔다. */
export type ActionList = (Action | "sep" | false | null | undefined)[];

/** 빠진 항목을 걷고, 맨 앞 · 맨 뒤 · 겹친 구분선을 지운다. 조건부 항목이 빠질 때마다 빈 칸이 생기지 않게. */
function tidy(list: ActionList): (Action | "sep")[] {
	const out: (Action | "sep")[] = [];
	for (const a of list) {
		if (!a) continue;
		if (a === "sep" && (out.length === 0 || out[out.length - 1] === "sep")) continue;
		out.push(a);
	}
	if (out[out.length - 1] === "sep") out.pop();
	return out;
}

/** 메뉴의 항목을 Ctrl+K 에도 싣는다. 목록을 하나만 두어 메뉴와 Ctrl+K 가 어긋나지 않게 한다. `sub` 는 어디의 동작인지 보이는 글자다. */
export function useActionCommands(items: ActionList, sub: string) {
	useCommands(tidy(items).flatMap((a) => (a === "sep" ? [] : [{ label: a.label, sub, disabled: a.disabled, onSelect: a.onSelect }])));
}

/** 드롭다운 안에 넣는다. 단추 · 메뉴 틀은 부르는 곳이 정한다. */
export function DropdownActions({ items }: { items: ActionList }) {
	return (
		<>
			{tidy(items).map((a, n) =>
				a === "sep" ? (
					<DropdownMenuSeparator key={n} />
				) : (
					<DropdownMenuItem key={n} variant={a.destructive ? "destructive" : "default"} disabled={a.disabled} onSelect={a.onSelect}>
						{a.icon}
						{a.label}
					</DropdownMenuItem>
				),
			)}
		</>
	);
}

/**
 * 자식을 우클릭하면 메뉴를 연다. 자식의 태그 · 클래스 · 이벤트는 그대로 둔다(asChild).
 * 메뉴는 자식 밖(포털)에 그려지고 React 트리에서도 자식의 형제라, 항목을 눌러도 자식의 onClick 이 불리지 않는다.
 */
export function ContextActions({ items, children, className = "w-52" }: { items: ActionList; children: ReactNode; className?: string }) {
	const list = tidy(items);
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild disabled={list.length === 0}>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent className={`pop ${className}`}>
				{list.map((a, n) =>
					a === "sep" ? (
						<ContextMenuSeparator key={n} />
					) : (
						<ContextMenuItem key={n} variant={a.destructive ? "destructive" : "default"} disabled={a.disabled} onSelect={a.onSelect}>
							{a.icon}
							{a.label}
						</ContextMenuItem>
					),
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
}

/** 받침이 있으면 「을」, 없거나 한글이 아니면 「를」. 「제목를」 · 「명령를」 같은 알림이 뜨지 않게. */
function eul(word: string) {
	const c = word.charCodeAt(word.length - 1) - 0xac00;
	return c >= 0 && c <= 11171 && c % 28 ? "을" : "를";
}

export async function copy(text: string, what: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast(`${what}${eul(what)} 복사했습니다`);
	} catch (e) {
		toast.error(errorText(e));
	}
}

/** 파일 하나를 가리키는 줄의 공통 항목. 판 · 첨부 · 템플릿 · 바뀐 파일이 같은 말과 순서로 보인다. */
export function fileActions(path: string): ActionList {
	return [
		{ label: "열기", icon: <ExternalLink />, onSelect: () => void attempt(() => api.open(path)) },
		{ label: "폴더에서 보기", icon: <FolderOpen />, onSelect: () => void attempt(() => api.reveal(path)) },
		{ label: "경로 복사", icon: <Copy />, onSelect: () => void copy(path, "경로") },
	];
}

/** 메뉴에서 부른 동작이 실패하면 토스트로 알린다. 메뉴는 이미 닫혀 있어 그 자리에 보일 곳이 없다. */
export async function attempt(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (e) {
		toast.error(errorText(e));
	}
}
