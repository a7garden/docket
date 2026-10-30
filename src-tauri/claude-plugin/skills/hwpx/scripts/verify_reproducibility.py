"""Replay a fixed spec in separate processes; retain evidence, never rewrite inputs."""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys

from one_shot import ROOT, validate_spec


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fingerprint(spec_path, spec, inspected):
    paths = {spec_path.resolve(), *[p.resolve() for p in inspected["images"]]}
    if spec.get("source"):
        paths.add((spec_path.parent / spec["source"]).resolve())
    for folder in ("scripts", "schemas", "profiles", "templates", "assets"):
        paths.update(
            p.resolve()
            for p in (ROOT / folder).rglob("*")
            if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
        )
    return {str(p): sha256(p) for p in sorted(paths)}


def verify(spec_path, output_dir, runs=3, expected_sha256=None):
    spec_path, output_dir = Path(spec_path).resolve(), Path(output_dir).resolve()
    if type(runs) is not int or not 2 <= runs <= 20:
        raise ValueError("runs must be an integer in 2..20")
    if expected_sha256 is not None and not re.fullmatch(
        r"[0-9a-fA-F]{64}", expected_sha256
    ):
        raise ValueError("expected-sha256 must contain 64 hexadecimal characters")
    # A fresh directory prevents accidental overwrite of an input or prior evidence.
    if output_dir.exists():
        raise ValueError("output directory must not already exist")
    spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
    inspected = validate_spec(spec, spec_dir=spec_path.parent)
    before = fingerprint(spec_path, spec, inspected)
    output_dir.mkdir(parents=True, exist_ok=False)
    result = {
        "version": 1,
        "spec": str(spec_path),
        "scope": "fixed-spec-hwpx-bytes",
        "python": sys.version,
        "platform": platform.platform(),
        "dependencies": {},
        "inputs_before": before,
        "runs": [],
        "expected_sha256": expected_sha256,
        "visual_review": "not_run",
        "model_consistency": "not_evaluated",
    }
    for name in ("lxml", "jsonschema", "Pillow", "pywin32"):
        try:
            result["dependencies"][name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            result["dependencies"][name] = None
    for index in range(1, runs + 1):
        target = output_dir / f"run-{index}.hwpx"
        entry = {"index": index, "output": str(target), "ok": False}
        try:
            run = subprocess.run(
                [
                    sys.executable,
                    "-X",
                    "utf8",
                    str(ROOT / "scripts/one_shot.py"),
                    str(spec_path),
                    "--output",
                    str(target),
                ],
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                timeout=90,
                env={**os.environ, "PYTHONUTF8": "1"},
            )
            entry.update(exit_code=run.returncode, stdout=run.stdout, stderr=run.stderr)
            report = json.loads(run.stdout)
            entry["ok"] = (
                run.returncode == 0
                and report.get("ok") is True
                and report.get("published") is True
                and target.is_file()
            )
            if target.is_file():
                entry["sha256"] = sha256(target)
        except Exception as exc:
            entry["error"] = f"{type(exc).__name__}: {exc}"
        result["runs"].append(entry)
    try:
        after_spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
        after_inspected = validate_spec(after_spec, spec_dir=spec_path.parent)
        result["inputs_after"] = fingerprint(spec_path, after_spec, after_inspected)
        result["inputs_unchanged"] = before == result["inputs_after"]
    except Exception as exc:
        result.update(inputs_unchanged=False, input_error=str(exc))
    hashes = [entry.get("sha256") for entry in result["runs"]]
    result["byte_identical"] = all(hashes) and len(set(hashes)) == 1
    result["matches_expected"] = (
        None
        if expected_sha256 is None
        else all(h == expected_sha256.lower() for h in hashes)
    )
    result["ok"] = bool(
        result["inputs_unchanged"]
        and result["byte_identical"]
        and all(entry["ok"] for entry in result["runs"])
        and result["matches_expected"] is not False
    )
    result["status"] = "PASS" if result["ok"] else "FAIL"
    (output_dir / "reproducibility.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--expected-sha256")
    args = parser.parse_args()
    try:
        result = verify(args.spec, args.output_dir, args.runs, args.expected_sha256)
        # The full receipt retains subprocess logs; stdout stays readable.
        print(
            json.dumps(
                {
                    k: result[k]
                    for k in (
                        "status",
                        "ok",
                        "byte_identical",
                        "inputs_unchanged",
                        "matches_expected",
                    )
                },
                ensure_ascii=False,
            )
        )
        return 0 if result["ok"] else 2
    except Exception as exc:
        print(
            json.dumps(
                {"ok": False, "status": "FAIL", "error": str(exc)}, ensure_ascii=False
            )
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
