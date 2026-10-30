"""docket 산출물용 워드(docx) 도구. 템플릿 사본의 글자만 갈아 넣고 서식은 그대로 둔다.

  inspect <docx>                      문단 · 표 칸 · 글상자 · 머리말 · 꼬리말을 자리 표시와 함께 보인다
  fill <template> <spec.json> <out>   템플릿 사본에 spec 의 작업을 적용해 out 에 쓴다. 템플릿은 건드리지 않는다
  new <spec.json> <out>               템플릿이 없을 때 블록 목록으로 새 문서를 만든다
  verify <template> <out>             스타일 · 쪽 설정 · 표 구성이 템플릿과 같은지 견주고, 견본 글자가 남은 곳을 보인다.
                                      서식이 다르면 종료 코드 1

자리 표시 — 본문 문단 p3 · 표 t0 · 행 t0.r1 · 칸 t0.r1.c2 · 글상자 x0.p1 · 머리말 h0.p0 · 꼬리말 f0.p0 (숫자는 구역 번호).
번호는 늘 템플릿(원본)의 것이다. 앞에서 지우거나 끼워도 뒤 번호가 밀리지 않는다.
"""

import copy
import json
import os
import sys

from docx import Document
from docx.oxml.ns import qn
from docx.shared import Pt

W_P, W_TBL, W_TC, W_R, W_T, W_BR = qn("w:p"), qn("w:tbl"), qn("w:tc"), qn("w:r"), qn("w:t"), qn("w:br")
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
W_TXBX = qn("w:txbxContent")
LEFTOVER_MAX = 40


def blocks(doc):
	"""본문 맨 위 단계의 문단 · 표를 순서대로. 번호는 종류별로 센다."""
	out, np, nt = [], 0, 0
	for el in doc.element.body.iterchildren():
		if el.tag == W_P:
			out.append((f"p{np}", el))
			np += 1
		elif el.tag == W_TBL:
			out.append((f"t{nt}", el))
			nt += 1
	return out


def textboxes(doc):
	"""글상자 본문. Word 는 같은 글상자를 새 꼴(mc:Choice)과 옛 꼴(mc:Fallback)로 두 번 적는다 — 새 꼴만 세고, 고칠 때 옛 꼴도 같이 고친다."""
	out = []
	for tx in doc.element.body.iter(W_TXBX):
		if any(a.tag == f"{{{MC}}}Fallback" for a in tx.iterancestors()):
			continue
		out.append(tx)
	return out


def fallback_of(tx):
	"""글상자의 옛 꼴 짝. 없으면 None."""
	for a in tx.iterancestors():
		if a.tag == f"{{{MC}}}AlternateContent":
			fb = a.find(f"{{{MC}}}Fallback")
			if fb is not None:
				return next(fb.iter(W_TXBX), None)
	return None


def hf_parts(doc):
	"""구역마다 자기 정의가 있는 머리말 · 꼬리말만. 앞 구역 것을 잇는 쪽은 읽기만 해도 정의가 새로 생겨 건드리지 않는다."""
	out = {}
	for i, s in enumerate(doc.sections):
		if s.header._has_definition:
			out[f"h{i}"] = s.header._element
		if s.footer._has_definition:
			out[f"f{i}"] = s.footer._element
	return out


def para_text(p_el):
	"""문단 안 줄바꿈은 ⏎ 로 보인다. inspect 결과가 한 줄에 한 자리이게."""
	return "".join((n.text or "") if n.tag == W_T else "⏎" for n in p_el.iter(W_T, W_BR))


def has_drawing(el):
	return next(el.iter(qn("w:drawing"), qn("w:pict")), None) is not None


def rows_of(tbl_el):
	return list(tbl_el.iterchildren(qn("w:tr")))


def cells_of(tr_el):
	return list(tr_el.iterchildren(W_TC))


def style_of(p_el):
	s = p_el.find(qn("w:pPr") + "/" + qn("w:pStyle"))
	return s.get(qn("w:val")) if s is not None else ""


def cell_marks(tc):
	"""병합 · 표 속 표 · 그림 표시. 이어지는 세로 병합 칸은 화면에 보이지 않는 칸이라 쓰면 표가 깨진다."""
	marks = []
	pr = tc.find(qn("w:tcPr"))
	if pr is not None:
		span = pr.find(qn("w:gridSpan"))
		if span is not None:
			marks.append(f"가로 병합 {span.get(qn('w:val'))}")
		vm = pr.find(qn("w:vMerge"))
		if vm is not None:
			marks.append("세로 병합 시작" if vm.get(qn("w:val")) == "restart" else "세로 병합 이어짐 — 쓰지 않는다")
	if tc.find(W_TBL) is not None:
		marks.append("표 속 표 — 이 도구로 고치지 못한다")
	if has_drawing(tc):
		marks.append("그림")
	return f" [{' · '.join(marks)}]" if marks else ""


