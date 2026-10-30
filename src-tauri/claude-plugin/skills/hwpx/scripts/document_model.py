"""Shared source interpretation and content-preservation expectations."""

from __future__ import annotations
import html
import re
from dataclasses import dataclass, field
from pathlib import Path


def split_front_matter(text: str) -> tuple[dict[str, str], str, int]:
    lines = text.removeprefix("\ufeff").splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text, 0
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise ValueError("frontmatter: missing closing ---")
    meta = {}
    for index, line in enumerate(lines[1:end], 2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line or line.startswith((" ", "\t")):
            raise ValueError(f"frontmatter line {index}: expected key: value")
        key, value = line.split(":", 1)
        if key.strip() in meta:
            raise ValueError(f"frontmatter line {index}: duplicate {key.strip()}")
        meta[key.strip()] = value.strip()
    return meta, "\n".join(lines[end + 1 :]), end + 1


def display_text(text: str) -> str:
    for marker in ("**", "__", "++", "==", "!!"):
        text = re.sub(re.escape(marker) + r"(.+?)" + re.escape(marker), r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\*([^*]+)\*", r"\1", text)
    text = re.sub(r"(?<!!)\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return html.unescape(text).strip()


@dataclass
class Block:
    kind: str
    line: int
    texts: list[str] = field(default_factory=list)
    source: Path | None = None


@dataclass
class Document:
    title: str
    metadata: dict[str, str]
    blocks: list[Block]
    body: str

    @property
    def images(self) -> list[Path]:
        return [b.source for b in self.blocks if b.source is not None]

    @property
    def expected(self) -> list[dict]:
        return [
            dict(id=f"L{b.line}:{i}", kind=b.kind, text=t)
            for b in self.blocks
            for i, t in enumerate(b.texts)
            if t
        ]


def parse_document(text: str, base: Path) -> Document:
    meta, body, offset = split_front_matter(text)
    blocks, title = [], ""
    code = False
    for no, raw in enumerate(body.splitlines(), offset + 1):
        s = raw.strip()
        if not s:
            continue
        if s.startswith("```"):
            code = not code
            continue
        if code:
            blocks.append(Block("code", no, [s]))
            continue
        if s == "---":
            blocks.append(Block("pagebreak", no))
            continue
        heading = re.match(r"^(#{1,4})\s+(.+)$", s)
        if heading:
            value = display_text(heading[2])
            kind = "title" if heading[1] == "#" else "heading"
            if kind == "title":
                if title:
                    raise ValueError(f"line {no}: only one document title is supported")
                title = value
            blocks.append(Block(kind, no, [value]))
            continue
        image = re.fullmatch(r"!\[([^\]]*)\]\(([^)]+)\)", s)
        if image:
            value = image[2].strip().strip("<>")
            if "://" in value or value.startswith("data:"):
                raise ValueError(f"line {no}: images must be local, fixed assets")
            blocks.append(Block("image", no, [], (base / Path(value)).resolve()))
            continue
        if "![" in s:
            raise ValueError(f"line {no}: use a standalone image block")
        if re.search(r"\[\^|\$\$|<\/?(?:table|div|img|svg)\b", s):
            raise ValueError(
                f"line {no}: unsupported footnote, equation or HTML; use the dedicated editor workflow"
            )
        if re.search(r"(?<!!)\[[^\]]+\]\([^)]+\)", s):
            raise ValueError(
                f"line {no}: hyperlink destinations are not supported by this generator"
            )
        if s.startswith("|") and s.endswith("|"):
            cells = [c.strip() for c in s.strip("|").split("|")]
            if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                continue
            blocks.append(Block("table", no, [display_text(c) for c in cells]))
            continue
        kind = "quote" if s.startswith(">") else "paragraph"
        s = re.sub(r"^(?:>\s*|[-*]\s+|(?:⇒|=>)\s*|※\s*)", "", s)
        blocks.append(Block(kind, no, [display_text(s)]))
    if code:
        raise ValueError("markdown: unclosed code fence")
    return Document(title, meta, blocks, body)
