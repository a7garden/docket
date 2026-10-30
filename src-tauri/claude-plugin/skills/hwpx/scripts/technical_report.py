"""Opt-in typography for newly generated markdown/report documents.

Works on the builder's current style roles, not arbitrary user-owned HWPX forms.
No text, table geometry, images, explicit page breaks, or source facts are changed.
"""

import re
from copy import deepcopy

from lxml import etree as E
from md2hwpx import STYLE_PROFILES
from package_inspection import NS
from source_report import code_lines, fenced_blocks


def text(paragraph):
    return "".join(paragraph.xpath("./hp:run/hp:t/text()", namespaces=NS))


def apply_layout(header, sections, markdown, settings):
    roles = STYLE_PROFILES["report"]
    chars = {p.get("id"): p for p in header.findall(".//hh:charPr", NS)}
    props = header.find(".//hh:paraProperties", NS)
    paras = {p.get("id"): p for p in props}
    before = [
        [text(p) for p in s.findall(".//hp:p", NS) if text(p).strip()] for s in sections
    ]

    def paragraph(
        base="0",
        *,
        align="LEFT",
        spacing=150,
        prev=0,
        after=400,
        keep=False,
        lines=False,
        latin="KEEP_WORD",
    ):
        p = deepcopy(paras[base])
        pid = str(max(int(x.get("id")) for x in props) + 1)
        p.set("id", pid)
        p.set("snapToGrid", "0")
        p.find("hh:align", NS).set("horizontal", align)
        setting = p.find("hh:breakSetting", NS)
        for key, value in {
            "breakLatinWord": latin,
            "keepWithNext": str(int(keep)),
            "keepLines": str(int(lines)),
            "widowOrphan": "1",
        }.items():
            setting.set(key, value)
        for element in p.findall(".//hh:lineSpacing", NS):
            element.set("type", "PERCENT")
            element.set("value", str(spacing))
        for name, value in [("prev", prev), ("next", after)]:
            for element in p.findall(".//hc:" + name, NS):
                element.set("value", str(value))
        props.append(p)
        props.set("itemCnt", str(len(props)))
        return pid

    def character(base, **attributes):
        cp = deepcopy(chars[base])
        container = chars[base].getparent()
        identifier = str(max(int(x.get("id")) for x in container) + 1)
        cp.set("id", identifier)
        for key, value in attributes.items():
            cp.set(key, value)
        container.append(cp)
        container.set("itemCnt", str(len(container)))
        return cp

    latin_fonts = next(
        f for f in header.findall(".//hh:fontface", NS) if f.get("lang") == "LATIN"
    )
    font = deepcopy(latin_fonts[0])
    font_id = str(max(int(f.get("id")) for f in latin_fonts) + 1)
    font.set("id", font_id)
    font.set("face", settings.get("code_font", "Consolas"))
    latin_fonts.append(font)
    latin_fonts.set("fontCnt", str(len(latin_fonts)))
    code_cp = character(roles["small"]["charPr"], height="900")
    code_cp.find("hh:fontRef", NS).set("latin", font_id)
    caption_cp = character(
        roles["body"]["charPr"],
        height="1000",
        textColor="#" + settings.get("accent", "244A66"),
    )
    if caption_cp.find("hh:bold", NS) is None:
        E.SubElement(caption_cp, "{" + NS["hh"] + "}bold")
    chars[roles["title"]["charPr"]].set("height", "1800")

    body = paragraph(after=450)
    heading = paragraph(spacing=140, prev=750, after=250, keep=True, lines=True)
    title = paragraph(align="CENTER", spacing=145, after=1100, keep=True, lines=True)
    reference = paragraph(spacing=140, after=350, lines=True, latin="BREAK_WORD")
    meta = paragraph(spacing=140, after=350, lines=True)
    caption = paragraph(spacing=140, prev=450, after=200, keep=True, lines=True)
    ref_label = paragraph(spacing=140, prev=400, after=50, keep=True, lines=True)
    code = paragraph(spacing=120, after=0, lines=True, latin="BREAK_WORD")
    code_keep = paragraph(
        spacing=120, after=0, keep=True, lines=True, latin="BREAK_WORD"
    )
    code_end = paragraph(spacing=120, after=500, lines=True, latin="BREAK_WORD")
    code_paragraphs = []
    heading_ids = {roles[key]["charPr"] for key in ("h2", "h3", "h4")}
    for section in sections:
        for p in list(section.findall("hp:p", NS)):
            value = text(p)
            runs = p.findall("hp:run", NS)
            refs = {r.get("charPrIDRef") for r in runs}
            objects = any(
                p.findall(".//hp:" + kind, NS)
                for kind in ("tbl", "pic", "ctrl", "secPr")
            )
            # Quotes share the small character style, but not its paragraph role.
            if (
                refs == {roles["small"]["charPr"]}
                and p.get("paraPrIDRef") == roles["small"]["paraPr"]
                and not objects
            ):
                p.set("paraPrIDRef", code)
                for run in runs:
                    run.set("charPrIDRef", code_cp.get("id"))
                code_paragraphs.append(p)
            elif (
                not value.strip()
                and not objects
                and p.get("pageBreak", "0") == "0"
                and p.get("columnBreak", "0") == "0"
            ):
                section.remove(p)
            elif objects:
                continue
            elif refs == {roles["title"]["charPr"]}:
                p.set("paraPrIDRef", title)
            elif refs & heading_ids:
                p.set("paraPrIDRef", heading)
            elif re.match(r"^(?:도식|그림|표|Figure|Table)\s+\d+[.:]", value):
                p.set("paraPrIDRef", caption)
                for run in runs:
                    run.set("charPrIDRef", caption_cp.get("id"))
            elif value.startswith(
                ("원문 제목:", "원문:", "저자:", "Source:", "Authors:")
            ):
                p.set("paraPrIDRef", meta)
            elif re.match(r"^https?://", value):
                p.set("paraPrIDRef", reference)
            elif re.match(r"^\[\d+\]", value):
                p.set("paraPrIDRef", ref_label)
            elif value.strip() and p.get("paraPrIDRef") == roles["body"]["paraPr"]:
                p.set("paraPrIDRef", body)
    cursor = 0
    for block in fenced_blocks(markdown):
        lines = code_lines(block)
        group = code_paragraphs[cursor : cursor + len(lines)]
        if [text(p).rstrip() for p in group] != lines:
            raise ValueError(
                "technical-report: code paragraphs do not match source order/indentation"
            )
        for i, p in enumerate(group):
            if i < len(group) - 1 and (
                len(group) <= 20 or i < 3 or text(p).endswith(":")
            ):
                p.set("paraPrIDRef", code_keep)
        if group:
            group[-1].set("paraPrIDRef", code_end)
        cursor += len(lines)
    if cursor != len(code_paragraphs):
        raise ValueError("technical-report: unaccounted code paragraphs")
    after = [
        [text(p) for p in s.findall(".//hp:p", NS) if text(p).strip()] for s in sections
    ]
    if before != after:
        raise ValueError("technical-report: paragraph text changed during typography")
