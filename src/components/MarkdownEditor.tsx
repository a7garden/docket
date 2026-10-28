import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import CodeMirror, { EditorView, keymap, Prec, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { cn } from "@/lib/utils";

export interface EditorHandle {
	insert: (text: string) => void;
	focus: () => void;
}

interface Props {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	autoFocus?: boolean;
	minHeight?: string;
	maxHeight?: string;
	className?: string;
	/** Ctrl+Enter */
	onSubmit?: () => void;
	/** Ctrl+S */
	onSave?: () => void;
	onBlur?: () => void;
	/** 붙여 넣은 이미지를 저장하고 끼울 마크다운을 돌려준다 */
	onPasteImage?: (file: File) => Promise<string | null>;
	/** 마크다운이 아닌 파일(스킬 폴더의 스크립트 등)은 고정폭으로만 보인다 */
	plain?: boolean;
	readOnly?: boolean;
}

const highlight = HighlightStyle.define([
	{ tag: t.heading1, fontWeight: "700", fontSize: "1.2em" },
	{ tag: t.heading2, fontWeight: "700", fontSize: "1.08em" },
	{ tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "650" },
	{ tag: t.strong, fontWeight: "700" },
	{ tag: t.emphasis, fontStyle: "italic" },
	{ tag: t.strikethrough, textDecoration: "line-through" },
	{ tag: t.link, textDecoration: "underline" },
	{ tag: t.url, color: "var(--subtle)" },
	{ tag: t.monospace, fontFamily: "var(--font-mono)", fontSize: "0.92em", color: "var(--muted-foreground)" },
	{ tag: t.quote, color: "var(--muted-foreground)" },
	{ tag: [t.processingInstruction, t.contentSeparator, t.meta], color: "var(--subtle)" },
	{ tag: [t.keyword, t.operatorKeyword, t.controlKeyword], fontWeight: "600" },
	{ tag: [t.string, t.special(t.string)], color: "var(--muted-foreground)" },
	{ tag: [t.number, t.bool, t.atom], color: "var(--foreground)" },
	{ tag: [t.comment, t.lineComment, t.blockComment], color: "var(--subtle)", fontStyle: "italic" },
	{ tag: [t.propertyName, t.attributeName], color: "var(--foreground)" },
	{ tag: [t.typeName, t.className], fontWeight: "600" },
]);

const baseTheme = EditorView.theme({
	"&": { fontSize: "14px", color: "var(--foreground)" },
	".cm-scroller": { overflow: "auto" },
	".cm-gutters": { display: "none" },
});

function insertAt(view: EditorView, text: string) {
	const { from, to } = view.state.selection.main;
	// 줄 가운데에 그림을 끼우면 문장이 끊긴다. 줄 끝이 아니면 앞뒤로 줄을 띄운다.
	const line = view.state.doc.lineAt(from);
	const before = from > line.from ? "\n" : "";
	const after = to < line.to ? "\n" : "";
	const insert = before + text + after;
	view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true });
	view.focus();
}

export const MarkdownEditor = forwardRef<EditorHandle, Props>(function MarkdownEditor(
	{ value, onChange, placeholder, autoFocus, minHeight = "120px", maxHeight, className, onSubmit, onSave, onBlur, onPasteImage, plain, readOnly },
	ref,
) {
	const cm = useRef<ReactCodeMirrorRef>(null);
	// 확장은 한 번만 만든다. 콜백이 바뀔 때마다 확장을 다시 만들면 편집기가 통째로 다시 그려진다.
	const cbs = useRef({ onSubmit, onSave, onBlur, onPasteImage });
	cbs.current = { onSubmit, onSave, onBlur, onPasteImage };

	useImperativeHandle(ref, () => ({
		insert: (text) => {
			const view = cm.current?.view;
			if (view) insertAt(view, text);
		},
		focus: () => cm.current?.view?.focus(),
	}));

	const extensions = useMemo(
		() => [
			baseTheme,
			EditorView.lineWrapping,
			...(plain ? [] : [markdown({ base: markdownLanguage, codeLanguages: languages }), syntaxHighlighting(highlight)]),
			Prec.highest(
				keymap.of([
					{
						key: "Mod-Enter",
						run: () => {
							if (!cbs.current.onSubmit) return false;
							cbs.current.onSubmit();
							return true;
						},
					},
					{
						key: "Mod-s",
						preventDefault: true,
						run: () => {
							cbs.current.onSave?.();
							return true;
						},
					},
				]),
			),
			EditorView.domEventHandlers({
				paste: (event, view) => {
					const paste = cbs.current.onPasteImage;
					const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
					if (!paste || files.length === 0) return false;
					event.preventDefault();
					void (async () => {
						for (const f of files) {
							const md = await paste(f);
							if (md) insertAt(view, md);
						}
					})();
					return true;
				},
				blur: () => {
					cbs.current.onBlur?.();
					return false;
				},
			}),
		],
		[plain],
	);

	return (
		<div className={cn("cm-docket selectable", plain && "cm-code", className)}>
			<CodeMirror
				ref={cm}
				value={value}
				onChange={onChange}
				extensions={extensions}
				placeholder={placeholder}
				autoFocus={autoFocus}
				editable={!readOnly}
				minHeight={minHeight}
				maxHeight={maxHeight}
				theme="none"
				basicSetup={{
					lineNumbers: false,
					foldGutter: false,
					highlightActiveLine: false,
					highlightActiveLineGutter: false,
					autocompletion: false,
					closeBrackets: false,
					bracketMatching: false,
					indentOnInput: false,
					syntaxHighlighting: false,
				}}
			/>
		</div>
	);
});