def cmd_inspect(path):
	doc = Document(path)
	for loc, el in blocks(doc):
		if el.tag == W_P:
			t = para_text(el)
			st = f"[{style_of(el)}]\t" if style_of(el) else ""
			pic = " [그림]" if has_drawing(el) else ""
			print(f"{loc}\t{st}{t}{pic}")
		else:
			rows = rows_of(el)
			print(f"{loc}\t표 {len(rows)}행")
			for ri, tr in enumerate(rows):
				for ci, tc in enumerate(cells_of(tr)):
					t = " / ".join(para_text(p) for p in tc.iterchildren(W_P))
					print(f"  {loc}.r{ri}.c{ci}\t{t}{cell_marks(tc)}")
	for xi, tx in enumerate(textboxes(doc)):
		print(f"x{xi}\t글상자")
		for pi, p in enumerate(tx.iterchildren(W_P)):
			print(f"  x{xi}.p{pi}\t{para_text(p)}")
	for key, el in hf_parts(doc).items():
		name = "머리말" if key[0] == "h" else "꼬리말"
		for pi, p in enumerate(el.iterchildren(W_P)):
			if para_text(p).strip():
				print(f"{key}.p{pi}\t{name}\t{para_text(p)}")
		if el.find(W_TBL) is not None:
			print(f"{key}\t{name}에 표가 있다 — 이 도구로 고치지 못한다")


def set_para(p_el, text, drop_images=False):
	"""첫 글자 묶음(run)의 서식으로 글자를 바꾼다. 나머지 묶음은 지운다. 줄바꿈은 같은 문단 안의 줄바꿈이 된다."""
	if has_drawing(p_el) and not drop_images:
		raise SystemExit("그림이 든 문단이다. 글자만 바꾸려면 replace 를 쓰고, 그림을 지워도 되면 drop_images: true 를 준다")
	runs = list(p_el.iterchildren(W_R))
	for r in runs[1:]:
		p_el.remove(r)
	for h in list(p_el.iterchildren(qn("w:hyperlink"))):
		p_el.remove(h)
	if runs:
		r = runs[0]
		for child in list(r):
			if child.tag != qn("w:rPr"):
				r.remove(child)
	else:
		r = p_el.makeelement(W_R, {})
		p_el.append(r)
	for i, line in enumerate(str(text).split("\n")):
		if i:
			r.append(r.makeelement(W_BR, {}))
		t = r.makeelement(W_T, {})
		t.text = line
		t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
		r.append(t)


def set_cell(tc_el, text, drop_images=False):
	"""칸의 첫 문단 서식으로 글자를 넣는다. 목록이면 줄마다 문단 하나."""
	marks = cell_marks(tc_el)
	if "이어짐" in marks or "표 속 표" in marks:
		raise SystemExit(f"쓸 수 없는 칸이다:{marks}")
	paras = list(tc_el.iterchildren(W_P))
	lines = text if isinstance(text, list) else [text]
	first = paras[0]
	for p in paras[1:]:
		if has_drawing(p) and not drop_images:
			raise SystemExit("그림이 든 칸이다. 그림을 지워도 되면 drop_images: true 를 준다")
		tc_el.remove(p)
	set_para(first, lines[0], drop_images)
	prev = first
	for line in lines[1:]:
		p = copy.deepcopy(first)
		set_para(p, line, True)
		prev.addnext(p)
		prev = p


def run_text(r):
	return "".join(t.text or "" for t in r.iter(W_T))


def put_run_text(r, text):
	"""글자 묶음의 글자만 갈아 끼운다. 서식(rPr)과 그림은 그대로 둔다."""
	ts = list(r.iter(W_T))
	if not ts:
		t = r.makeelement(W_T, {})
		r.append(t)
		ts = [t]
	ts[0].text = text
	ts[0].set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
	for t in ts[1:]:
		t.getparent().remove(t)


def replace_in_para(p_el, find, repl, every):
	"""문단 안에서 찾을 말만 바꾼다. 여러 글자 묶음에 걸쳐 있어도 되고, 앞뒤 묶음의 서식(굵은 이름표 등)은 그대로다.
	바뀐 글자는 찾을 말이 시작한 묶음의 서식을 따른다."""
	count, start = 0, 0
	while True:
		# 문단 안 그림에 든 글상자 문단의 묶음은 빼다 — 그 글자는 그 문단의 것이다.
		runs = [r for r in p_el.iter(W_R) if r.find(W_T) is not None and next(r.iterancestors(W_P)) is p_el]
		texts = [run_text(r) for r in runs]
		full = "".join(texts)
		i = full.find(find, start)
		if i < 0 or not find:
			return count
		j = i + len(find)
		pos, first = 0, None
		for k, tx in enumerate(texts):
			a, b = pos, pos + len(tx)
			if first is None and i < b:
				first = k
				put_run_text(runs[k], tx[: i - a] + repl + (tx[j - a :] if j <= b else ""))
			elif first is not None and a < j:
				put_run_text(runs[k], tx[j - a :] if j < b else "")
			pos = b
			if b >= j and first is not None:
				break
		count += 1
		start = i + len(repl)
		if not every:
			return count


