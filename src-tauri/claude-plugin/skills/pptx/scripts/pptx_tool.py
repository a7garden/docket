"""docket 산출물용 파워포인트(pptx) 도구. 템플릿 사본의 글자만 갈아 넣고 마스터 · 레이아웃 · 도형 위치는 그대로 둔다.

  inspect <pptx>                      슬라이드마다 레이아웃 · 도형(그룹 안까지, id · 이름 · 자리) · 글자 · 표 칸 · 차트 값을 보인다
  fill <template> <spec.json> <out>   템플릿 사본에 spec 의 작업을 적용해 out 에 쓴다. 템플릿은 건드리지 않는다
  new <spec.json> <out>               템플릿이 없을 때 슬라이드 목록으로 새 발표 자료를 만든다
  verify <template> <out>             슬라이드 크기 · 마스터 · 레이아웃 · 테마가 템플릿과 같은지 견주고, 견본 글자가 남은 도형을 보인다.
                                      디자인이 다르면 종료 코드 1

자리 표시: 슬라이드 s0 · 도형 s0.#5(도형 id, 그룹 안 도형도 같다) · 표 칸 s0.#5.r1.c2. 번호는 늘 템플릿(원본) 기준이다.
복제한 슬라이드는 duplicate 의 as 로 붙인 이름(예: dup1.#5)으로 가리킨다.
"""

import copy
import hashlib
import json
import math
import os
import re
import sys
import unicodedata

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.chart.data import CategoryChartData, XyChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn
from pptx.util import Pt

XY_TYPES = {XL_CHART_TYPE.XY_SCATTER, XL_CHART_TYPE.XY_SCATTER_LINES, XL_CHART_TYPE.XY_SCATTER_LINES_NO_MARKERS, XL_CHART_TYPE.XY_SCATTER_SMOOTH, XL_CHART_TYPE.XY_SCATTER_SMOOTH_NO_MARKERS}
LEFTOVER_MAX = 40

R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def shape_line(sh):
	kind = sh.shape_type
	ph = f" 자리표시 {sh.placeholder_format.type}" if sh.is_placeholder else ""
	return f"#{sh.shape_id} 「{sh.name}」 {kind}{ph} @({sh.left},{sh.top}) {sh.width}x{sh.height}"


def walk(shapes, depth=0):
	"""그룹 안까지 내려가며 도형을 준다. 도형 id 는 슬라이드 안에서 하나뿐이라 그룹 안 도형도 s0.#12 로 가리킨다."""
	for sh in shapes:
		yield sh, depth
		if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
			yield from walk(sh.shapes, depth + 1)


def chart_line(ch):
	plot = ch.plots[0] if len(ch.plots) else None
	cats = list(plot.categories) if plot is not None else []
	out = [f"차트 {ch.chart_type} · 항목 {cats}"]
	for s in ch.series:
		out.append(f"계열 「{s.name}」 {list(s.values)}")
	return out


def cmd_inspect(path):
	prs = Presentation(path)
	print(f"슬라이드 크기 {prs.slide_width}x{prs.slide_height} · 슬라이드 {len(prs.slides)}장 · 레이아웃 {sum(len(m.slide_layouts) for m in prs.slide_masters)}개")
	for i, s in enumerate(prs.slides):
		print(f"s{i}\t레이아웃 「{s.slide_layout.name}」")
		for sh, depth in walk(s.shapes):
			pad = "  " * (depth + 1)
			print(f"{pad}s{i}.{shape_line(sh)}{' (그룹 안)' if depth else ''}")
			if sh.has_text_frame:
				for p in sh.text_frame.paragraphs:
					if p.text.strip():
						print(f"{pad}  | {'  ' * p.level}{p.text}")
			if getattr(sh, "has_table", False) and sh.has_table:
				for ri, row in enumerate(sh.table.rows):
					for ci, cell in enumerate(row.cells):
						print(f"{pad}  s{i}.#{sh.shape_id}.r{ri}.c{ci}\t{cell.text}")
			if getattr(sh, "has_chart", False) and sh.has_chart:
				for line in chart_line(sh.chart):
					print(f"{pad}  {line}")
		if s.has_notes_slide and s.notes_slide.notes_text_frame.text.strip():
			print(f"  메모: {s.notes_slide.notes_text_frame.text}")


