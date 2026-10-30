"""산출물을 파일로 만들 때 쓰는 도구가 이 PC 에 있는지 본다. 결과는 JSON 한 덩이로 표준 출력에 낸다.

  python doctor.py

앱의 「설정 › 산출물 › 문서 도구」가 이것을 부른다. 파이썬이 없으면 이 스크립트도 못 도니, 그 경우는 앱이 따로 알린다.
항목마다 need 는 required(그 형식을 만들 수 없다) · optional(만들되 쪽 그림 확인 · 계산값 넣기 같은 확인이 빠진다)다.
"""

import importlib.metadata as md
import importlib.util
import json
import os
import shutil
import subprocess
import sys


def pkg(module, dist):
	if importlib.util.find_spec(module) is None:
		return False, ""
	try:
		return True, md.version(dist)
	except md.PackageNotFoundError:
		return True, ""


def com_registered(progid):
	if sys.platform != "win32":
		return False
	import winreg

	try:
		winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, progid))
		return True
	except OSError:
		return False


def security_module():
	"""한컴 자동화 보안 모듈(FilePathCheckerModule) DLL 경로. hancom_worker 가 이 이름으로 등록을 부른다.
	레지스트리에 이름만 있고 파일이 없으면 등록되지 않은 것으로 본다."""
	if sys.platform != "win32":
		return ""
	import winreg

	try:
		with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\HNC\HwpAutomation\Modules") as k:
			path, _ = winreg.QueryValueEx(k, "FilePathCheckerModule")
	except OSError:
		return ""
	return path if os.path.isfile(str(path)) else ""


def soffice():
	found = shutil.which("soffice") or shutil.which("soffice.com")
	if found:
		return found
	for base in (os.environ.get("ProgramFiles", ""), os.environ.get("ProgramFiles(x86)", "")):
		p = os.path.join(base, "LibreOffice", "program", "soffice.com")
		if base and os.path.exists(p):
			return p
	return ""


def node_version():
	exe = shutil.which("node")
	if not exe:
		return ""
	try:
		return subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=10).stdout.strip()
	except Exception:
		return ""


def main():
	items = []

	def add(key, label, ok, detail, need, used):
		items.append({"key": key, "label": label, "ok": bool(ok), "detail": detail, "need": need, "usedFor": used})

	add("python", "Python", True, sys.version.split()[0], "required", "워드 · 엑셀 · 파워포인트 · 한글")
	missing = []
	for module, dist, label, need, used in [
		("docx", "python-docx", "python-docx", "required", "워드"),
		("openpyxl", "openpyxl", "openpyxl", "required", "엑셀"),
		("lxml", "lxml", "lxml", "required", "엑셀 · 한글"),
		("pptx", "python-pptx", "python-pptx", "required", "파워포인트"),
		("PIL", "Pillow", "Pillow", "required", "파워포인트 · 한글"),
		("jsonschema", "jsonschema", "jsonschema", "required", "한글"),
		("pymupdf", "PyMuPDF", "PyMuPDF", "optional", "쪽 그림 확인"),
		("win32com", "pywin32", "pywin32", "optional", "Office · 한컴으로 쪽 그림 확인"),
	]:
		ok, ver = pkg(module, dist)
		if not ok and module == "pymupdf":
			ok, ver = pkg("fitz", dist)
		add(dist, label, ok, ver or ("" if ok else "없음"), need, used)
		if not ok:
			missing.append(dist)

	lo = soffice()
	add("libreoffice", "LibreOffice", lo, lo or "없음", "optional", "쪽 그림 확인 · 엑셀 수식 계산값")
	office = [n for n, p in [("Word", "Word.Application"), ("Excel", "Excel.Application"), ("PowerPoint", "PowerPoint.Application")] if com_registered(p)]
	add("office", "Microsoft Office", office, " · ".join(office) or "없음", "optional", "LibreOffice 가 없을 때 쪽 그림 확인")
	nv = node_version()
	add("node", "Node.js", nv, nv or "없음", "optional", "한글 쪽 그림 확인(한컴 없이) · hwp 변환")
	hancom = com_registered("HWPFrame.HwpObject")
	add("hancom", "한컴오피스", hancom, "있음" if hancom else "없음", "optional", "「한컴으로 확인」 — 정확한 쪽 수 · hwp 변환")
	if hancom:
		dll = security_module()
		add("hancom-module", "한컴 보안 모듈", dll, dll or "등록 안 됨 — 한컴으로 확인할 때마다 접근 확인 창이 뜬다", "optional", "「한컴으로 확인」 때 확인 창 없애기")

	install = f"\"{sys.executable}\" -m pip install {' '.join(missing)}" if missing else ""
	print(json.dumps({"python": sys.executable, "items": items, "install": install}, ensure_ascii=False))


if __name__ == "__main__":
	sys.stdout.reconfigure(encoding="utf-8")
	main()
