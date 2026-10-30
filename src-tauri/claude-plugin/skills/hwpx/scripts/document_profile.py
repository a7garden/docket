"""Optional presentation tokens; integrity checks are never profile-dependent."""

import json
from copy import deepcopy
from atomic_io import replace_file
from pathlib import Path
import tempfile
import zipfile
from lxml import etree
from package_inspection import NS


def tokens(spec):
    profiles = json.loads(
        (Path(__file__).resolve().parents[1] / "profiles/document.json").read_text(
            encoding="utf-8"
        )
    )
    defaults = (
        {"font": "맑은 고딕", "body_size": 11, "accent": "244A66"}
        if spec.get("style", {}).get("layout") == "technical-report"
        else {}
    )
    return {
        **defaults,
        **profiles[spec.get("profile", "default")],
        **spec.get("style", {}),
    }


def apply_profile(path: Path, spec: dict) -> dict:
    selected = tokens(spec)
    if not selected and spec["kind"] != "markdown":
        return selected
    with zipfile.ZipFile(path) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    header = etree.fromstring(
        next(d for i, d in entries if i.filename == "Contents/header.xml")
    )
    replacements = {}
    if spec["kind"] == "markdown" and selected.get("layout") != "technical-report":
        from document_model import parse_document

        headings = {
            text
            for block in parse_document(spec["markdown"], path.parent).blocks
            if block.kind in ("title", "heading")
            for text in block.texts
        }
        properties = header.find(".//hh:paraProperties", NS)
        definitions = {p.get("id"): p for p in properties.findall("hh:paraPr", NS)}
        next_id = max(int(i) for i in definitions) + 1
        kept_ids = {}

        def keep_next(paragraph):
            nonlocal next_id
            original = paragraph.get("paraPrIDRef")
            if original not in kept_ids:
                copied = deepcopy(definitions[original])
                copied.set("id", str(next_id))
                setting = copied.find("hh:breakSetting", NS)
                setting.set("keepWithNext", "1")
                setting.set("keepLines", "1")
                properties.append(copied)
                kept_ids[original] = str(next_id)
                next_id += 1
            paragraph.set("paraPrIDRef", kept_ids[original])

        for entry, data in entries:
            if not entry.filename.startswith(
                "Contents/section"
            ) or not entry.filename.endswith(".xml"):
                continue
            section = etree.fromstring(data)
            chain = False
            for paragraph in section.findall("hp:p", NS):
                text = "".join(
                    paragraph.xpath("./hp:run/hp:t/text()", namespaces=NS)
                ).strip()
                is_object = bool(
                    paragraph.findall(".//hp:tbl", NS)
                    or paragraph.findall(".//hp:pic", NS)
                )
                is_break = paragraph.get("pageBreak") == "1"
                heading = text in headings and not is_object
                if heading or (chain and not text and not is_object and not is_break):
                    keep_next(paragraph)
                    chain = True
                else:
                    chain = False
            replacements[entry.filename] = etree.tostring(
                section, encoding="UTF-8", xml_declaration=True
            )
        properties.set("itemCnt", str(len(properties)))
    if selected.get("font"):
        for font in header.findall(".//hh:font", NS):
            font.set("face", selected["font"])
    if spec["kind"] == "brief-report":
        body_ids = {"21", "22", "23", "24", "25"}
    elif spec["kind"] == "plan-report":
        body_ids = {"21", "22", "23", "24", "25"}
    elif spec["kind"] == "official-letter":
        import gonmun

        body_ids = {str(gonmun.CP_BODY)}
    else:
        from md2hwpx import STYLE_PROFILES

        profile = STYLE_PROFILES[spec.get("template", "report")]
        body_ids = {profile[k]["charPr"] for k in ("body", "bold") if k in profile}
    for cp in header.findall(".//hh:charPr", NS):
        if cp.get("id") in body_ids and selected.get("body_size"):
            cp.set("height", str(round(selected["body_size"] * 100)))
        elif (
            int(cp.get("height", "0")) >= 1400
            and selected.get("accent")
            and cp.get("textColor", "").upper() != "#FFFFFF"
        ):
            cp.set("textColor", "#" + selected["accent"])
    if selected.get("layout") == "technical-report":
        from technical_report import apply_layout

        sections = [
            (i.filename, etree.fromstring(data))
            for i, data in entries
            if i.filename.startswith("Contents/section") and i.filename.endswith(".xml")
        ]
        apply_layout(header, [s for _, s in sections], spec["markdown"], selected)
        replacements.update(
            {
                name: etree.tostring(s, encoding="UTF-8", xml_declaration=True)
                for name, s in sections
            }
        )
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
    try:
        with zipfile.ZipFile(temporary, "w") as z:
            for i, data in entries:
                z.writestr(
                    i,
                    etree.tostring(header, encoding="UTF-8", xml_declaration=True)
                    if i.filename == "Contents/header.xml"
                    else replacements.get(i.filename, data),
                )
        replace_file(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return selected