def set_font(run, name):
	"""라틴 글꼴만 정하면 한글은 테마의 동아시아 글꼴(없으면 대체 글꼴)로 나온다. 동아시아 글꼴(a:ea)도 함께 정한다."""
	run.font.name = name
	rPr = run._r.get_or_add_rPr()
	ea = rPr.find(qn("a:ea"))
	if ea is None:
		ea = rPr.makeelement(qn("a:ea"), {})
		rPr.find(qn("a:latin")).addnext(ea)
	ea.set("typeface", name)


def set_para(p, text):
	"""첫 글자 묶음의 서식으로 글자를 바꾸고 나머지 묶음은 지운다."""
	runs = p.runs
	for r in runs[1:]:
		r._r.getparent().remove(r._r)
	if runs:
		runs[0].text = text
	else:
		p.add_run().text = text


def set_lines(tf, lines):
	"""줄마다 문단 하나. 모자라면 마지막 문단을 본떠 늘리고, 남으면 지운다 — 글머리 · 들여쓰기 수준이 템플릿을 따른다.
	줄이 {"text": …, "level": n} 이면 수준을 바꾼다."""
	if isinstance(lines, str):
		lines = lines.split("\n")
	paras = list(tf.paragraphs)
	txBody = paras[0]._p.getparent()
	for i, line in enumerate(lines):
		text, level = (line.get("text", ""), line.get("level")) if isinstance(line, dict) else (line, None)
		if i < len(paras):
			p = paras[i]
		else:
			el = copy.deepcopy(paras[-1]._p)
			txBody.append(el)
			p = tf.paragraphs[-1]
		set_para(p, text)
		if level is not None:
			p.level = level
	for p in paras[len(lines):]:
		txBody.remove(p._p)


def find_shape(slide, sid, loc):
	for sh, _ in walk(slide.shapes):
		if sh.shape_id == sid:
			return sh
	raise SystemExit(f"없는 도형: {loc}")


def shape_at(names, loc):
	parts = loc.split(".")
	if len(parts) < 2 or not parts[1].startswith("#"):
		raise SystemExit(f"도형 id 가 없다: {loc} (예: s0.#5)")
	return slide_by(names, loc), find_shape(slide_by(names, loc), int(parts[1][1:]), loc), parts


def set_chart(sh, op, loc):
	"""차트 값만 바꾼다. 색 · 축 · 글꼴 같은 차트 서식은 그대로다."""
	if not getattr(sh, "has_chart", False) or not sh.has_chart:
		raise SystemExit(f"차트가 아니다: {loc}")
	ch = sh.chart
	data = XyChartData() if ch.chart_type in XY_TYPES else CategoryChartData()
	if isinstance(data, XyChartData):
		for s in op["series"]:
			ser = data.add_series(s["name"])
			for x, y in s["points"]:
				ser.add_data_point(x, y)
	else:
		data.categories = op["categories"]
		for s in op["series"]:
			data.add_series(s["name"], s["values"])
	ch.replace_data(data)


