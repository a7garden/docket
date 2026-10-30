"""Prepare source-backed reports without retyping code; audit fidelity separately."""

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

from lxml import etree


def fenced_blocks(text):
    """Return supported triple-backtick blocks, including fences and indentation.

    Reject unsupported/ambiguous fences instead of losing their code silently.
    Newlines are normalized; callers never execute any extracted content.
    """
    lines = text.removeprefix("\ufeff").splitlines()
    blocks, start = [], None
    for i, line in enumerate(lines):
        if start is None:
            if re.match(r"^\s*(?:`{3,}|~{3,})", line):
                if not re.fullmatch(r"```[^`]*", line):
                    raise ValueError(
                        f"line {i + 1}: use unindented triple-backtick fences"
                    )
                start = i
        elif line.strip().startswith("```"):
            if not re.fullmatch(r"```[ \t]*", line):
                raise ValueError(f"line {i + 1}: ambiguous closing code fence")
            blocks.append("\n".join(lines[start : i + 1]))
            start = None
    if start is not None:
        raise ValueError(f"line {start + 1}: unclosed code fence")
    return blocks


def code_lines(block):
    # Trailing spaces/blank-line indentation are not semantic; leading code
    # indentation and the order/multiplicity of all other lines are retained.
    return [line.rstrip() for line in block.splitlines()[1:-1]]


def scoped_source(text, end_before=None):
    if end_before is None:
        return text
    lines = text.splitlines()
    positions = [i for i, line in enumerate(lines) if line.strip() == end_before]
    if len(positions) != 1:
        raise ValueError("--end-before must match exactly one complete source line")
    scoped = "\n".join(lines[: positions[0]])
    fenced_blocks(scoped)  # Never cut an open code block.
    return scoped


def source_urls(text):
    text = "\n".join(text.splitlines())
    for block in fenced_blocks(text):
        text = text.replace(block, "", 1)
    # Ordinary inline Markdown links and standalone URLs. Complex Markdown
    # reference definitions/escaped destinations need separate manual review.
    links = re.findall(r"(?<!!)\[[^\]]+\]\((https?://[^\s)]+)\)", text)
    links += re.findall(r"(?m)^\s*(https?://\S+)\s*$", text)
    return list(dict.fromkeys(links))


def prepare(source, narrative, diagrams=(), *, end_before=None):
    source = scoped_source(source, end_before)
    codes = fenced_blocks(source)
    if fenced_blocks(narrative):
        raise ValueError("narrative: use code markers, not retyped code blocks")
    found_codes = re.findall(r"@@CODE_\d+@@", narrative)
    required = [f"@@CODE_{i:02}@@" for i in range(1, len(codes) + 1)]
    if found_codes != required:
        raise ValueError(
            "code markers must include every source block once in source order"
        )
    title = re.findall(r"(?m)^# (.+)$", narrative)
    if len(title) != 1:
        raise ValueError("narrative requires exactly one H1 title")
    body = re.sub(r"(?m)^# .+\n?", "", narrative, count=1)
    if not isinstance(diagrams, (list, tuple)):
        raise TypeError("diagrams must be an array of entries")
    by_id = {}
    for item in diagrams:
        if (
            not isinstance(item, dict)
            or not {"id", "diagram"} <= item.keys()
            or set(item) - {"id", "caption", "diagram"}
            or not isinstance(item["diagram"], dict)
            or ("caption" in item and not isinstance(item["caption"], str))
        ):
            raise ValueError("diagram entry requires id and diagram")
        identifier = item["id"]
        if not isinstance(identifier, str) or not re.fullmatch(
            r"DIAGRAM_\d{2,}", identifier
        ):
            raise ValueError("diagram id must be DIAGRAM_01, DIAGRAM_02, ...")
        if identifier in by_id or item["diagram"].get("type") != "diagram":
            raise ValueError("duplicate diagram id or invalid diagram block")
        by_id[identifier] = item["diagram"]
    diagram_ids = re.findall(r"@@(DIAGRAM_\d+)@@", body)
    if len(diagram_ids) != len(set(diagram_ids)) or set(diagram_ids) != set(by_id):
        raise ValueError(
            "diagram markers and diagram entries must correspond one-to-one"
        )
    tokens = re.findall(r"@@(?:CODE|DIAGRAM)_\d+@@", body)
    standalone = re.findall(r"(?m)^@@(?:CODE|DIAGRAM)_\d+@@[ \t]*$", body)
    if tokens != [token.rstrip() for token in standalone]:
        raise ValueError("each code/diagram marker must be on its own line")
    blocks = []
    for chunk in re.split(r"(?m)^(@@(?:CODE|DIAGRAM)_\d+@@)[ \t]*$", body):
        if not chunk.strip():
            continue
        marker = re.fullmatch(r"@@(CODE|DIAGRAM)_(\d+)@@", chunk)
        if marker and marker[1] == "DIAGRAM":
            blocks.append(by_id["DIAGRAM_" + marker[2]])
        else:
            value = codes[int(marker[2]) - 1] if marker else chunk.strip()
            blocks.append({"type": "paragraph", "text": value})
    spec = {
        "version": 2,
        "kind": "markdown",
        "template": "report",
        "title": title[0],
        "blocks": blocks,
        "output": "report.hwpx",
        "style": {"layout": "technical-report"},
        "quality": {"writing": "advisory", "hancom": "off"},
    }
    return spec


