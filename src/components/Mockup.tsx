import { useState } from "react";
import { Code, Eye, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * 목업 안에서는 네트워크를 막는다. 스크립트는 돌게 두지만 밖으로 요청을 보내거나 외부 파일을 끌어오지 못한다.
 * 화면(csp: null)의 정책은 srcdoc 에 이어지지 않으므로 목업 머리에 따로 단다.
 */
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:">`;

/** CSP meta 는 head 안에 있어야 듣는다. doctype 앞에 붙이면 quirks 모드로 그려진다. */
function withCsp(html: string) {
	const head = /<head[^>]*>/i.exec(html);
	if (head) return html.slice(0, head.index + head[0].length) + CSP + html.slice(head.index + head[0].length);
	const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
	if (doctype) return doctype[0] + CSP + html.slice(doctype[0].length);
	return CSP + html;
}

function svgUrl(svg: string) {
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * HTML 은 sandbox iframe 으로 띄운다. allow-same-origin 을 주지 않으므로 목업의 스크립트가 앱 화면 · Tauri API 에 닿지 않는다.
 * SVG 는 <img> 로 띄운다. 그렇게 띄우면 SVG 안의 스크립트가 아예 돌지 않는다.
 */
function Stage({ kind, code, fill }: { kind: "html" | "svg"; code: string; fill?: boolean }) {
	// .mockup-stage 는 레이어 밖 규칙이라 유틸리티 클래스로는 높이를 못 덮는다. 크게 보기에서는 style 로 덮는다.
	const style = fill ? { height: "auto", minHeight: 0, flex: 1, resize: "none" as const } : undefined;
	if (kind === "svg") {
		return (
			<div className="mockup-stage svg" style={style}>
				<img src={svgUrl(code)} alt="그림" />
			</div>
		);
	}
	return (
		<div className="mockup-stage" style={style}>
			<iframe title="화면 목업" sandbox="allow-scripts" srcDoc={withCsp(code)} />
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