def all_paras(doc):
	"""본문(표 · 글상자 안 포함)과 머리말 · 꼬리말의 문단. 문서 전체 바꾸기에 쓴다."""
	yield from doc.element.body.iter(W_P)
	for el in hf_parts(doc).values():
		yield from el.iter(W_P)


def resolve(index, loc):
	"""p3 · t0 · t0.r1 · t0.r1.c2 · x0.p1 · h0.p0 → 요소. 번호는 템플릿 기준이다."""
	head, *rest = loc.split(".")
	if head not in index:
		raise SystemExit(f"없는 자리: {loc}")
	el = index[head]
	for part in rest:
		if part.startswith("r"):
			el = rows_of(el)[int(part[1:])]
		elif part.startswith("c"):
			el = cells_of(el)[int(part[1:])]
		elif part.startswith("p"):
			el = list(el.iterchildren(W_P))[int(part[1:])]
		else:
			raise SystemExit(f"읽지 못한 자리: {loc}")
	return el


def mirror(loc, index, fallbacks):
	"""글상자 문단이면 옛 꼴 짝 문단도 돌려준다."""
	head, *rest = loc.split(".")
	fb = fallbacks.get(head)
	if fb is None or not rest or not rest[0].startswith("p"):
		return None
	ps = list(fb.iterchildren(W_P))
	n = int(rest[0][1:])
	return ps[n] if n < len(ps) else None


def cmd_fill(template, spec_path, out):
	check_out(template, out)
	doc = Document(template)
	index = dict(blocks(doc))
	fallbacks = {}
	for xi, tx in enumerate(textboxes(doc)):
		index[f"x{xi}"] = tx
		fallbacks[f"x{xi}"] = fallback_of(tx)
	index.update(hf_parts(doc))
	spec = json.load(open(spec_path, encoding="utf-8"))
	# 지울 것은 마지막에 지운다. 지운 요소를 다른 작업의 기준(like · 뒤에 끼우기)으로 쓸 수 있게.
	doomed, tail = [], {}
	for op in spec.get("ops", []):
		drop = op.get("drop_images", False)
		if "set" in op:
			el = resolve(index, op["set"])
			if el.tag == W_P:
				set_para(el, op["text"], drop)
				twin = mirror(op["set"], index, fallbacks)
				if twin is not None:
					set_para(twin, op["text"], True)
			elif el.tag == W_TC:
				set_cell(el, op["text"], drop)
			else:
				raise SystemExit(f"set 은 문단 · 칸에만 쓴다: {op['set']}")
		elif "replace" in op:
			target = op["replace"]
			paras = list(all_paras(doc)) if target == "*" else list(resolve(index, target).iter(W_P))
			if target != "*":
				twin = mirror(target, index, fallbacks)
				if twin is not None:
					paras.append(twin)
			n = sum(replace_in_para(p, op["find"], op["with"], op.get("all", target == "*")) for p in paras)
			if n == 0:
				raise SystemExit(f"찾지 못했다: {op['find']!r} ({target})")
		elif "insert_after" in op:
			# 같은 자리 뒤에 여러 번 끼우면 적은 순서대로 이어 붙는다.
			anchor = op["insert_after"]
			like = resolve(index, op.get("like", anchor))
			if like.tag not in (W_P, W_TBL):
				raise SystemExit(f"like 는 문단 · 표다: {op.get('like')}")
			el = copy.deepcopy(like)
			if el.tag == W_P:
				set_para(el, op.get("text", ""), True)
			tail.get(anchor, resolve(index, anchor)).addnext(el)
			tail[anchor] = el
		elif "add_row" in op:
			tbl = resolve(index, op["add_row"])
			rows = rows_of(tbl)
			like = rows[op.get("like", len(rows) - 1)]
			key = op["add_row"] + ".rows"
			tr = copy.deepcopy(like)
			for tc, text in zip(cells_of(tr), op.get("cells", [])):
				set_cell(tc, text, True)
			tail.get(key, rows[-1]).addnext(tr)
			tail[key] = tr
		elif "delete" in op:
			doomed.append(resolve(index, op["delete"]))
		else:
			raise SystemExit(f"모르는 작업: {op}")
	for el in doomed:
		el.getparent().remove(el)
	doc.save(out)
	print(f"썼다: {out}")


