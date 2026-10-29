import { useState, useSyncExternalStore } from "react";
import { Code, Eye, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * 목업 안에서는 네트워크를 막는다. 스크립트는 돌게 두지만 밖으로 요청을 보내거나 외부 파일을 끌어오지 못한다.
 * 화면(csp: null)의 정책은 srcdoc 에 이어지지 않으므로 목업 머리에 따로 단다.
 */
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:">`;

/**
 * 색을 정하지 않은 목업이 앱 테마를 따르게 문서의 color-scheme 을 앱 테마로 박는다.
 * 문서가 light 로 그려지면 iframe 요소(앱의 .dark 를 물려받아 dark)와 color-scheme 이 어긋나고, 그러면 브라우저가 iframe 뒤를 불투명한 흰색으로 칠한다.
 * 「light dark」 로 두면 안 된다. 2026.10.29 Edge 에서 iframe 문서는 앱 테마가 아니라 OS 설정을 따라 light 를 골랐다.
 */
function useScheme(): "dark" | "light" {
	return useSyncExternalStore(
		(onChange) => {
			const mo = new MutationObserver(onChange);
			mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
			return () => mo.disconnect();
		},
		() => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
	);
}

/** meta 는 head 안에 있어야 듣는다. doctype 앞에 붙이면 quirks 모드로 그려진다. 목업이 color-scheme 을 스스로 정했으면 그것을 따른다. */
function withHead(html: string, scheme: "dark" | "light") {
	const meta = CSP + (/<meta[^>]+name=["']?color-scheme/i.test(html) ? "" : `<meta name="color-scheme" content="${scheme}">`);
	const head = /<head[^>]*>/i.exec(html);
	if (head) return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length);
	const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
	if (doctype) return doctype[0] + meta + html.slice(doctype[0].length);
	return meta + html;
}

/** SVG 를 무대 가운데에 맞춰 그리는 문서로 감싼다. 크기를 밝히지 않은 SVG 는 무대를 채운다(viewBox 비율은 지킨다). */
function svgDoc(svg: string) {
	const style = `<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100%}svg:not([width]):not([height]){width:100%;height:100%}</style>`;
	return `<!doctype html><html><head>${style}</head><body>${svg}</body></html>`;
}

/**
 * 둘 다 sandbox iframe 으로 띄운다. allow-same-origin 을 주지 않으므로 목업의 스크립트가 앱 화면 · Tauri API 에 닿지 않는다.
 * SVG 는 allow-scripts 도 주지 않아 SVG 안의 스크립트가 아예 돌지 않는다. <img> 로 띄우면 currentColor 가 테마를 따르지 못해 iframe 에 넣는다.
 */
function Stage({ kind, code, fill }: { kind: "html" | "svg"; code: string; fill?: boolean }) {
	// .mockup-stage 는 레이어 밖 규칙이라 유틸리티 클래스로는 높이를 못 덮는다. 크게 보기에서는 style 로 덮는다.
	const style = fill ? { height: "auto", minHeight: 0, flex: 1, resize: "none" as const } : undefined;
	// 테마를 바꾸면 srcDoc 이 바뀌어 목업을 다시 그린다. 목업 안에서 눌러 둔 상태는 처음으로 돌아간다.
	const scheme = useScheme();
	return (
		<div className="mockup-stage" style={style}>
			{kind === "svg" ? (
				<iframe title="그림" sandbox="" srcDoc={withHead(svgDoc(code), scheme)} />
			) : (
				<iframe title="화면 목업" sandbox="allow-scripts" srcDoc={withHead(code, scheme)} />
			)}
		</div>
	);
}

/** 마크다운의 ```html · ```svg 블록. 미리 보기와 코드를 오가고, 크게 볼 수 있다. */
export function Mockup({ kind, code }: { kind: "html" | "svg"; code: string }) {
	const [view, setView] = useState<"preview" | "code">("preview");
	const [big, setBig] = useState(false);
	const label = kind === "html" ? "화면 목업" : "그림";
	return (
		<figure className="mockup">
			<div className="mockup-bar">
				<span className="flex-1">{label}</span>
				<Button size="sm" variant="ghost" onClick={() => setView(view === "code" ? "preview" : "code")}>
					{view === "code" ? <Eye /> : <Code />}
					{view === "code" ? "미리 보기" : "코드"}
				</Button>
				<Button size="icon-sm" variant="ghost" aria-label="크게 보기" title="크게 보기" onClick={() => setBig(true)}>
					<Maximize2 />
				</Button>
			</div>
			{view === "code" ? (
				<pre>
					<code>{code}</code>
				</pre>
			) : (
				<Stage kind={kind} code={code} />
			)}
			<Dialog open={big} onOpenChange={setBig}>
				<DialogContent className="flex h-[85vh] flex-col gap-3 sm:max-w-[min(1280px,calc(100%-4rem))]">
					<DialogTitle className="text-[13px] text-muted-foreground">{label}</DialogTitle>
					<Stage kind={kind} code={code} fill />
				</DialogContent>
			</Dialog>
		</figure>
	);
}