def set_image(slide, sh, path, fit, loc):
	"""그림만 갈아 끼우고 자리 · 테두리 · 효과는 둔다. contain 은 비율을 지켜 상자 안에 맞추고(가운데), cover 는 상자를 채우게 잘라 낸다."""
	if sh.shape_type != MSO_SHAPE_TYPE.PICTURE:
		raise SystemExit(f"그림 도형이 아니다: {loc}")
	_, rid = slide.part.get_or_add_image_part(path)
	blip = sh._element.blipFill.find(qn("a:blip"))
	old = blip.get(qn("r:embed"))
	blip.set(qn("r:embed"), rid)
	# 옛 그림을 아무도 가리키지 않으면 관계를 끊어 파일에 남지 않게 한다(다른 도형이 쓰면 drop_rel 이 남겨 둔다).
	if old and old != rid:
		slide.part.drop_rel(old)
	with Image.open(path) as im:
		iw, ih = im.size
	bw, bh = sh.width, sh.height
	sh.crop_left = sh.crop_right = sh.crop_top = sh.crop_bottom = 0
	if fit == "cover":
		r_img, r_box = iw / ih, bw / bh
		if r_img > r_box:
			c = (1 - r_box / r_img) / 2
			sh.crop_left = sh.crop_right = c
		elif r_img < r_box:
			c = (1 - r_img / r_box) / 2
			sh.crop_top = sh.crop_bottom = c
	else:
		k = min(bw / iw, bh / ih)
		w, h = int(iw * k), int(ih * k)
		sh.left, sh.top, sh.width, sh.height = sh.left + (bw - w) // 2, sh.top + (bh - h) // 2, w, h


def slide_by(names, loc):
	head = loc.split(".")[0]
	if head not in names:
		raise SystemExit(f"없는 슬라이드: {loc}")
	return names[head]


def duplicate(prs, src):
	"""슬라이드를 같은 레이아웃으로 복제한다. 그림 · 링크 관계를 새 rId 로 옮겨 도형이 같은 그림을 가리키게 한다. 메모는 복제하지 않는다."""
	new = prs.slides.add_slide(src.slide_layout)
	tree = new.shapes._spTree
	for el in list(tree):
		if el.tag not in (qn("p:nvGrpSpPr"), qn("p:grpSpPr")):
			tree.remove(el)
	remap = {}
	for rid, rel in src.part.rels.items():
		if rel.reltype.endswith("/notesSlide") or rel.reltype.endswith("/slideLayout"):
			continue
		remap[rid] = new.part.relate_to(rel.target_ref, rel.reltype, is_external=True) if rel.is_external else new.part.relate_to(rel._target, rel.reltype)
	for el in src.shapes._spTree:
		if el.tag in (qn("p:nvGrpSpPr"), qn("p:grpSpPr")):
			continue
		el = copy.deepcopy(el)
		for node in el.iter():
			for attr in list(node.attrib):
				if attr.startswith("{" + R_NS + "}") and node.get(attr) in remap:
					node.set(attr, remap[node.get(attr)])
		tree.append(el)
	bg = src._element.cSld.bg
	if bg is not None:
		new._element.cSld.insert(0, copy.deepcopy(bg))
	return new


def move_after(prs, slide, anchor):
	lst = prs.slides._sldIdLst
	ids = list(lst)
	me = next(e for e in ids if prs.part.related_part(e.rId) is slide.part)
	at = next(e for e in ids if prs.part.related_part(e.rId) is anchor.part)
	lst.remove(me)
	at.addnext(me)


