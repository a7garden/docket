import { useEffect, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Row } from "./Settings";

const DEFAULT_KEY = "Ctrl+Shift+Space";
const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

/**
 * 누른 키를 단축키 글자(Ctrl+Shift+Space 꼴)로 옮긴다. Rust 쪽(global-hotkey)이 읽는 이름을 쓴다 — 글쇠는 KeyboardEvent.code 에서 Key · Digit 만 뗀다.
 * 수정 키 없이 누른 글쇠는 받지 않는다. 어디서나 듣는 키라 글자 하나를 잡으면 다른 프로그램에서 그 글자를 칠 수 없다. F 키만 예외다.
 */
function comboOf(e: KeyboardEvent): string | null {
	if (MODIFIERS.has(e.key)) return null;
	const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
	const key = e.code.replace(/^Key|^Digit/, "");
	if (!key) return null;
	if (!mods.length && !/^F\d+$/.test(key)) return null;
	return [...mods, key].join("+");
}

/** 설정 › 빠른 메모 · 트레이 의 단축키 행. 칸을 누르고 쓸 조합을 누르면 바로 저장한다. 다른 프로그램이 쓰는 조합이면 저장되지 않고 오류가 뜬다. */
export function QuickKey({ value, onSave }: { value: string; onSave: (v: string) => Promise<boolean> }) {
	const [recording, setRecording] = useState(false);
	const [problem, setProblem] = useState("");
	useEffect(() => {
		void api
			.quickKeyError()
			.then(setProblem)
			.catch(() => {});
	}, []);

	const save = async (v: string) => {
		setRecording(false);
		if (await onSave(v)) setProblem("");
	};

	const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
		if (!recording) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) return setRecording(false);
		const combo = comboOf(e);
		if (combo) void save(combo);
	};

	return (
		<Row
			label="빠른 메모 단축키"
			hint={
				problem ||
				"다른 프로그램을 쓰다가도 이 키를 누르면 작은 메모 창이 뜹니다. 적고 Ctrl+Enter 로 붙이면 창이 숨습니다. 스크린샷은 Win+Shift+S 로 찍어 붙여 넣으세요. 편집기 · 다른 메모 앱이 같은 키를 쓰면 바꾸세요."
			}
			inline
		>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={() => setRecording(true)}
					onBlur={() => setRecording(false)}
					onKeyDown={onKeyDown}
					className={cn(
						"mono h-8 min-w-40 rounded-md border border-input px-2.5 text-left text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
						recording ? "border-foreground/50 text-muted-foreground" : value ? "text-foreground" : "text-subtle",
						problem && !recording && "border-danger/60",
					)}
				>
					{recording ? "쓸 키를 누르세요" : value || "꺼짐"}
				</button>
				{value ? (
					<Button variant="ghost" size="sm" onClick={() => void save("")}>
						끄기
					</Button>
				) : (
					<Button variant="ghost" size="sm" onClick={() => void save(DEFAULT_KEY)}>
						기본값
					</Button>
				)}
			</div>
		</Row>
	);
}
