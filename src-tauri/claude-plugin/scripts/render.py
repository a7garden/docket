"""산출물 파일의 쪽을 PNG 로 그린다. 그린 그림은 Read 로 열어 넘친 글 · 밀린 쪽 · 겹친 도형 · 남은 견본을 눈으로 본다.

  python render.py <파일> <빈 출력 폴더> [--max-pages 12] [--dpi 80] [--engine auto|libreoffice|office|rhwp|hancom] [--expected-pages N]

엔진(auto 일 때 고르는 순서)
  docx · xlsx · pptx  LibreOffice → Microsoft Office(COM). 둘 다 없으면 그리지 못했다고 알린다.
  hwpx · hwp          rhwp(내장, Node 필요 · 빠르고 창이 뜨지 않지만 글자 폭을 어림해 쪽 나눔이 조금 다를 수 있다) → 한컴(COM).
                      쪽 수를 정확히 맞춰야 하면 --engine hancom 으로 다시 본다(20초쯤 걸린다).
                      docket 설정에서 한컴을 껐으면(DOCKET_HANCOM=0) 한컴은 쓰지 않는다.

출력: 엔진 · 전체 쪽 수 · 그린 PNG 경로. --expected-pages 와 쪽 수가 다르면 종료 코드 1.
원본은 건드리지 않는다. 변환은 시스템 임시 폴더의 사본으로 한다.
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OFFICE_EXT = {".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".odt", ".ods", ".odp", ".rtf"}
HWP_EXT = {".hwpx", ".hwp"}


def pymupdf():
	try:
		import pymupdf as m
	except ImportError:
		import fitz as m
	return m


def soffice():
	found = shutil.which("soffice") or shutil.which("soffice.com")
	if found:
		return found
	for base in (os.environ.get("ProgramFiles", ""), os.environ.get("ProgramFiles(x86)", "")):
		p = os.path.join(base, "LibreOffice", "program", "soffice.com")
		if base and os.path.exists(p):
			return p
	return None


def to_pdf_libreoffice(src, tmp):
	exe = soffice()
	if not exe:
		raise RuntimeError("LibreOffice 가 없다")
	# 따로 쓰는 사용자 프로필 — 사용자가 LibreOffice 를 켜 두었어도 부딪히지 않는다.
	profile = "file:///" + os.path.join(tmp, "profile").replace("\\", "/")
	out = os.path.join(tmp, "pdf")
	subprocess.run([exe, f"-env:UserInstallation={profile}", "--headless", "--convert-to", "pdf", "--outdir", out, src], capture_output=True, timeout=300)
	pdf = os.path.join(out, os.path.splitext(os.path.basename(src))[0] + ".pdf")
	if not os.path.exists(pdf):
		raise RuntimeError("LibreOffice 가 PDF 를 만들지 못했다")
	return pdf


def to_pdf_office(src, tmp):
	"""Microsoft Office 로 PDF 를 만든다. 읽기 전용으로 열고 창 · 경고를 띄우지 않는다."""
	import pythoncom
	import win32com.client as w

	pythoncom.CoInitialize()
	pdf = os.path.join(tmp, "office.pdf")
	ext = os.path.splitext(src)[1].lower()
	if ext in (".docx", ".doc", ".rtf", ".odt"):
		app = w.DispatchEx("Word.Application")
		app.Visible, app.DisplayAlerts = False, 0
		try:
			d = app.Documents.Open(src, ReadOnly=True, AddToRecentFiles=False)
			d.ExportAsFixedFormat(pdf, 17)
			d.Close(False)
		finally:
			app.Quit()
	elif ext in (".xlsx", ".xls", ".ods"):
		app = w.DispatchEx("Excel.Application")
		app.Visible, app.DisplayAlerts = False, False
		try:
			b = app.Workbooks.Open(src, ReadOnly=True, AddToMru=False)
			b.ExportAsFixedFormat(0, pdf)
			b.Close(False)
		finally:
			app.Quit()
	else:
		app = w.DispatchEx("PowerPoint.Application")
		try:
			p = app.Presentations.Open(src, ReadOnly=True, WithWindow=False)
			p.SaveAs(pdf, 32)
			p.Close()
		finally:
			app.Quit()
	if not os.path.exists(pdf):
		raise RuntimeError("Office 가 PDF 를 만들지 못했다")
	return pdf


def to_pdf_hancom(src, tmp):
	"""hwpx 스킬의 한컴 렌더러로 PDF 만 받는다. 그 렌더러의 PNG 단계는 이 PC 에서 실패할 때가 있어 쓰지 않는다."""
	script = os.path.join(HERE, "..", "skills", "hwpx", "scripts", "render_hwpx.py")
	out = os.path.join(tmp, "hancom")
	subprocess.run([sys.executable, script, src, "--output-dir", out], capture_output=True, timeout=300)
	pdf = os.path.join(out, "document.pdf")
	if not os.path.exists(pdf):
		raise RuntimeError("한컴이 PDF 를 만들지 못했다(한컴이 없거나 보안 확인 창에 막혔다)")
	return pdf


def render_pdf(pdf, out, stem, max_pages, dpi):
	m = pymupdf()
	doc = m.open(pdf)
	pngs = []
	for i in range(min(len(doc), max_pages)):
		path = os.path.join(out, f"{stem}-p{i + 1:02d}.png")
		doc[i].get_pixmap(dpi=dpi).save(path)
		pngs.append(path)
	return len(doc), pngs


def render_rhwp(src, tmp, out, stem, max_pages, dpi):
	if not shutil.which("node"):
		raise RuntimeError("Node 가 없다")
	svg_dir = os.path.join(tmp, "svg")
	r = subprocess.run(["node", os.path.join(HERE, "rhwp_render.mjs"), src, svg_dir, str(max_pages)], capture_output=True, text=True, encoding="utf-8", timeout=180)
	lines = [l for l in r.stdout.splitlines() if l.strip()]
	if r.returncode != 0 or not lines:
		raise RuntimeError(f"rhwp 가 그리지 못했다: {r.stderr.strip()[-300:]}")
	m = pymupdf()
	pngs = []
	for i, svg in enumerate(lines[1:]):
		path = os.path.join(out, f"{stem}-p{i + 1:02d}.png")
		page = m.open(svg)[0]
		page.get_pixmap(dpi=dpi).save(path)
		pngs.append(path)
	return int(lines[0]), pngs


def main():
	ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
	ap.add_argument("file")
	ap.add_argument("out")
	ap.add_argument("--max-pages", type=int, default=12)
	ap.add_argument("--dpi", type=int, default=80)
	ap.add_argument("--engine", default="auto", choices=["auto", "libreoffice", "office", "rhwp", "hancom"])
	ap.add_argument("--expected-pages", type=int)
	a = ap.parse_args()

	src = os.path.abspath(a.file)
	ext = os.path.splitext(src)[1].lower()
	if not os.path.isfile(src):
		raise SystemExit(f"파일이 없다: {src}")
	if os.path.exists(a.out) and os.listdir(a.out):
		raise SystemExit(f"출력 폴더가 비어 있지 않다: {a.out} — 지난 그림과 섞이지 않게 새 폴더를 준다")
	os.makedirs(a.out, exist_ok=True)
	stem = os.path.splitext(os.path.basename(src))[0]

	# 앱 설정 「한컴으로 확인」이 꺼져 있으면(DOCKET_HANCOM=0) 한컴을 띄우지 않는다. 띄울 때마다 접근 확인 창이 뜬다.
	hancom_off = os.environ.get("DOCKET_HANCOM") == "0"
	if a.engine == "hancom" and hancom_off:
		raise SystemExit("한컴은 docket 설정에서 꺼져 있다(「설정 › 산출물 › 한컴으로 확인」). rhwp 로 본 결과를 쓰고, 정확한 쪽 수는 확인하지 못했다고 적는다")
	if ext in HWP_EXT:
		order = ["rhwp"] if hancom_off else ["rhwp", "hancom"]
	elif ext in OFFICE_EXT:
		order = ["libreoffice", "office"]
	elif ext == ".pdf":
		order = ["pdf"]
	else:
		raise SystemExit(f"그릴 수 없는 형식이다: {ext}")
	if a.engine != "auto":
		order = [a.engine]

	tried = []
	with tempfile.TemporaryDirectory() as tmp:
		copy = os.path.join(tmp, "src" + ext)
		shutil.copy(src, copy)
		for engine in order:
			try:
				if engine == "rhwp":
					total, pngs = render_rhwp(copy, tmp, a.out, stem, a.max_pages, a.dpi)
				else:
					pdf = {"libreoffice": to_pdf_libreoffice, "office": to_pdf_office, "hancom": to_pdf_hancom, "pdf": lambda s, t: s}[engine](copy, tmp)
					total, pngs = render_pdf(pdf, a.out, stem, a.max_pages, a.dpi)
				break
			except Exception as e:  # 다음 엔진으로 넘어간다. 까닭은 모아 두었다가 모두 실패하면 알린다.
				tried.append(f"{engine}: {e}")
		else:
			print("그리지 못했다 — " + " · ".join(tried))
			print("결과에 「쪽 그림 확인을 못 했다」와 이 까닭을 적는다")
			sys.exit(2)

	note = " (글자 폭을 어림한 근사 — 쪽 나눔이 한컴과 조금 다를 수 있다)" if engine == "rhwp" else ""
	print(f"엔진: {engine}{note}")
	if tried:
		print("건너뛴 엔진: " + " · ".join(tried))
	print(f"쪽: 전체 {total}쪽 · 그린 {len(pngs)}쪽" + (f" (앞 {a.max_pages}쪽만 — 더 보려면 --max-pages)" if total > len(pngs) else ""))
	for p in pngs:
		print(p)
	if a.expected_pages and a.expected_pages != total:
		print(f"쪽 수가 다르다: 바란 {a.expected_pages}쪽 · 실제 {total}쪽")
		sys.exit(1)


if __name__ == "__main__":
	sys.stdout.reconfigure(encoding="utf-8")
	main()