def cmd_fill(template, spec_path, out):
	check_out(template, out)
	prs = Presentation(template)
	names = {f"s{i}": s for i, s in enumerate(prs.slides)}
	spec = json.load(open(spec_path, encoding="utf-8"))
	doomed, tail, touched = [], {}, set()
	for op in spec.get("ops", []):
		if "duplicate" in op:
			# 원본 바로 뒤에 둔다. 같은 슬라이드를 여러 번 복제하면 적은 순서대로 이어진다.
			src = slide_by(names, op["duplicate"])
			new = duplicate(prs, src)
			move_after(prs, new, tail.get(op["duplicate"], src))
			tail[op["duplicate"]] = new
			if "as" in op:
				names[op["as"]] = new
		elif "chart" in op:
			_, sh, _ = shape_at(names, op["chart"])
			set_chart(sh, op, op["chart"])
		elif "image" in op:
			slide, sh, _ = shape_at(names, op["image"])
			set_image(slide, sh, op["path"], op.get("fit", "contain"), op["image"])
		elif "set" in op:
			loc = op["set"]
			slide, sh, parts = shape_at(names, loc)
			if len(parts) == 4:
				cell = sh.table.cell(int(parts[2][1:]), int(parts[3][1:]))
				set_lines(cell.text_frame, op.get("lines", op.get("text", "")))
			elif sh.has_text_frame:
				set_lines(sh.text_frame, op.get("lines", op.get("text", "")))
				touched.add((slide.slide_id, sh.shape_id))
			else:
				raise SystemExit(f"글자를 넣을 수 없는 도형: {loc}")
		elif "notes" in op:
			slide_by(names, op["notes"]).notes_slide.notes_text_frame.text = op["text"]
		elif "delete" in op:
			loc = op["delete"]
			slide = slide_by(names, loc)
			parts = loc.split(".")
			if len(parts) == 1:
				doomed.append(slide)
			else:
				sh = find_shape(slide, int(parts[1][1:]), loc)
				sh._element.getparent().remove(sh._element)
		else:
			raise SystemExit(f"모르는 작업: {op}")
	lst = prs.slides._sldIdLst
	for slide in doomed:
		for e in list(lst):
			if prs.part.related_part(e.rId) is slide.part:
				prs.part.drop_rel(e.rId)
				lst.remove(e)
	prs.save(out)
	print(f"썼다: {out}")
	overflow(prs, touched)


def cmd_new(spec_path, out):
	check_out(None, out)
	spec = json.load(open(spec_path, encoding="utf-8"))
	prs = Presentation()
	if spec.get("wide", True):
		# 기본 서식은 4:3 이다. 폭만 넓히면 자리표시가 왼쪽에 몰리므로 마스터 · 레이아웃 도형의 가로 자리도 같은 비율로 넓힌다.
		k = 12192000 / prs.slide_width
		prs.slide_width, prs.slide_height = 12192000, 6858000
		# 자기 xfrm 이 있는 도형만 넓힌다. 위치를 물려받는 자리표시에 left 를 쓰면 높이 0 인 xfrm 이 새로 생기고, 마스터에서 이미 넓힌 값을 또 넓힌다.
		for m in prs.slide_masters:
			for sh in [*m.shapes, *(s for lay in m.slide_layouts for s in lay.shapes)]:
				xfrm = sh._element.find(".//" + qn("a:xfrm"))
				if xfrm is None or xfrm.find(qn("a:off")) is None:
					continue
				off, ext = xfrm.find(qn("a:off")), xfrm.find(qn("a:ext"))
				off.set("x", str(int(int(off.get("x")) * k)))
				ext.set("cx", str(int(int(ext.get("cx")) * k)))
	title_layout, body_layout = prs.slide_layouts[0], prs.slide_layouts[1]
	for i, s in enumerate(spec.get("slides", [])):
		slide = prs.slides.add_slide(title_layout if i == 0 and s.get("cover", True) and "bullets" not in s else body_layout)
		slide.shapes.title.text = s.get("title", "")
		ph = [p for p in slide.placeholders if p.placeholder_format.idx != 0]
		if ph:
			body = s.get("subtitle") if "bullets" not in s else s["bullets"]
			if body:
				set_lines(ph[0].text_frame, body)
			else:
				ph[0]._element.getparent().remove(ph[0]._element)
		for shp in slide.shapes:
			if shp.has_text_frame:
				for p in shp.text_frame.paragraphs:
					for r in p.runs:
						set_font(r, spec.get("font", "맑은 고딕"))
						# 0.5pt 단위 크기는 받지 않는다 — 크기가 슬라이드마다 조금씩 달라 보인다.
						if shp != slide.shapes.title and s.get("size"):
							r.font.size = Pt(round(s["size"]))
		if s.get("notes"):
			slide.notes_slide.notes_text_frame.text = s["notes"]
	prs.save(out)
	print(f"썼다: {out}")


