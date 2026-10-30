"""Editable, bounded table diagrams. No screenshots or caller-supplied XML."""

from __future__ import annotations
from copy import deepcopy
import math
from atomic_io import replace_file
from pathlib import Path
import tempfile
import zipfile
from lxml import etree
from hwpx_helpers import next_id, reset_id, NS_DECL, xml_escape
from yoyak import cell, table
from package_inspection import NS
from structured_document import diagram_order


class DiagramStyles:
    def __init__(self, header, accent="245A81"):
        self.header, self.accent = header, "#" + accent
        self.cp = self.clone("charPr", "charProperties")
        self.cp.set("height", "1100")
        self.cp.set("textColor", "#172B3A")
        self.cp.set("borderFillIDRef", "0")
        self.pp = self.clone("paraPr", "paraProperties")
        align = self.pp.find("hh:align", NS)
        if align is not None:
            align.set("horizontal", "CENTER")
        for margin in (
            self.pp.findall(".//hc:intent", NS)
            + self.pp.findall(".//hc:left", NS)
            + self.pp.findall(".//hc:right", NS)
        ):
            margin.set("value", "0")
        self.none = self.border(None)
        self.node = self.border("#EDF3F8")
        self.branch = self.border(None, top=True)

    def clone(self, element, container):
        parent = self.header.find(".//hh:" + container, NS)
        value = deepcopy(parent[0])
        value.set("id", str(max(int(e.get("id")) for e in parent) + 1))
        parent.append(value)
        parent.set("itemCnt", str(len(parent)))
        return value

    def border(self, color, top=False):
        value = self.clone("borderFill", "borderFills")
        for side in ("left", "right", "top", "bottom"):
            edge = value.find("hh:" + side + "Border", NS)
            if edge is not None:
                edge.set(
                    "type", "SOLID" if (color or top and side == "top") else "NONE"
                )
                edge.set("color", self.accent)
                edge.set("width", "0.12 mm")
        for brush in list(value.findall("hc:fillBrush", NS)):
            value.remove(brush)
        if color:
            brush = etree.SubElement(value, "{" + NS["hc"] + "}fillBrush")
            etree.SubElement(
                brush,
                "{" + NS["hc"] + "}winBrush",
                faceColor=color,
                hatchColor="#FFFFFF",
                alpha="0",
            )
        return value.get("id")

    def paragraph(self, text):
        return (
            f'<hp:p id="{next_id()}" paraPrIDRef="{self.pp.get("id")}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">'
            f'<hp:run charPrIDRef="{self.cp.get("id")}"><hp:t>{xml_escape(text)}</hp:t></hp:run></hp:p>'
        )


def text_height(values, width):
    return 800 + sum(
        max(
            1,
            math.ceil(
                sum(1100 if ord(c) > 127 else 550 for c in v) / max(width - 900, 1)
            ),
        )
        * 1600
        for v in values
        if v
    )


