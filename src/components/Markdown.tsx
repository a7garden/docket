import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@/lib/api";
import { fileUrl, isUnder, resolveImage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Mockup } from "./Mockup";

/** hast 노드 중 여기서 읽는 것만. 타입 패키지를 따로 들이지 않는다. */
interface HNode {
	type: string;
	tagName?: string;
	value?: string;
	properties?: { className?: unknown };
	children?: HNode[];
}

function textOf(n: HNode): string {
	return n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join("");
}

/** 같은 그림을 그릴 때마다 명령을 부르지 않는다. 한 번 연 파일은 앱을 끌 때까지 범위에 남는다. */
const opened = new Map<string, Promise<string>>();
function openAsset(path: string) {
	const key = path.toLowerCase();
	let p = opened.get(key);
	if (!p) {
		p = api.assetAllow(path).catch(() => "");
		opened.set(key, p);
	}
	return p;
}

/**
 * base(이슈 폴더 등) 안의 그림은 이미 asset 범위에 있어 바로 띄운다.
 * 그 밖(저장소 안 그림)은 띄우기 전에 그 파일 하나만 범위에 연다.
 */
function MdImage({ src, alt, base, root }: { src: string; alt: string; base?: string; root?: string }) {
	const { url: direct, path } = resolveImage(src, base, root);
	const ready = direct ?? (path && base && isUnder(path, base) ? fileUrl(path) : undefined);
	const [url, setUrl] = useState(ready);
	const [broken, setBroken] = useState(false);
	useEffect(() => {
		setBroken(false);
		if (ready || !path) {
			setUrl(ready);
			return;
		}
		setUrl(undefined);
		let live = true;
		void openAsset(path).then((real) => live && setUrl(fileUrl(real || path)));
		return () => {
			live = false;
		};
	}, [ready, path]);
	if (broken) return <span className="img-missing">그림을 열 수 없습니다 · {path ?? src}</span>;
	if (!url) return null;
	return <img src={url} alt={alt} loading="lazy" onError={() => setBroken(true)} />;
}

/**
 * base 를 주면 `attachments/그림.png` · `shots/…` 같은 상대 경로 그림을 그 폴더 기준으로 띄운다. root(저장소)를 주면 나머지 상대 경로는 저장소 기준이다.
 * ```html · ```svg 블록은 미리 보기로 그린다. 계획 · 대화에서 화면 설계를 글로만 읽고 판단하기 어렵다.
 * 링크는 웹뷰 안에서 열리지 않게 막고 기본 브라우저로 넘긴다. 앱 창이 그 페이지로 넘어가 버리면 돌아올 길이 없다.
 */
export function Markdown({ text, base, root, className }: { text: string; base?: string; root?: string; className?: string }) {
	return (
		<div className={cn("prose-docket", className)}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ href, children }) => (
						<a
							href={href}
							onClick={(e) => {
								e.preventDefault();
								if (href && /^(https?:|mailto:)/i.test(href)) void openUrl(href);
							}}
						>
							{children}
						</a>
					),
					img: ({ src, alt }) => {
						const s = typeof src === "string" ? src : "";
						return <MdImage key={s} src={s} alt={alt ?? ""} base={base} root={root} />;
					},
					// 인라인 code 와 블록 code 는 pre 로만 가른다. react-markdown 10 에는 inline 표지가 없다.
					pre: ({ node, children }) => {
						const code = (node as HNode | undefined)?.children?.find((c) => c.tagName === "code");
						const cls = code?.properties?.className;
						const lang = Array.isArray(cls) ? cls.map(String).find((c) => c.startsWith("language-"))?.slice(9) : undefined;
						if (code && (lang === "html" || lang === "svg")) return <Mockup kind={lang} code={textOf(code).replace(/\n$/, "")} />;
						return <pre>{children}</pre>;
					},
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}