def cmd_new(spec_path, out):
	check_out(None, out)
	spec = json.load(open(spec_path, encoding="utf-8"))
	doc = Document()
	# 기본 글꼴이 한글을 갖추지 않아 한글 칸 글꼴을 함께 정한다.
	font = spec.get("font", "맑은 고딕")
	for name in ("Normal", "Heading 1", "Heading 2", "Heading 3", "Title"):
		st = doc.styles[name]
		st.font.name = font
		st.element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), font)
	doc.styles["Normal"].font.size = Pt(spec.get("size", 10.5))
	for b in spec.get("blocks", []):
		if "h1" in b or "h2" in b or "h3" in b:
			lv = 1 if "h1" in b else 2 if "h2" in b else 3
			doc.add_heading(b.get(f"h{lv}"), level=lv)
		elif "p" in b:
			doc.add_paragraph(b["p"])
		elif "bullets" in b:
			for item in b["bullets"]:
				doc.add_paragraph(item, style="List Bullet")
		elif "numbers" in b:
			for item in b["numbers"]:
				doc.add_paragraph(item, style="List Number")
		elif "table" in b:
			rows = b["table"]
			t = doc.add_table(rows=len(rows), cols=max(len(r) for r in rows))
			t.style = "Table Grid"
			for ri, r in enumerate(rows):
				for ci, v in enumerate(r):
					t.cell(ri, ci).text = str(v)
					if ri == 0:
						for run in t.cell(ri, ci).paragraphs[0].runs:
							run.bold = True
		elif "page_break" in b:
			doc.add_page_break()
		else:
			raise SystemExit(f"모르는 블록: {b}")
	doc.save(out)
	print(f"썼다: {out}")


def texts_by_loc(doc):
	"""자리 → 글자. 견본 글자가 남았는지 찾는 데 쓴다."""
	out = {}
	for loc, el in blocks(doc):
		if el.tag == W_P:
			out[loc] = para_text(el)
		else:
			for ri, tr in enumerate(rows_of(el)):
				for ci, tc in enumerate(cells_of(tr)):
					out[f"{loc}.r{ri}.c{ci}"] = " / ".join(para_text(p) for p in tc.iterchildren(W_P))
	for xi, tx in enumerate(textboxes(doc)):
		for pi, p in enumerate(tx.iterchildren(W_P)):
			out[f"x{xi}.p{pi}"] = para_text(p)
	return out


def cmd_verify(template, out):
	a, b = Document(template), Document(out)
	bad = []
	secs = lambda d: [(s.page_width, s.page_height, s.left_margin, s.right_margin, s.top_margin, s.bottom_margin, str(s.orientation)) for s in d.sections]
	if secs(a) != secs(b):
		bad.append(f"쪽 설정이 다르다: {secs(a)} → {secs(b)}")
	lost = {s.style_id for s in a.styles} - {s.style_id for s in b.styles}
	if lost:
		bad.append(f"사라진 스타일: {sorted(lost)}")
	cols = lambda d: [len(cells_of(rows_of(el)[0])) if rows_of(el) else 0 for _, el in blocks(d) if el.tag == W_TBL]
	if cols(a) != cols(b):
		bad.append(f"표 구성(표마다 첫 행 칸 수)이 다르다: {cols(a)} → {cols(b)} — 일부러 표를 지웠다면 괜찮다")
	used = lambda d: {style_of(el) for _, el in blocks(d) if el.tag == W_P}
	if used(b) - used(a):
		bad.append(f"템플릿에 없던 문단 스타일을 썼다: {sorted(used(b) - used(a))}")
	for line in bad:
		print("다름:", line)
	print("같다: 쪽 설정 · 스타일 · 표 구성" if not bad else f"{len(bad)}건 다르다")
	leftover(texts_by_loc(a), texts_by_loc(b))
	sys.exit(1 if bad else 0)


def leftover(before, after):
	"""결과에 템플릿 글자가 그대로 남은 자리. 머리글 · 이름표처럼 남아야 하는 것도 섞여 있으니 판정은 읽는 쪽이 한다."""
	seen = {t.strip() for t in before.values() if len(t.strip()) >= 2}
	same = [(loc, t) for loc, t in after.items() if t.strip() in seen]
	if not same:
		print("견본 글자: 템플릿과 같은 글자가 남은 자리가 없다")
		return
	print(f"견본 글자: 템플릿과 같은 글자가 남은 자리 {len(same)}곳 — 이름표 · 머리글이 아니면 바꾸거나 지운다")
	for loc, t in same[:LEFTOVER_MAX]:
		print(f"  {loc}\t{t}")
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
