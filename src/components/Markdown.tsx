import { memo, useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "@/lib/api";
import { fileUrl, isUnder, resolveImage } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ImageViewer, type ViewerState } from "./ImageViewer";
import { Mockup } from "./Mockup";

/** hast 노드 중 여기서 읽는 것만. 타입 패키지를 따로 들이지 않는다. */
interface HNode {
	type: string;
	tagName?: string;
	value?: string;
	properties?: { className?: unknown };
	children?: HNode[];
}

const PLUGINS = [remarkGfm];

/**
 * 그림 주소는 거르지 않고 resolveImage 에 맡긴다. 기본 거름은 `D:\…` 의 `D:` 를 허용되지 않은 프로토콜로 보고 주소를 비운다.
 * 그러면 절대 경로 그림이 「그림을 열 수 없습니다 · 저장소 루트」로 깨진다. 링크는 기본 거름을 그대로 쓴다.
 */
const urlTransform: UrlTransform = (url, key) => (key === "src" ? url : defaultUrlTransform(url));

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
	const [view, setView] = useState<ViewerState | null>(null);
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
	if (!direct && !path) return <span className="img-missing">그림 주소가 비어 있습니다{alt && ` · ${alt}`}</span>;
	if (broken) return <span className="img-missing">그림을 열 수 없습니다 · {path ?? src}</span>;
	if (!url) return null;
	return (
		<>
			<button
				type="button"
				className="md-image"
				title="크게 보기"
				onClick={(e) => {
					// 링크를 건 그림은 링크가 받는다. 눌러서 페이지를 여는 배지 같은 것이다.
					if (e.currentTarget.closest("a")) return;
					e.stopPropagation();
					setView(imageGroup(e.currentTarget));
				}}
			>
				<img src={url} alt={alt} loading="lazy" data-path={path} onError={() => setBroken(true)} />
			</button>
			{view && <ImageViewer {...view} onClose={() => setView(null)} />}
		</>
	);
}

/**
 * 누른 그림과 같은 묶음의 그림을 화면 순서대로 모은다. 묶음은 가장 가까운 `data-image-group`, 없으면 그 글 하나다.
 * Markdown 은 memo 라 렌더 중에 등록하면 순서를 따로 맞춰야 한다. DOM 은 곧 화면 순서이고, 깨진 그림은 아예 없다.
 */
function imageGroup(button: HTMLElement): ViewerState {
	const root = button.closest("[data-image-group]") ?? button.closest(".prose-docket");
	const imgs = [...(root?.querySelectorAll<HTMLImageElement>(".md-image img") ?? [])].filter((i) => !i.closest("a"));
	const items = imgs.map((i) => ({ url: i.src, name: i.alt || (i.dataset.path ?? i.src).split(/[\\/]/).pop() || "그림", path: i.dataset.path }));
	return { items, start: Math.max(0, imgs.indexOf(button.querySelector("img")!)) };
}

/**
 * base 를 주면 `attachments/그림.png` · `shots/…` 같은 상대 경로 그림을 그 폴더 기준으로 띄운다. root(저장소)를 주면 나머지 상대 경로는 저장소 기준이다.
 * ```html · ```svg 블록은 미리 보기로 그린다. 계획 · 대화에서 화면 설계를 글로만 읽고 판단하기 어렵다.
 * 링크는 웹뷰 안에서 열리지 않게 막고 기본 브라우저로 넘긴다. 앱 창이 그 페이지로 넘어가 버리면 돌아올 길이 없다.
 */
export const Markdown = memo(function Markdown({ text, base, root, className }: { text: string; base?: string; root?: string; className?: string }) {
	// react-markdown 은 이 함수들을 컴포넌트 타입으로 쓴다. 렌더마다 새로 만들면 타입이 바뀌어 목업 iframe · 그림이 통째로 새로 마운트되고,
	// 대화 입력칸에 글자 하나를 칠 때마다 깜빡인다. 그래서 base · root 가 같으면 같은 함수를 넘긴다.
	const components = useMemo<Components>(
		() => ({
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
		}),
		[base, root],
	);
	return (
		<div className={cn("prose-docket", className)}>
			<ReactMarkdown remarkPlugins={PLUGINS} components={components} urlTransform={urlTransform}>
				{text}
			</ReactMarkdown>
		</div>
	);
});