def audit(source, report, hwpx=None, *, end_before=None):
    selected = scoped_source(source, end_before)
    expected = [code_lines(block) for block in fenced_blocks(selected)]
    actual = [code_lines(block) for block in fenced_blocks(report)]
    missing_urls = [url for url in source_urls(selected) if url not in report]
    result = {
        "ok": expected == actual and not missing_urls,
        "source_code_blocks": len(expected),
        "report_code_blocks": len(actual),
        "code_order_and_indentation_equal": expected == actual,
        "missing_source_urls_in_report": missing_urls,
        "source_text_sha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
        "scope_end_before": end_before,
        "semantic_review": "not_run: check explanation, caveats, tables and diagram meaning separately",
        "visual_review": "not_run",
    }
    if hwpx is not None:
        paragraphs = []
        with zipfile.ZipFile(hwpx) as z:
            for name in sorted(z.namelist()):
                if re.fullmatch(r"Contents/section\d+\.xml", name):
                    root = etree.fromstring(
                        z.read(name),
                        etree.XMLParser(resolve_entities=False, no_network=True),
                    )
                    paragraphs += [
                        "".join(
                            p.xpath(
                                './*[local-name()="run"]/*[local-name()="t"]/text()'
                            )
                        ).rstrip()
                        for p in root.xpath('//*[local-name()="p"]')
                    ]
        cursor, missing = 0, []
        for block_no, block in enumerate(expected, 1):
            for line_no, line in enumerate(block, 1):
                if not line:
                    continue
                match = next(
                    (
                        i
                        for i in range(cursor, len(paragraphs))
                        if paragraphs[i] == line
                    ),
                    None,
                )
                if match is None:
                    missing.append({"block": block_no, "line": line_no})
                else:
                    cursor = match + 1
        missing_hwpx_urls = [
            url for url in source_urls(selected) if url not in "\n".join(paragraphs)
        ]
        result.update(
            hwpx_sha256=hashlib.sha256(Path(hwpx).read_bytes()).hexdigest(),
            missing_or_out_of_order_hwpx_code_lines=missing,
            missing_source_urls_in_hwpx=missing_hwpx_urls,
        )
        result["ok"] = result["ok"] and not missing and not missing_hwpx_urls
    return result


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare")
    prep.add_argument("--source", type=Path, required=True)
    prep.add_argument("--narrative", type=Path, required=True)
    prep.add_argument("--diagrams", type=Path)
    prep.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="new directory; never overwrite existing files",
    )
    prep.add_argument("--metadata-date")
    check = commands.add_parser("audit")
    check.add_argument("--source", type=Path, required=True)
    check.add_argument("--report-markdown", type=Path, required=True)
    check.add_argument("--hwpx", type=Path)
    check.add_argument("--output", type=Path)
    for command in (prep, check):
        command.add_argument(
            "--end-before", help="explicit unique full line at which source scope ends"
        )
    args = parser.parse_args()
    try:
        source = args.source.read_text(encoding="utf-8-sig")
        if args.command == "prepare":
            if args.output_dir.exists():
                raise ValueError("output-dir must not exist; preserve prior results")
            spec = prepare(
                source,
                args.narrative.read_text(encoding="utf-8-sig"),
                json.loads(args.diagrams.read_text(encoding="utf-8-sig"))
                if args.diagrams
                else [],
                end_before=args.end_before,
            )
            if args.metadata_date:
                spec["metadata_date"] = args.metadata_date
            from one_shot import validate_spec

            inspected = validate_spec(spec, spec_dir=args.narrative.resolve().parent)
            if inspected["images"]:
                raise ValueError(
                    "prepare handles text/code/tables/diagrams; use one_shot v2 image blocks for images"
                )
            from structured_document import compile_blocks

            markdown = compile_blocks(spec)[0]
            result = audit(source, markdown, end_before=args.end_before)
            if not result["ok"]:
                raise ValueError(
                    "source fidelity failed: " + json.dumps(result, ensure_ascii=False)
                )
            args.output_dir.mkdir(parents=True)
            for name, content in [
                ("spec.json", json.dumps(spec, ensure_ascii=False, indent=2)),
                ("report.md", markdown),
                ("source-audit.json", json.dumps(result, ensure_ascii=False, indent=2)),
            ]:
                (args.output_dir / name).write_text(content, encoding="utf-8")
            result.update(prepared=str(args.output_dir / "spec.json"), published=False)
        else:
            result = audit(
                source,
                args.report_markdown.read_text(encoding="utf-8-sig"),
                args.hwpx,
                end_before=args.end_before,
            )
            if args.output:
                from build_contract import protect_paths

                inputs = [args.source, args.report_markdown] + (
                    [args.hwpx] if args.hwpx else []
                )
                protect_paths(inputs, [args.output])
                from one_shot import save_report

                save_report(args.output, result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["ok"] else 2
    except Exception as exc:  # noqa: BLE001 -- CLI emits structured failure details.
        print(
            json.dumps(
                {"ok": False, "error": f"{type(exc).__name__}: {exc}"},
                ensure_ascii=False,
            )
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
