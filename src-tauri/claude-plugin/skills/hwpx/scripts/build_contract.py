"""Executable spec contract, resource validation and protected path planning."""

from __future__ import annotations
import json
import os
from functools import lru_cache
from pathlib import Path
from PIL import Image
from jsonschema import Draft202012Validator, FormatChecker
import gonmun_lint
import munche_lint
from document_model import parse_document
from package_inspection import compact
from structured_document import compile_blocks, diagram_expected

ROOT = Path(__file__).resolve().parents[1]


class SpecError(ValueError):
    pass


@lru_cache(maxsize=1)
def validator():
    schema = json.loads(
        (ROOT / "schemas/one-shot.schema.json").read_text(encoding="utf-8")
    )
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def resolve(base: Path, value: str | Path) -> Path:
    return (base / value).resolve()


def payload(spec: dict, base: Path) -> str:
    if spec["kind"] == "official-letter":
        return json.dumps(spec["document"], ensure_ascii=False)
    if "blocks" in spec:
        return compile_blocks(spec)[0]
    if "markdown" in spec:
        return spec["markdown"]
    return resolve(base, spec["source"]).read_text(encoding="utf-8-sig")


def inspect_spec(spec, base: Path) -> dict:
    errors = sorted(
        validator().iter_errors(spec), key=lambda e: str(list(e.absolute_path))
    )
    if errors:
        raise SpecError(
            "; ".join(
                f"{'.'.join(map(str, e.absolute_path)) or '$'}: {e.message}"
                for e in errors[:12]
            )
        )
    if spec.get("style", {}).get("layout") == "technical-report" and (
        spec["kind"] != "markdown" or spec.get("template", "report") != "report"
    ):
        raise SpecError(
            "technical-report layout requires kind=markdown, template=report"
        )
    if (
        spec.get("style", {}).get("code_font")
        and spec["style"].get("layout") != "technical-report"
    ):
        raise SpecError("style.code_font requires technical-report layout")
    text = payload(spec, base)
    images, expected, model = [], [], None
    diagrams = compile_blocks(spec)[1] if "blocks" in spec else []
    if spec.get("unknowns") and not spec.get("draft"):
        raise SpecError("unknowns: unresolved facts require an explicit draft")
    if spec["kind"] == "official-letter":
        doc = spec["document"]
        lint = gonmun_lint.lint_text("\n".join(doc["body"]))
        for key in ("기관명", "수신", "제목", "body", "붙임", "발신명의"):
            values = doc.get(key, [])
            for i, value in enumerate(values if isinstance(values, list) else [values]):
                if value.strip():
                    expected.append(
                        dict(
                            id=f"document.{key}.{i}",
                            kind="paragraph",
                            text=value.strip(),
                        )
                    )
    else:
        resource_base = (
            resolve(base, spec["source"]).parent if spec.get("source") else base
        )
        model = parse_document(text, resource_base)
        if not model.title:
            raise SpecError("markdown: one '# title' is required")
        if spec.get("purpose") != "cover" and not any(
            b.kind not in {"title", "heading", "pagebreak"} for b in model.blocks
        ):
            raise SpecError(
                "markdown: substantive body is required; title-only is not a report"
            )
        if spec["kind"] != "markdown" and any(b.kind == "code" for b in model.blocks):
            raise SpecError(
                f"{spec['kind']}: code blocks are unsupported; use markdown kind"
            )
        expected = model.expected
        for diagram in diagrams:
            expanded = []
            for item in expected:
                if item["text"] == diagram["marker"]:
                    expanded += [
                        dict(id=item["id"] + f":node:{i}", kind="table", text=t)
                        for i, t in enumerate(diagram_expected(diagram))
                        if t
                    ]
                else:
                    expanded.append(item)
            expected = expanded
        images = model.images
        allowed_meta = (
            {"기관", "보고일", "결재", "로고", "줄간격"}
            if spec["kind"] == "brief-report"
            else (
                {
                    "기관",
                    "부서",
                    "부제",
                    "작성",
                    "표지",
                    "문서번호",
                    "보존기간",
                    "결재일자",
                    "공개여부",
                    "결재",
                    "줄간격",
                }
                if spec["kind"] == "plan-report"
                else set()
            )
        )
        unknown_meta = set(model.metadata) - allowed_meta
        if unknown_meta:
            raise SpecError(
                "metadata: unsupported fields: " + ", ".join(sorted(unknown_meta))
            )
        if model.metadata.get("줄간격") and (
            not model.metadata["줄간격"].isdigit()
            or not 100 <= int(model.metadata["줄간격"]) <= 300
        ):
            raise SpecError("metadata.줄간격: expected integer 100..300")
        if model.metadata.get("표지") and model.metadata["표지"].lower() not in {
            "true",
            "false",
            "1",
            "0",
            "yes",
            "no",
            "y",
            "n",
            "예",
            "아니오",
            "있음",
            "없음",
        }:
            raise SpecError("metadata.표지: unrecognized boolean value")
        if model.metadata.get("로고"):
            images.append(resolve(resource_base, model.metadata["로고"]))
        lint = (
            munche_lint.lint(text)
            if spec["kind"] in {"brief-report", "plan-report"}
            else {"findings": []}
        )
    for path in images:
        if not path.is_file():
            raise SpecError(f"image not found: {path}")
        if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".bmp"}:
            raise SpecError(f"unsupported image format: {path.suffix}")
        with Image.open(path) as im:
            im.verify()
    writing = spec.get("quality", {}).get(
        "writing",
        "required"
        if spec["version"] == 1 or spec["kind"] == "official-letter"
        else "advisory",
    )
    if writing == "off":
        lint["findings"] = []
    elif writing == "advisory":
        lint["findings"] = [
            {
                **f,
                "original_severity": f["severity"],
                "severity": "warning" if f["severity"] == "error" else f["severity"],
            }
            for f in lint["findings"]
        ]
    errors = [f for f in lint["findings"] if f["severity"] == "error"]
    if errors:
        raise SpecError(
            "writing lint: "
            + "; ".join(
                f"L{f.get('line', '?')} {f['rule']}: {f.get('message', '')}"
                for f in errors
            )
        )
    for key, value in spec.get("facts", {}).items():
        if compact(value) not in compact("\n".join(item["text"] for item in expected)):
            raise SpecError(
                f"facts.{key}: required fact missing from document input: {value}"
            )
    return dict(
        text=text,
        model=model,
        images=images,
        expected=expected,
        lint=lint["findings"],
        diagrams=diagrams,
    )


def protect_paths(inputs: list[Path], outputs: list[Path]) -> None:
    def same(a, b):
        return a.resolve() == b.resolve() or (
            a.exists() and b.exists() and os.path.samefile(a, b)
        )

    for index, output in enumerate(outputs):
        if output.exists() and not output.is_file():
            raise SpecError(f"output path is not a file: {output}")
        for protected in inputs + outputs[:index]:
            if same(output, protected):
                raise SpecError(f"path collision: {output} and {protected}")


def plan_paths(
    spec: dict,
    base: Path,
    inspected: dict,
    *,
    override=None,
    spec_path=None,
    report_path=None,
):
    output = resolve(base, override or spec["output"])
    if output.suffix.lower() != ".hwpx":
        raise SpecError("output override must end with .hwpx")
    inputs = list(inspected["images"])
    if spec.get("source"):
        inputs.append(resolve(base, spec["source"]))
    if spec_path:
        inputs.append(Path(spec_path).resolve())
    outputs = [output] + ([Path(report_path).resolve()] if report_path else [])
    protect_paths(inputs, outputs)
    return output
