"""Embed fixed image bytes without changing unrelated HWPX entries."""

from atomic_io import replace_file
import tempfile
import zipfile
from pathlib import Path
from lxml import etree


def embed_images(path: Path, images: list[tuple[str, Path]]) -> None:
    if not images:
        return
    ns = "http://www.idpf.org/2007/opf/"
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".bmp": "image/bmp",
    }
    with tempfile.NamedTemporaryFile(
        dir=path.parent, suffix=".hwpx", delete=False
    ) as stream:
        temporary = Path(stream.name)
    try:
        with zipfile.ZipFile(path) as source, zipfile.ZipFile(temporary, "w") as target:
            hpf = etree.fromstring(source.read("Contents/content.hpf"))
            manifest = hpf.find("{" + ns + "}manifest")
            if manifest is None:
                raise ValueError("missing content manifest")
            existing = {e.get("id") for e in manifest}
            for iid, image in images:
                if iid in existing:
                    raise ValueError(f"duplicate image id: {iid}")
                existing.add(iid)
                etree.SubElement(
                    manifest,
                    "{" + ns + "}item",
                    id=iid,
                    href=f"BinData/{iid}{image.suffix.lower()}",
                    **{"media-type": mime[image.suffix.lower()], "isEmbeded": "1"},
                )
            for entry in source.infolist():
                data = (
                    etree.tostring(hpf, encoding="UTF-8", xml_declaration=True)
                    if entry.filename == "Contents/content.hpf"
                    else source.read(entry.filename)
                )
                target.writestr(entry, data)
            for iid, image in images:
                entry = zipfile.ZipInfo(
                    f"BinData/{iid}{image.suffix.lower()}", (1980, 1, 1, 0, 0, 0)
                )
                target.writestr(
                    entry, image.read_bytes(), compress_type=zipfile.ZIP_DEFLATED
                )
        replace_file(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
