"""Own one independent Hancom COM instance; optionally export a PDF.

Run through run_hancom, which bounds execution time. Never attaches to an
existing user document and never terminates processes by executable name.
"""

from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def run_hancom(path: Path, *, pdf: Path | None = None, timeout: float = 45) -> dict:
    # docket: 앱 설정 「한컴으로 확인」이 꺼져 있으면(DOCKET_HANCOM=0) 한컴을 띄우지 않는다. 띄울 때마다 접근 확인 창이 뜬다.
    # 「class not registered」를 담아 quality_gate 가 한컴 없음으로 보고 경고만 남기게 한다. 원 저장소 새 판을 받으면 이 줄을 다시 넣는다.
    if os.environ.get("DOCKET_HANCOM") == "0":
        return dict(ok=False, status="not_run", unavailable=True, message="Hancom is off in docket settings (treated as class not registered).")
    if not path.is_file():
        return dict(
            ok=False,
            status="failed",
            unavailable=False,
            message=f"input not found: {path}",
        )
    if os.name != "nt":
        return dict(
            ok=False,
            status="not_run",
            unavailable=True,
            message="Hancom is only available on Windows.",
        )
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        str(path.resolve()),
        "--worker",
    ]
    if pdf:
        if path.resolve() == pdf.resolve():
            raise ValueError("PDF path collides with input")
        command += ["--pdf", str(pdf.resolve())]
    started = time.perf_counter()
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            encoding="utf-8",
            timeout=timeout,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        report = json.loads(result.stdout)
    except subprocess.TimeoutExpired:
        report = dict(
            ok=False,
            status="timeout",
            unavailable=False,
            message="Hancom worker timed out; worker stopped. COM server cleanup not confirmed; user processes were not terminated.",
        )
    except (OSError, ValueError) as exc:
        report = dict(ok=False, status="failed", unavailable=False, message=str(exc))
    report["elapsed_ms"] = (time.perf_counter() - started) * 1000
    return report


def worker(path: Path, pdf: Path | None) -> dict:
    if pdf and (pdf.suffix.lower() != ".pdf" or pdf.resolve() == path.resolve()):
        return dict(ok=False, status="failed", message="unsafe PDF output path")
    try:
        import pythoncom
        import win32com.client
    except ImportError:
        return dict(
            ok=False,
            status="not_run",
            unavailable=True,
            message="pywin32 is not installed",
        )
    hwp = None
    pythoncom.CoInitialize()
    try:
        hwp = win32com.client.DispatchEx("HWPFrame.HwpObject")
        hwp.XHwpWindows.Item(0).Visible = False
        hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule")
        opened = bool(hwp.Open(str(path.resolve()), "HWPX", ""))
        if not opened:
            return dict(ok=False, status="failed", message="Hancom Open returned False")
        report = dict(
            ok=True,
            status="passed",
            opened=True,
            message="Independent Hancom Open succeeded.",
        )
        if pdf:
            pdf.parent.mkdir(parents=True, exist_ok=True)
            saved = bool(hwp.SaveAs(str(pdf.resolve()), "PDF", ""))
            report.update(
                ok=saved and pdf.is_file(), pdf=str(pdf), pages=int(hwp.PageCount)
            )
            report["status"] = "passed" if report["ok"] else "failed"
        return report
    except Exception as exc:
        unavailable = getattr(exc, "hresult", None) in (-2147221164, -2147221005)
        return dict(
            ok=False,
            status="not_run" if unavailable else "failed",
            unavailable=unavailable,
            message=str(exc),
        )
    finally:
        if hwp is not None:
            try:
                hwp.Quit()
            except Exception:
                pass
        pythoncom.CoUninitialize()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--pdf", type=Path)
    parser.add_argument("--worker", action="store_true")
    args = parser.parse_args()
    result = (
        worker(args.input, args.pdf)
        if args.worker
        else run_hancom(args.input, pdf=args.pdf)
    )
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 2)
