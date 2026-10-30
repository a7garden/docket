#!/usr/bin/env python3
"""Single, deterministic quality gate for generated HWPX documents.

The public API is :func:`run_quality_gate`.  It normalizes the package first,
then runs every static check used by the skill.  Callers decide whether
warnings are advisory or release-blocking; structural, openability, content,
and real Hancom-open failures always block publication.
"""

from __future__ import annotations

import contextlib
import io
import time
from package_inspection import inspect_package, check_content, compact
from pathlib import Path
from typing import Any, Iterable

from fill_hwpx import check_openable
from finalize_hwpx import hancom_open_check
from fix_namespaces import fix_hwpx_namespaces
from validate import validate
from verify_hwpx import verify


BLOCKING_LAYOUT_TYPES = {
    "invalid_cell_geometry",
}


def _hancom_unavailable(message: str) -> bool:
    lowered = message.lower()
    markers = (
        "only available on windows",
        "pywin32 is not installed",
        "invalid class string",
        "class not registered",
        "클래스가 등록되지",
    )
    return any(marker in lowered for marker in markers)


def run_quality_gate(
    hwpx_path: str | Path,
    *,
    required_text: Iterable[str] = (),
    source_path: str | Path | None = None,
    hancom: str = "auto",
    fail_on_warnings: bool = False,
    expected: list[dict] | None = None,
    expected_images: list[Path] | None = None,
    lint_findings: list[dict] | None = None,
) -> dict[str, Any]:
    """Normalize and validate one HWPX file.

    ``hancom`` is one of ``auto``, ``required``, or ``off``.  ``auto`` runs a
    real open test when the Windows COM engine is available and records a skip
    warning otherwise. Package bytes can be reproducible for fixed inputs;
    report timings are measured and intentionally vary between runs.
    """

    started = time.perf_counter()
    path = Path(hwpx_path).resolve()
    report: dict[str, Any] = {
        "version": 1,
        "status": "FAIL",
        "ok": False,
        "file": str(path),
        "actions": [],
        "checks": {
            "visual_review": {"status": "not_run", "ok": None},
            "render": {"status": "not_run", "ok": None},
        },
        "timings_ms": {},
        "warnings": [],
        "errors": [],
    }

    if hancom not in {"auto", "required", "off"}:
        report["errors"].append(f"invalid hancom mode: {hancom}")
        return report
    if not path.is_file():
        report["errors"].append(f"file not found: {path}")
        return report

    try:
        removed = fix_hwpx_namespaces(str(path), strip_cached_lines=True)
        report["actions"].extend(
            [
                {"name": "fix_namespaces", "ok": True},
                {"name": "strip_linesegarray", "ok": True, "removed": removed},
            ]
        )

        structural_errors = validate(str(path))
        report["checks"]["structure"] = {
            "ok": not structural_errors,
            "errors": structural_errors,
        }
        report["errors"].extend(structural_errors)

        openable = check_openable(str(path), strict=True)
        report["checks"]["openable"] = openable
        if not openable.get("ok"):
            report["errors"].extend(openable.get("errors") or [])
            for warning in openable.get("warnings") or []:
                report["errors"].append(f"strict openability: {warning}")
        else:
            report["warnings"].extend(openable.get("warnings") or [])

        package = inspect_package(path)
        report["checks"]["references"] = {
            "ok": not package["errors"],
            "errors": package["errors"],
            "sections": package["sections"],
        }
        report["errors"].extend(package["errors"])
        layout = package["layout"]["warnings"]
        blocking_layout = [w for w in layout if w.get("type") in BLOCKING_LAYOUT_TYPES]
        advisory_layout = [
            w for w in layout if w.get("type") not in BLOCKING_LAYOUT_TYPES
        ]
        report["checks"]["layout"] = {
            "ok": not blocking_layout,
            "tables": package["layout"]["tables"],
            "cells": package["layout"]["cells"],
            "text_cells": package["layout"]["text_cells"],
            "blocking": blocking_layout,
            "advisory": advisory_layout,
        }
        report["errors"].extend(
            f"layout {w.get('type')}: {w.get('message')}" for w in blocking_layout
        )
        report["warnings"].extend(
            f"layout {w.get('type')}: {w.get('message')}" for w in advisory_layout
        )

        with contextlib.redirect_stdout(io.StringIO()):
            verification = verify(
                str(source_path) if source_path else None,
                str(path),
            )
        report["checks"]["package"] = verification
        if verification.get("status") == "FAIL":
            report["errors"].extend(verification.get("issues") or [])
        else:
            report["warnings"].extend(verification.get("warnings") or [])

        content = check_content(package, expected or [], expected_images or [])
        report["checks"]["content"] = content
        report["errors"].extend(
            f"content missing: {item}" for item in content["missing"]
        )
        report["errors"].extend(
            f"image missing: {item}" for item in content["missing_images"]
        )
        report["checks"]["writing"] = {"findings": lint_findings or []}
        report["warnings"].extend(
            f"writing L{f.get('line', '?')} {f['rule']}: {f.get('message', '')}"
            for f in (lint_findings or [])
            if f["severity"] == "warning"
        )
        all_text = "\n".join(p["text"] for p in package["paragraphs"])
        required = [str(text).strip() for text in required_text if str(text).strip()]
        missing = [text for text in required if compact(text) not in compact(all_text)]
        report["checks"]["required_text"] = {
            "ok": not missing,
            "required": required,
            "missing": missing,
            "body_chars": len(all_text.strip()),
        }
        if not all_text.strip():
            report["errors"].append("document body is empty")
        report["errors"].extend(f"required text missing: {text}" for text in missing)

        if hancom != "off":
            ok, message = hancom_open_check(path)
            skipped = not ok and _hancom_unavailable(message)
            report["checks"]["hancom"] = {
                "ok": ok,
                "mode": hancom,
                "skipped": skipped,
                "message": message,
            }
            if not ok:
                if hancom == "auto" and skipped:
                    report["warnings"].append(f"Hancom open check skipped: {message}")
                else:
                    report["errors"].append(message)
        else:
            report["checks"]["hancom"] = {
                "ok": None,
                "status": "not_run",
                "mode": "off",
                "skipped": True,
                "message": "disabled by caller",
            }
    except Exception as exc:  # noqa: BLE001 - gate must return a report on failure
        report["errors"].append(f"quality gate exception: {type(exc).__name__}: {exc}")

    report["timings_ms"]["quality"] = (time.perf_counter() - started) * 1000
    # Preserve order but collapse duplicates produced by overlapping validators.
    report["errors"] = list(dict.fromkeys(str(x) for x in report["errors"] if x))
    report["warnings"] = list(dict.fromkeys(str(x) for x in report["warnings"] if x))
    if report["errors"]:
        report["status"] = "FAIL"
    elif report["warnings"]:
        report["status"] = "FAIL" if fail_on_warnings else "WARN"
    else:
        report["status"] = "PASS"
    report["ok"] = report["status"] in {"PASS", "WARN"}
    return report


__all__ = ["BLOCKING_LAYOUT_TYPES", "run_quality_gate"]