def part_hashes(prs):
	"""마스터 · 레이아웃 · 테마 파트의 바이트 해시. 이것이 같으면 디자인을 건드리지 않은 것이다."""
	out = {}
	for m in prs.slide_masters:
		out[str(m.part.partname)] = hashlib.sha256(m.part.blob).hexdigest()
		for rel in m.part.rels.values():
			if rel.reltype.endswith("/theme"):
				out[str(rel._target.partname)] = hashlib.sha256(rel._target.blob).hexdigest()
		for lay in m.slide_layouts:
			out[str(lay.part.partname)] = hashlib.sha256(lay.part.blob).hexdigest()
	return out


def cmd_verify(template, out):
	a, b = Presentation(template), Presentation(out)
	bad = []
	if (a.slide_width, a.slide_height) != (b.slide_width, b.slide_height):
		bad.append(f"슬라이드 크기가 다르다: {a.slide_width}x{a.slide_height} → {b.slide_width}x{b.slide_height}")
	ha, hb = part_hashes(a), part_hashes(b)
	for name in sorted(set(ha) | set(hb)):
		if ha.get(name) != hb.get(name):
			bad.append(f"디자인 파트가 바뀌었다: {name}")
	for line in bad:
		print("다름:", line)
	print(f"같다: 슬라이드 크기 · 마스터 · 레이아웃 · 테마 ({len(a.slides)}장 → {len(b.slides)}장)" if not bad else f"{len(bad)}건 다르다")
	typo_bad = typography(a, b)
	leftover(a, b)
	overflow(b)
	sys.exit(1 if bad or typo_bad else 0)


# ---------- 글자 크기 · 글꼴 · 넘침 ----------

THEME_FONT = re.compile(r"^\+(mj|mn)-(lt|ea|cs)$")
SZ_TAGS = ("a:rPr", "a:defRPr", "a:endParaRPr")


def type_parts(prs, design=True):
	"""글자 크기 · 글꼴을 모을 요소. design 이면 마스터 · 레이아웃 · 테마까지 — 템플릿이 쓰는 크기 · 글꼴의 범위다."""
	els = [s._element for s in prs.slides]
	if design:
		for m in prs.slide_masters:
			els.append(m._element)
			els.extend(lay._element for lay in m.slide_layouts)
			for rel in m.part.rels.values():
				if rel.reltype.endswith("/theme"):
					els.append(etree.fromstring(rel._target.blob))
	return els


def sizes_fonts(els):
	sizes, fonts = set(), set()
	for el in els:
		for tag in SZ_TAGS:
			for r in el.iter(qn(tag)):
				if r.get("sz"):
					sizes.add(int(r.get("sz")))
		for tag in ("a:latin", "a:ea"):
			for f in el.iter(qn(tag)):
				face = f.get("typeface", "")
				if face and not THEME_FONT.match(face):
					fonts.add(face)
	return sizes, fonts


