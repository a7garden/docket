"""Read all sections once for reference, content, asset and layout inspection."""

from __future__ import annotations
import hashlib
import re
import zipfile
from pathlib import Path
from lxml import etree

NS = {
    "hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
    "hh": "http://www.hancom.co.kr/hwpml/2011/head",
    "hc": "http://www.hancom.co.kr/hwpml/2011/core",
    "opf": "http://www.idpf.org/2007/opf/",
}


def compact(value):
    return re.sub(r"\s+", "", value)


def estimated_lines(advances, available):
    """Greedy glyph wrapping; one wide glyph cannot wrap onto two lines."""
    lines, used = 1, 0
    for advance in advances:
        if used and used + advance > max(available, 1):
            lines += 1
            used = 0
        used += advance
    return lines


def inspect_package(path: Path) -> dict:
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        parser = etree.XMLParser(resolve_entities=False, no_network=True)
        header = etree.fromstring(archive.read("Contents/header.xml"), parser)
        manifest = etree.fromstring(archive.read("Contents/content.hpf"), parser)
        sections = [
            (n, etree.fromstring(archive.read(n), parser))
            for n in sorted(names)
            if re.fullmatch(r"Contents/section\d+\.xml", n)
        ]
        items = {
            e.get("id"): e.get("href") for e in manifest.findall(".//opf:item", NS)
        }
        errors, warnings, paragraphs, image_hashes = [], [], [], []
        if len(names) != len(set(names)):
            errors.append("duplicate ZIP entry names")
        if len(items) != len(manifest.findall(".//opf:item", NS)):
            errors.append("duplicate manifest ids")
        definitions = {
            name: {e.get("id"): e for e in header.findall(".//hh:" + name, NS)}
            for name in ("charPr", "paraPr", "borderFill", "style", "tabPr")
        }
        mapping = {
            "charPrIDRef": "charPr",
            "paraPrIDRef": "paraPr",
            "borderFillIDRef": "borderFill",
            "styleIDRef": "style",
            "nextStyleIDRef": "style",
            "tabPrIDRef": "tabPr",
        }
        for kind, values in definitions.items():
            if len(values) != len(header.findall(".//hh:" + kind, NS)):
                errors.append(f"duplicate {kind} ids")
        fonts = {
            e.get("lang", "").lower(): {f.get("id") for f in e.findall("hh:font", NS)}
            for e in header.findall(".//hh:fontface", NS)
        }
        for fontref in header.findall(".//hh:fontRef", NS):
            for language, value in fontref.attrib.items():
                if language.lower() in fonts and value not in fonts[language.lower()]:
                    errors.append(f"undefined {language} font id={value}")
        for section, root in [("Contents/header.xml", header)] + sections:
            for element in root.iter():
                for attr, kind in mapping.items():
                    value = element.get(attr)
                    if value is None or (kind == "borderFill" and value == "0"):
                        continue
                    if (
                        kind == "charPr"
                        and value == "4294967295"
                        and element.tag == "{" + NS["hh"] + "}paraHead"
                    ):
                        continue  # Numbering label inherits the paragraph character style.
                    if value not in definitions[kind]:
                        errors.append(f"{section}: undefined {attr}={value}")
        tables = cells = text_cells = 0
        for section, root in sections:
            for p in root.findall(".//hp:p", NS):
                # Exclude nested paragraphs from their containing table paragraph.
                pieces = [
                    t.text or ""
                    for t in p.findall(".//hp:t", NS)
                    if next(t.iterancestors("{" + NS["hp"] + "}p"), None) is p
                ]
                value = "".join(pieces).strip()
                if value:
                    paragraphs.append(
                        {
                            "text": value,
                            "cell": bool(p.xpath("ancestor::hp:tc", namespaces=NS)),
                        }
                    )
            for img in root.findall(".//hc:img", NS):
                iid = img.get("binaryItemIDRef")
                href = items.get(iid, "")
                resolved = href if href in names else "Contents/" + href
                if (
                    not href
                    or resolved not in names
                    or not resolved.startswith("BinData/")
                ):
                    errors.append(f"{section}: unresolved image {iid} -> {href}")
                else:
                    image_hashes.append(
                        hashlib.sha256(archive.read(resolved)).hexdigest()
                    )
            for table_no, table in enumerate(root.findall(".//hp:tbl", NS), 1):
                tables += 1
                for tc in table.findall("./hp:tr/hp:tc", NS):
                    cells += 1
                    address = tc.find("hp:cellAddr", NS)
                    size = tc.find("hp:cellSz", NS)
                    width = int(size.get("width", "0")) if size is not None else 0
                    height = int(size.get("height", "0")) if size is not None else 0
                    location = dict(
                        section=section,
                        table=table_no,
                        row=address.get("rowAddr") if address is not None else "?",
                        col=address.get("colAddr") if address is not None else "?",
                        width=width,
                        height=height,
                    )
                    if width <= 0 or height <= 0:
                        warnings.append(
                            dict(
                                location,
                                type="invalid_cell_geometry",
                                message="Cell dimensions must be positive.",
                            )
                        )
                    ps = tc.findall("./hp:subList/hp:p", NS)
                    ps = [
                        p
                        for p in ps
                        if "".join(p.xpath(".//hp:t/text()", namespaces=NS)).strip()
                    ]
                    if not ps:
                        continue
                    text_cells += 1
                    margin = (
                        tc.find("hp:cellMargin", NS)
                        if tc.get("hasMargin") == "1"
                        else table.find("hp:inMargin", NS)
                    )
                    margins = {
                        side: int(margin.get(side, "0")) if margin is not None else 0
                        for side in ("left", "right", "top", "bottom")
                    }
                    available = width - margins["left"] - margins["right"]
                    needed = margins["top"] + margins["bottom"]
                    largest = 0
                    for p in ps:
                        advances, font = [], 0
                        for run in p.findall("hp:run", NS):
                            cp = definitions["charPr"].get(run.get("charPrIDRef"))
                            charheight = (
                                int(cp.get("height", "1000"))
                                if cp is not None
                                else 1000
                            )
                            font = max(font, charheight)
                            text = "".join(run.xpath("./hp:t/text()", namespaces=NS))
                            advances.extend(
                                charheight * (1 if ord(c) > 127 else 0.5) for c in text
                            )
                        largest = max(largest, font)
                        pp = definitions["paraPr"].get(p.get("paraPrIDRef"))
                        spacing = (
                            pp.find(".//hh:lineSpacing", NS) if pp is not None else None
                        )
                        ratio = (
                            int(spacing.get("value", "100")) / 100
                            if spacing is not None and spacing.get("type") == "PERCENT"
                            else 1
                        )
                        lines = estimated_lines(advances, available)
                        needed += font + max(0, lines - 1) * font * ratio
                    if available < largest * 0.25 or height < largest * 0.25:
                        warnings.append(
                            dict(
                                location,
                                type="invalid_cell_geometry",
                                message="Text cell is smaller than a readable glyph.",
                            )
                        )
                    elif needed > height * 1.2:
                        warnings.append(
                            dict(
                                location,
                                type="estimated_cell_overflow",
                                estimated_height=round(needed),
                                message="Estimated text height exceeds cell; confirm auto-growth and page flow in Hancom.",
                            )
                        )
        return dict(
            errors=list(dict.fromkeys(errors)),
            paragraphs=paragraphs,
            image_hashes=image_hashes,
            layout=dict(
                tables=tables, cells=cells, text_cells=text_cells, warnings=warnings
            ),
            sections=len(sections),
            pagebreaks=sum(
                len(r.xpath('.//hp:p[@pageBreak="1"]', namespaces=NS))
                for _, r in sections
            ),
        )


def check_content(package: dict, expected: list[dict], images: list[Path]) -> dict:
    missing, cursor, offset = [], 0, 0
    actual = package["paragraphs"]
    for item in expected:
        matches = []
        needle = compact(item["text"])
        for i in range(cursor, len(actual)):
            start = offset if i == cursor else 0
            pos = compact(actual[i]["text"]).find(needle, start)
            if pos >= 0 and (item["kind"] != "table" or actual[i]["cell"]):
                matches.append((i, pos))
                break
        if not matches:
            missing.append(item)
        else:
            cursor, position = matches[0]
            offset = position + len(needle)
    hashes = list(package["image_hashes"])
    absent_images = []
    for path in images:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in hashes:
            hashes.remove(digest)
        else:
            absent_images.append(str(path))
    return dict(
        ok=not missing and not absent_images,
        expected_blocks=len(expected),
        missing=missing,
        missing_images=absent_images,
    )