def render(diagram, styles, width):
    nodes = diagram_order(diagram)
    direction = diagram.get("direction", "horizontal")
    reason = "explicit" if "direction" in diagram else "default-horizontal"
    estimated_node_width = None
    rows, heights = [], []

    def emit(values, widths, fills=None, spans=None):
        heights.append(max(text_height(v, w) for v, w in zip(values, widths)))
        column = 0
        cells = []
        for index, (value, w) in enumerate(zip(values, widths)):
            span = spans[index] if spans else 1
            cells.append(
                cell(
                    column,
                    len(rows),
                    w,
                    heights[-1],
                    fills[index] if fills else styles.node,
                    [styles.paragraph(v) for v in value if v] or [styles.paragraph("")],
                    margin=(450, 450, 400, 400),
                    colspan=span,
                )
            )
            column += span
        rows.append("<hp:tr>" + "".join(cells) + "</hp:tr>")

    def node_text(n):
        return [n["title"], n.get("text", "")]

    if diagram["pattern"] == "process":
        if direction == "horizontal":
            gaps = [
                max(
                    2600,
                    min(
                        8500,
                        1200
                        + sum(
                            1100 if ord(c) > 127 else 550 for c in e.get("label", "")
                        ),
                    ),
                )
                for e in diagram["edges"]
            ]
            node_width = (width - sum(gaps)) // len(nodes)
            estimated_node_width = node_width
            if node_width < 6000 and "direction" not in diagram:
                direction = "vertical"
                reason = "auto-vertical: horizontal node width below 6000 HWP units"
        if direction == "vertical":
            columns = 1
            for i, n in enumerate(nodes):
                emit([node_text(n)], [width])
                if i < len(nodes) - 1:
                    emit(
                        [["↓", diagram["edges"][i].get("label", "")]],
                        [width],
                        [styles.none],
                    )
        else:
            columns = len(nodes) * 2 - 1
            values, widths, fills = [], [], []
            for i, n in enumerate(nodes):
                values.append(node_text(n))
                widths.append(node_width)
                fills.append(styles.node)
                if i < len(nodes) - 1:
                    values.append(["→", diagram["edges"][i].get("label", "")])
                    widths.append(gaps[i])
                    fills.append(styles.none)
            widths[-1] += width - sum(widths)
            emit(values, widths, fills)
    elif diagram["pattern"] == "hierarchy":
        columns = len(nodes) - 1
        widths = [width // columns] * columns
        widths[-1] += width - sum(widths)
        emit([node_text(nodes[0])], [width], spans=[columns])
        emit([["↓"]], [width], [styles.none], [columns])
        emit(
            [["↓", e.get("label", "")] for e in diagram["edges"]],
            widths,
            [styles.branch] * columns,
        )
        emit([node_text(n) for n in nodes[1:]], widths)
    else:
        roles = list(dict.fromkeys(n["role"] for n in nodes))
        columns = len(nodes) + 1
        role_width = 6500
        widths = [role_width] + [(width - role_width) // len(nodes)] * len(nodes)
        widths[-1] += width - sum(widths)
        emit(
            [["역할 / 단계"]] + [[str(i + 1)] for i in range(len(nodes))],
            widths,
            [styles.none] * columns,
        )
        for role in roles:
            emit(
                [[role]] + [node_text(n) if n["role"] == role else [""] for n in nodes],
                widths,
                [styles.none]
                + [styles.node if n["role"] == role else styles.none for n in nodes],
            )
        sequence = "흐름: " + " → ".join(
            str(i + 1)
            + (
                " (" + diagram["edges"][i].get("label", "") + ")"
                if i < len(nodes) - 1 and diagram["edges"][i].get("label")
                else ""
            )
            for i in range(len(nodes))
        )
        emit([[sequence]], [width], [styles.none], [columns])
    height = sum(heights)
    if height > 64000:
        raise ValueError(
            "diagram is taller than one page; shorten labels explicitly or split into separate diagrams"
        )
    xml = table(
        rows, len(rows), columns, width, height, styles.none, outmargin=(0, 0, 0, 0)
    ).replace('pageBreak="CELL"', 'pageBreak="NONE"')
    return xml, dict(
        pattern=diagram["pattern"],
        direction=direction,
        rows=len(rows),
        columns=columns,
        height=height,
        requested_direction=diagram.get("direction", "auto"),
        direction_reason=reason,
        horizontal_node_width=estimated_node_width,
        width=width,
        font_size_pt=11,
    )


def insert_diagrams(path: Path, diagrams: list[dict], *, accent="245A81") -> list[dict]:
    if not diagrams:
        return []
    with zipfile.ZipFile(path) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    header = etree.fromstring(
        dict((i.filename, d) for i, d in entries)["Contents/header.xml"]
    )
    styles = DiagramStyles(header, accent)
    sections = {
        i.filename: etree.fromstring(d)
        for i, d in entries
        if i.filename.startswith("Contents/section") and i.filename.endswith(".xml")
    }
    reset_id(
        max(
            [1000000000]
            + [
                int(e.get("id"))
                for root in sections.values()
                for e in root.iter()
                if (e.get("id") or "").isdigit()
            ]
        )
        + 1
    )
    reports = []
    for diagram in diagrams:
        found = []
        for name, root in sections.items():
            for p in root.findall("./hp:p", NS):
                if (
                    "".join(p.xpath(".//hp:t/text()", namespaces=NS)).strip()
                    == diagram["marker"]
                ):
                    found.append((root, p))
        if len(found) != 1:
            raise ValueError(f"diagram anchor must occur once: {diagram['marker']}")
        root, anchor = found[0]
        page = root.find(".//hp:pagePr", NS)
        margin = page.find("hp:margin", NS)
        width = (
            int(page.get("width")) - int(margin.get("left")) - int(margin.get("right"))
        )
        diagram_xml, report = render(diagram, styles, width)
        wrapper = etree.fromstring(
            f'<hs:sec {NS_DECL}><hp:p id="{next_id()}" paraPrIDRef="{styles.pp.get("id")}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="{styles.cp.get("id")}">{diagram_xml}<hp:t/></hp:run></hp:p></hs:sec>'.encode()
        )
        root.replace(anchor, wrapper[0])
        reports.append(report)
    replacements = {
        name: etree.tostring(root, encoding="UTF-8", xml_declaration=True)
        for name, root in sections.items()
    }
    replacements["Contents/header.xml"] = etree.tostring(
        header, encoding="UTF-8", xml_declaration=True
    )
    replacements["Preview/PrvText.txt"] = "\n".join(
        "".join(root.xpath(".//hp:t/text()", namespaces=NS))
        for root in sections.values()
    ).encode()
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
    try:
        with zipfile.ZipFile(temporary, "w") as z:
            for i, data in entries:
                z.writestr(i, replacements.get(i.filename, data))
        replace_file(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return reports