def typography(a, b):
	"""결과 슬라이드의 글자 크기 · 글꼴이 템플릿 범위 안인지 본다. 정수가 아닌 크기 · 템플릿에 없던 크기 · 글꼴은 실패로 친다.
	2026.10.29 : 성과발표 v3 에 11.5 · 12.5 · 13.5pt 가 섞이고 본문 크기가 일곱 단계였다 — 넘친 글을 글자를 조금씩 줄여 맞춘 흔적이다."""
	allowed_sizes, allowed_fonts = sizes_fonts(type_parts(a))
	bad = []
	for i, s in enumerate(b.slides):
		odd, new_sizes, new_fonts, scaled = set(), set(), set(), 0
		for tag in SZ_TAGS:
			for r in s._element.iter(qn(tag)):
				sz = r.get("sz")
				if not sz:
					continue
				sz = int(sz)
				if sz % 100:
					odd.add(sz / 100)
				elif sz not in allowed_sizes:
					new_sizes.add(sz // 100)
		for tag in ("a:latin", "a:ea"):
			for f in s._element.iter(qn(tag)):
				face = f.get("typeface", "")
				if face and not THEME_FONT.match(face) and face not in allowed_fonts:
					new_fonts.add(face)
		for fit in s._element.iter(qn("a:normAutofit")):
			if fit.get("fontScale"):
				scaled += 1
		if odd:
			bad.append(f"s{i} 정수가 아닌 글자 크기 {sorted(odd)}pt")
		if new_sizes:
			bad.append(f"s{i} 템플릿에 없던 글자 크기 {sorted(new_sizes)}pt — 템플릿의 크기 {sorted(x // 100 for x in allowed_sizes if not x % 100)} 가운데서 고른다")
		if new_fonts:
			bad.append(f"s{i} 템플릿에 없던 글꼴 {sorted(new_fonts)}")
		if scaled:
			bad.append(f"s{i} 자동 맞춤으로 글자가 줄어든 상자 {scaled}개 — 화면에 정수가 아닌 크기로 보인다. 글을 줄이거나 슬라이드를 나눈다")
	if bad:
		print(f"글자: {len(bad)}건 — 글자 크기를 바꿔 맞추지 않는다")
		for line in bad:
			print("  " + line)
	else:
		print("글자: 크기 · 글꼴이 모두 템플릿 범위 안이다")
	return bool(bad)


def lvl_size(el, level, tag="a:lstStyle"):
	"""lstStyle · txStyles 같은 목록 서식에서 그 수준의 기본 글자 크기(1/100pt)."""
	if el is None:
		return None
	node = el.find(f"{qn(tag)}/{qn(f'a:lvl{level + 1}pPr')}/{qn('a:defRPr')}") if tag else el.find(f"{qn(f'a:lvl{level + 1}pPr')}/{qn('a:defRPr')}")
	return int(node.get("sz")) if node is not None and node.get("sz") else None


def effective_size(slide, sh, p):
	"""문단의 실제 글자 크기(pt)를 어림한다. 글자 묶음 → 도형의 목록 서식 → 레이아웃 자리표시 → 마스터 글 서식 순으로 찾는다."""
	for r in p.runs:
		if r.font.size:
			return r.font.size.pt
	lvl = p.level
	body = sh.text_frame._txBody
	found = lvl_size(body, lvl)
	if found:
		return found / 100
	kind = "other"
	if sh.is_placeholder:
		pf = sh.placeholder_format
		kind = "title" if pf.type in (1, 3) else "body"  # TITLE · CENTER_TITLE 은 제목 서식
		for lay_ph in slide.slide_layout.placeholders:
			if lay_ph.placeholder_format.idx == pf.idx and lay_ph.has_text_frame:
				found = lvl_size(lay_ph.text_frame._txBody, lvl)
				if found:
					return found / 100
				for lp in lay_ph.text_frame.paragraphs:
					for r in lp.runs:
						if r.font.size:
							return r.font.size.pt
	styles = slide.slide_layout.slide_master._element.find(qn("p:txStyles"))
	if styles is not None:
		found = lvl_size(styles.find(qn(f"p:{kind}Style")), lvl, tag=None)
		if found:
			return found / 100
	return 18.0


def text_width(text, size):
	"""글 한 줄의 폭(pt) 어림. 한글 · 전각 = 글자 크기, 공백 = 0.3배, 그 밖 = 0.55배."""
	w = 0.0
	for ch in text:
		if unicodedata.east_asian_width(ch) in "WF":
			w += size
		elif ch.isspace():
			w += size * 0.3
		else:
			w += size * 0.55
	return w


def overflow(prs, only=None):
	"""글이 상자를 넘칠 것 같은 도형을 어림해 알린다. 표 칸은 행이 늘어나므로 보지 않는다. 쪽 그림 확인 전에 먼저 잡으려는 것이다.
	only 가 있으면 그 (slide_id, 도형 id) 만 본다 — fill 이 글을 넣은 도형만."""
	warn = []
	for i, s in enumerate(prs.slides):
		for sh, depth in walk(s.shapes):
			if not sh.has_text_frame or not sh.text_frame.text.strip() or (only is not None and (s.slide_id, sh.shape_id) not in only):
				continue
			body = sh.text_frame._txBody.find(qn("a:bodyPr"))
			if body is not None and body.get("wrap") == "none":
				continue
			ins = lambda k, d: int(body.get(k)) if body is not None and body.get(k) else d
			try:
				w = (sh.width - ins("lIns", 91440) - ins("rIns", 91440)) / 12700
				h = (sh.height - ins("tIns", 45720) - ins("bIns", 45720)) / 12700
			except TypeError:
				continue  # 자리를 끝내 알 수 없는 도형
			if w <= 0 or h <= 0:
				continue
			need = 0.0
			for p in sh.text_frame.paragraphs:
				size = effective_size(s, sh, p)
				indent = p.level * size * 1.5
				lines = max(1, math.ceil(text_width(p.text, size) / max(w - indent, size)))
				need += lines * size * 1.2
			if need > h * 1.05:
				fit = ""
				if body is not None and body.find(qn("a:normAutofit")) is not None:
					fit = " · 자동 맞춤이 켜져 PowerPoint 가 글자를 줄여 넣는다(정수가 아닌 크기로 보인다)"
				elif body is not None and body.find(qn("a:spAutoFit")) is not None:
					fit = " · 상자가 늘어나 아래 도형과 겹칠 수 있다"
				warn.append(f"s{i}.#{sh.shape_id} 「{sh.name}」 글 높이 어림 {need:.0f}pt · 상자 {h:.0f}pt{fit}")
	if warn:
		print(f"넘침 어림: {len(warn)}곳 — 글자 크기를 줄이지 말고 글을 줄이거나 슬라이드를 나눈다. 쪽 그림으로 확인한다")
		for line in warn:
			print("  " + line)
	elif only is None:
		print("넘침 어림: 상자를 넘칠 것 같은 글이 없다")
	return warn


def shape_texts(prs):
	out = []
	for i, s in enumerate(prs.slides):
		for sh, _ in walk(s.shapes):
			if sh.has_text_frame and sh.text_frame.text.strip():
				out.append((f"s{i}.#{sh.shape_id}", sh.text_frame.text.strip()))
			if getattr(sh, "has_table", False) and sh.has_table:
				for ri, row in enumerate(sh.table.rows):
					for ci, cell in enumerate(row.cells):
						if cell.text.strip():
							out.append((f"s{i}.#{sh.shape_id}.r{ri}.c{ci}", cell.text.strip()))
	return out


def leftover(a, b):
	"""결과에 템플릿 글자가 그대로 남은 도형 · 칸. 고정 문구(기관명 · 머리글)도 섞이니 판정은 읽는 쪽이 한다."""
	seen = {t for _, t in shape_texts(a) if len(t) >= 2}
	same = [(loc, t) for loc, t in shape_texts(b) if t in seen]
	if not same:
		print("견본 글자: 템플릿과 같은 글자가 남은 도형이 없다")
		return
	print(f"견본 글자: 템플릿과 같은 글자가 남은 도형 · 칸 {len(same)}곳 — 고정 문구가 아니면 바꾸거나 지운다")
	for loc, t in same[:LEFTOVER_MAX]:
		print(f"  {loc}\t{t.replace(chr(10), ' / ')[:80]}")
	if len(same) > LEFTOVER_MAX:
		print(f"  … {len(same) - LEFTOVER_MAX}곳 더")


def check_out(template, out):
	if template and os.path.abspath(template) == os.path.abspath(out):
		raise SystemExit("템플릿에 덮어쓰지 않는다. 다른 경로를 준다")
	if os.path.exists(out):
		raise SystemExit(f"이미 있는 파일이다: {out}")


def main(argv):
	if len(argv) < 2 or argv[1] in ("-h", "--help"):
		print(__doc__)
		return
	cmd, args = argv[1], argv[2:]
	{"inspect": cmd_inspect, "fill": cmd_fill, "new": cmd_new, "verify": cmd_verify}[cmd](*args)


if __name__ == "__main__":
	sys.stdout.reconfigure(encoding="utf-8")
	main(sys.argv)
