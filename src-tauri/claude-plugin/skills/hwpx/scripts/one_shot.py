#!/usr/bin/env python3
"""Build and release a production-quality HWPX document in one command.

Input is a versioned JSON spec.  The document is generated into a temporary
file, normalized, quality-gated, and atomically moved to the requested output
only after all release checks pass.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
from atomic_io import replace_file
import re
import sys
import tempfile
import time
from copy import deepcopy
from build_contract import SpecError, inspect_spec, plan_paths
from document_model import display_text
from pathlib import Path
from typing import Any

import geomto
import gonmun
import yoyak
from quality_gate import run_quality_gate


ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "schemas" / "one-shot.schema.json"
KINDS = {"official-letter", "brief-report", "plan-report", "markdown"}
PLACEHOLDER_PATTERNS = (
    re.compile(r"\{\{[^{}]+\}\}"),
    re.compile(r"○○|◯◯|ㅇㅇ"),
    re.compile(r"\b(?:TBD|TODO|N/?A)\b", re.I),
    re.compile(r"(?:기관명|부서명|성명|제목|내용)\s*(?:입력|기재)"),
)


EXAMPLES: dict[str, dict[str, Any]] = {
    "official-letter": {
        "version": 1,
        "kind": "official-letter",
        "output": "기관_AX전략_특강_안내.hwpx",
        "document": {
            "기관명": "미래전략원",
            "수신": "전 부서장",
            "제목": "기관 AX 전략 특강 개최 안내",
            "발신명의": "미래전략원장",
            "body": [
                "1. 디지털 전환 역량 강화를 위한 기관 AX 전략 특강을 다음과 같이 개최합니다.",
                "  가. 일시: 2026. 8. 25.(화) 15:00∼17:30",
                "  나. 참가비: 무료",
            ],
            "끝": True,
        },
        "quality": {"hancom": "auto", "reject_placeholders": True},
        "metadata_date": "2026-08-25",
    },
    "brief-report": {
        "version": 1,
        "kind": "brief-report",
        "output": "AX전략_특강_요약보고.hwpx",
        "markdown": "---\n기관: 미래전략원\n보고일: 2026. 8. 20.\n---\n# 기관 AX 전략 특강 운영 보고\n## 추진 개요\n- **(일시)** 2026. 8. 25.(화) 15:00∼17:30\n- **(참가비)** 무료\n⇒ 기관의 실행 중심 AX 역량 강화\n",
        "quality": {"hancom": "auto", "reject_placeholders": True},
        "metadata_date": "2026-08-20",
    },
    "plan-report": {
        "version": 1,
        "kind": "plan-report",
        "output": "AX전략_특강_운영계획.hwpx",
        "markdown": "---\n작성: 2026. 8. 20. 미래전략원\n기관: 미래전략원\n표지: true\n---\n# 기관 AX 전략 특강 운영계획\n> 기관의 실행 중심 AX 전략 수립과 현업 적용을 지원하고자 함.\n## 추진 배경\n- **(목적)** 기관 AX 전환 방향과 실행 과제 공유\n## 운영 개요\n- **(일시)** 2026. 8. 25.(화) 15:00∼17:30\n- **(참가비)** 무료\n⇒ 특강 종료 후 부서별 실행 과제 발굴\n",
        "quality": {"hancom": "auto", "reject_placeholders": True},
        "metadata_date": "2026-08-20",
    },
    "markdown": {
        "version": 1,
        "kind": "markdown",
        "output": "보고서.hwpx",
        "markdown": "# 보고서 제목\n\n## 개요\n\n- 핵심 내용\n",
        "template": "report",
        "quality": {"hancom": "auto", "reject_placeholders": True},
        "metadata_date": "2000-01-01",
    },
}


def _text_payload(spec: dict[str, Any], spec_dir: Path | None = None) -> str:
    if spec["kind"] == "official-letter":
        return json.dumps(spec.get("document", {}), ensure_ascii=False)
    if spec.get("markdown"):
        return str(spec["markdown"])
    if spec.get("source") and spec_dir is not None:
        source = _resolve(spec_dir, spec["source"])
        if not source.is_file():
            raise SpecError(f"source not found: {source}")
        return source.read_text(encoding="utf-8")
    return ""


def _find_placeholders(text: str) -> list[str]:
    found: list[str] = []
    for pattern in PLACEHOLDER_PATTERNS:
        found.extend(match.group(0) for match in pattern.finditer(text))
    return list(dict.fromkeys(found))


def validate_spec(spec: dict[str, Any], *, spec_dir: Path | None = None) -> dict:
    inspected = inspect_spec(spec, spec_dir or Path.cwd())
    quality = spec.get("quality", {})
    if quality.get("reject_placeholders", True) and not spec.get("draft", False):
        placeholders = _find_placeholders(
            inspected["text"] + json.dumps(inspected["diagrams"], ensure_ascii=False)
        )
        if placeholders:
            raise SpecError("unresolved placeholders: " + ", ".join(placeholders[:10]))
    return inspected


def _resolve(base: Path, value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (base / path).resolve()


def _required_text(spec: dict[str, Any], base: Path) -> list[str]:
    quality = spec.get("quality", {})
    explicit = [str(x) for x in quality.get("required_text", [])]
    if spec["kind"] == "official-letter":
        doc = spec["document"]
        inferred = [str(doc["제목"]), str(doc["기관명"]), str(doc["발신명의"])]
    else:
        payload = _text_payload(spec, base)
        match = re.search(r"(?m)^#\s+(.+?)\s*$", payload)
        inferred = [display_text(match.group(1))] if match else []
    return list(dict.fromkeys(x.strip() for x in inferred + explicit if x.strip()))


def _generate(spec: dict[str, Any], base: Path, temp_dir: Path, output: Path) -> None:
    """In-process adapters avoid launching a chain of Python CLI processes."""
    from build_hwpx import build as assemble

    kind = spec["kind"]
    if kind == "official-letter":
        section = temp_dir / "section.xml"
        section.write_text(gonmun.build_section(spec["document"]), encoding="utf-8")
        header, _ = gonmun._header_for(spec["document"], output)
        with contextlib.redirect_stdout(io.StringIO()):
            assemble(
                None,
                header,
                section,
                spec["document"]["제목"],
                None,
                output,
                metadata_date=spec["metadata_date"],
            )
    elif kind == "brief-report":
        yoyak.generate_text(
            spec["markdown"], output, base_dir=base, metadata_date=spec["metadata_date"]
        )
    elif kind == "plan-report":
        geomto.generate_text(
            spec["markdown"], output, base_dir=base, metadata_date=spec["metadata_date"]
        )
    else:
        from md2hwpx import md_to_section
        from package_assets import embed_images

        images = []
        template = spec.get("template", "report")
        section_xml, title = md_to_section(
            spec["markdown"], template, base_dir=base, images=images
        )
        section = temp_dir / "section.xml"
        section.write_text(section_xml, encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            assemble(
                template,
                None,
                section,
                spec.get("title") or title,
                spec.get("creator"),
                output,
                metadata_date=spec["metadata_date"],
            )
        embed_images(output, images)


def build(
    spec: dict[str, Any],
    *,
    spec_dir: Path,
    output_override: str | None = None,
    spec_path: Path | None = None,
    report_path: Path | None = None,
) -> dict[str, Any]:
    """Validate before writes; publish one document atomically, never a file set."""
    started = time.perf_counter()
    spec = deepcopy(spec)
    inspected = validate_spec(spec, spec_dir=spec_dir)
    if "blocks" in spec:
        spec["markdown"] = inspected["text"]
    output = plan_paths(
        spec,
        spec_dir,
        inspected,
        override=output_override,
        spec_path=spec_path,
        report_path=report_path,
    )
    quality = spec.get("quality", {})
    resource_base = (
        _resolve(spec_dir, spec["source"]).parent if spec.get("source") else spec_dir
    )
    date_explicit = "metadata_date" in spec
    spec.setdefault("metadata_date", "2000-01-01")
    if spec.get("draft"):
        if spec["kind"] == "official-letter":
            spec["document"]["제목"] = "[초안] " + spec["document"]["제목"]
        else:
            spec["markdown"] = re.sub(
                r"(?m)^#\s+(.+)$", r"# [초안] \1", inspected["text"], count=1
            )
            spec.pop("source", None)
    if spec["kind"] != "official-letter":
        # Canonical display title; generators must not print emphasis markers.
        text = spec["markdown"] if spec.get("draft") else inspected["text"]
        text = re.sub(
            r"(?m)^#\s+(.+)$", lambda m: "# " + display_text(m[1]), text, count=1
        )
        # Materialized input lives in a temp folder; freeze all asset paths first.
        text = re.sub(
            r"(!\[[^\]]*\]\()([^)]+)(\))",
            lambda m: (
                m[1] + str(_resolve(resource_base, m[2].strip().strip("<>"))) + m[3]
            ),
            text,
        )
        text = re.sub(
            r"(?m)^로고:\s*(.+)$",
            lambda m: "로고: " + str(_resolve(resource_base, m[1])),
            text,
        )
        spec["markdown"] = text
        spec.pop("source", None)
    output.parent.mkdir(parents=True, exist_ok=True)
    preflight_ms = (time.perf_counter() - started) * 1000
    with tempfile.TemporaryDirectory(prefix=".hwpx-build-", dir=output.parent) as td:
        temp_dir = Path(td)
        candidate = temp_dir / "candidate.hwpx"
        generated = time.perf_counter()
        try:
            _generate(spec, spec_dir, temp_dir, candidate)
        except SystemExit as exc:
            raise SpecError(str(exc)) from exc
        from table_diagram import insert_diagrams
        from document_profile import apply_profile, tokens

        diagram_report = insert_diagrams(
            candidate,
            inspected["diagrams"],
            accent=tokens(spec).get("accent", "245A81"),
        )
        applied_profile = apply_profile(candidate, spec)
        from layout_repair import repair_layout

        repairs = (
            repair_layout(candidate) if quality.get("repair_layout", False) else []
        )
        generation_ms = (time.perf_counter() - generated) * 1000
        report = run_quality_gate(
            candidate,
            required_text=_required_text(spec, spec_dir)
            + list(spec.get("facts", {}).values())
            + [
                e["label"]
                for d in inspected["diagrams"]
                for e in d["edges"]
                if e.get("label")
            ],
            expected=inspected["expected"],
            expected_images=inspected["images"],
            hancom=quality.get("hancom", "auto"),
            fail_on_warnings=quality.get("fail_on_warnings", False),
            lint_findings=inspected["lint"],
        )
        report.update(
            kind=spec["kind"],
            output=str(output),
            file=str(output),
            published=False,
            draft=spec.get("draft", False),
            unresolved=_find_placeholders(
                inspected["text"]
                + json.dumps(inspected["diagrams"], ensure_ascii=False)
            ),
        )
        report["unknowns"] = spec.get("unknowns", [])
        report["diagrams"] = diagram_report
        from structured_document import input_findings

        findings = input_findings(spec)
        report["checks"]["input_text"] = {"findings": findings}
        report["warnings"].extend(
            f"input {f['pointer']} {f['code']}: {f['message']}" for f in findings
        )
        if findings and report.get("ok"):
            report["ok"] = not quality.get("fail_on_warnings", False)
            report["status"] = "WARN" if report["ok"] else "FAIL"
        report["profile"] = applied_profile
        report["repairs"] = repairs
        report["metadata_date"] = {
            "value": spec["metadata_date"],
            "source": "explicit"
            if date_explicit
            else "reproducible-default-not-document-date",
        }
        report["spec_version"] = spec["version"]
        report["timings_ms"].update(preflight=preflight_ms, generation=generation_ms)
        package_result = report.get("checks", {}).get("package", {}).get("result", {})
        if isinstance(package_result, dict) and "path" in package_result:
            package_result["path"] = str(output)
        if not report.get("ok"):
            return report
        try:
            replace_file(candidate, output)
        except OSError as exc:
            report.update(ok=False, status="FAIL")
            report["errors"].append(
                f"publication failed; previous output preserved: {exc}"
            )
            return report
        report["published"] = True
        if spec.get("draft"):
            report["status"] = "DRAFT"
        return report


def save_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, suffix=".json.tmp", delete=False
    ) as stream:
        temporary = Path(stream.name)
        json.dump(report, stream, ensure_ascii=False, indent=2)
    try:
        replace_file(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> int:
    # JSON is UTF-8 even when Windows pipes default to a legacy code page.
    # A successful publication must not crash while printing its report.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="One-shot high-quality HWPX builder")
    parser.add_argument("spec", nargs="?", help="versioned JSON spec")
    parser.add_argument("--output", help="override spec.output")
    parser.add_argument("--report", help="write machine-readable quality report")
    parser.add_argument("--schema", action="store_true", help="print the JSON schema")
    parser.add_argument(
        "--example",
        choices=sorted(KINDS) + ["diagram", "process-summary"],
        help="print an example spec",
    )
    args = parser.parse_args()

    if args.schema:
        print(SCHEMA_PATH.read_text(encoding="utf-8"))
        return 0
    if args.example:
        if args.example in {"diagram", "process-summary"}:
            name = (
                "ax-strategy-v2.json"
                if args.example == "diagram"
                else "process-summary-v2.json"
            )
            print((ROOT / "examples" / name).read_text(encoding="utf-8"))
            return 0
        print(json.dumps(EXAMPLES[args.example], ensure_ascii=False, indent=2))
        return 0
    if not args.spec:
        parser.error("spec is required unless --schema or --example is used")

    spec_path = Path(args.spec).resolve()
    report_path = Path(args.report).resolve() if args.report else None
    safe_report = False
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
        if not isinstance(spec, dict):
            raise SpecError("spec root must be an object")
        inspected = validate_spec(spec, spec_dir=spec_path.parent)
        plan_paths(
            spec,
            spec_path.parent,
            inspected,
            override=args.output,
            spec_path=spec_path,
            report_path=report_path,
        )
        safe_report = True
        report = build(
            spec,
            spec_dir=spec_path.parent,
            output_override=args.output,
            spec_path=spec_path,
            report_path=report_path,
        )
    except Exception as exc:  # CLI always returns a structured failure
        report = {
            "version": 1,
            "status": "FAIL",
            "ok": False,
            "published": False,
            "errors": [f"{type(exc).__name__}: {exc}"],
            "warnings": [],
        }

    report["report_saved"] = False
    if report_path and safe_report:
        try:
            report["report_saved"] = True
            save_report(report_path, report)
        except OSError as exc:
            report.update(
                ok=False,
                status="PARTIAL" if report.get("published") else "FAIL",
                report_saved=False,
            )
            report["errors"].append(f"report save failed: {exc}")
    elif report_path:
        report["warnings"].append(
            "report not written: preflight did not establish safe paths"
        )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("ok") else 2


if __name__ == "__main__":
    sys.exit(main())
