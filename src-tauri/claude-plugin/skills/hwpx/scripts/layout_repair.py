"""Bounded, opt-in height repair. Never edits text, fonts, or graph semantics."""

from atomic_io import replace_file
from pathlib import Path
import tempfile
import zipfile
from lxml import etree
from package_inspection import NS, inspect_package


def repair_layout(path: Path, *, max_attempts: int = 2) -> list[dict]:
    attempts = []
    for _ in range(min(max_attempts, 2)):
        before = inspect_package(path)
        risks = [
            w
            for w in before["layout"]["warnings"]
            if w["type"] == "estimated_cell_overflow"
        ]
        if not risks:
            break
        with zipfile.ZipFile(path) as z:
            entries = [(i, z.read(i.filename)) for i in z.infolist()]
        replacements = {}
        changes = []
        for entry, data in entries:
            section_risks = [w for w in risks if w["section"] == entry.filename]
            if not section_risks:
                continue
            root = etree.fromstring(data)
            tables = root.findall(".//hp:tbl", NS)
            for table_no in sorted({w["table"] for w in section_risks}):
                table = tables[table_no - 1]
                # Merged rows require a separate constraint solver, not local growth.
                if any(
                    e.get("rowSpan", "1") != "1"
                    for e in table.findall(".//hp:cellSpan", NS)
                ):
                    continue
                rows = table.findall("hp:tr", NS)
                for row in rows:
                    cells = row.findall("hp:tc", NS)
                    if not cells:
                        continue
                    row_no = cells[0].find("hp:cellAddr", NS).get("rowAddr")
                    targets = [
                        w["estimated_height"]
                        for w in section_risks
                        if w["table"] == table_no and w["row"] == row_no
                    ]
                    if not targets:
                        continue
                    old = max(int(c.find("hp:cellSz", NS).get("height")) for c in cells)
                    height = max(old, max(targets) + 200)
                    if height > 64000 or height == old:
                        continue
                    for c in cells:
                        c.find("hp:cellSz", NS).set("height", str(height))
                    changes.append(
                        dict(
                            section=entry.filename,
                            table=table_no,
                            row=row_no,
                            old_height=old,
                            new_height=height,
                        )
                    )
                size = table.find("hp:sz", NS)
                if size is not None:
                    size.set(
                        "height",
                        str(
                            sum(
                                max(
                                    int(c.find("hp:cellSz", NS).get("height"))
                                    for c in row.findall("hp:tc", NS)
                                )
                                for row in rows
                            )
                        ),
                    )
            replacements[entry.filename] = etree.tostring(
                root, encoding="UTF-8", xml_declaration=True
            )
        if not changes:
            break
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
        try:
            with zipfile.ZipFile(temporary, "w") as z:
                for i, data in entries:
                    z.writestr(i, replacements.get(i.filename, data))
            after = inspect_package(temporary)
            if (
                before["paragraphs"] != after["paragraphs"]
                or before["image_hashes"] != after["image_hashes"]
            ):
                raise ValueError("layout repair changed content; candidate rejected")
            replace_file(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)
        attempts.append({"changes": changes, "content_preserved": True})
    return attempts
