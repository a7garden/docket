#!/usr/bin/env python3
"""교육부·교육청 연구학교 연구계획서 생성기 — 표준 연구학교 계획서 레퍼런스 복제 방식.

assets/research-school-plan-reference.hwpx(한국교원대부설월곡초 상설연구학교 연구계획서)를
복제하여 28쪽 분량의 완벽한 연구계획서 양식(표지, 목차, 실태분석, SWOT 분석 도식,
연구과제 설계 추진체계도, 연차별 흐름도, 실행계획 표 등)을 보존하고
학교명·연구주제·학년도·연구기간 등을 맞춤형으로 생성한다.

사용법:
    python3 scripts/research_plan.py --school "○○초등학교" --title "○○ 교육을 통한 맞춤형 교육과정" --year "2026" -o 연구계획서.hwpx
    python3 scripts/research_plan.py --sample -o 샘플_연구계획서.hwpx
"""
import argparse
import os
import shutil
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
REF = SKILL_DIR / "assets" / "research-school-plan-reference.hwpx"

# 기본 레퍼런스 값
DEFAULT_SCHOOL = "한국교원대학교부설월곡초등학교"
DEFAULT_SCHOOL_SHORT = "월곡초"
DEFAULT_YEAR = "2026"
DEFAULT_PERIOD = "2026. 3. 1. ~ 2029. 2. 28.(3년)"
DEFAULT_PERIOD_COMPACT = "2026.3.1.~2029.2.28.(3년)"
DEFAULT_TOPIC_FULL = "AI·디지털 문해력 신장을 위한 ‘AI-SPARK’ 학생 맞춤형 교육과정 운영"
DEFAULT_TOPIC_COVER = "AI·디지털 문해력 신장을 위한 ‘AI-SPARK’ 교육과정 운영"


def generate(output_path, school=None, school_short=None, title=None, year=None, period=None):
    """연구학교 계획서 레퍼런스를 복제하고 주요 메타데이터를 치환하여 저장."""
    if not REF.exists():
        raise FileNotFoundError(f"레퍼런스 양식을 찾을 수 없습니다: {REF}")

    out_file = Path(output_path).resolve()
    out_file.parent.mkdir(parents=True, exist_ok=True)

    # 치환 대상 매핑 구성
    replacements = []
    if year and year != DEFAULT_YEAR:
        replacements.append((DEFAULT_YEAR + "학년도", f"{year}학년도"))
        replacements.append((DEFAULT_YEAR + "년", f"{year}년"))
        replacements.append((DEFAULT_YEAR + ". 2.", f"{year}. 2."))
        replacements.append((DEFAULT_YEAR + ".", f"{year}."))

    if period and period != DEFAULT_PERIOD:
        replacements.append((DEFAULT_PERIOD, period))
        replacements.append((DEFAULT_PERIOD_COMPACT, period.replace(" ", "")))

    if school and school != DEFAULT_SCHOOL:
        replacements.append((DEFAULT_SCHOOL, school))
        if not school_short:
            s = school.replace("부설", "").replace("대학교", "").replace("학교", "")
            school_short = s if len(s) <= 4 else s[:3] + "초"
        if school_short and school_short != DEFAULT_SCHOOL_SHORT:
            replacements.append((DEFAULT_SCHOOL_SHORT, school_short))

    if title:
        replacements.append((DEFAULT_TOPIC_FULL, title))
        replacements.append((DEFAULT_TOPIC_COVER, title))


    hp_linesegarray = '{http://www.hancom.co.kr/hwpml/2011/paragraph}linesegarray'

    with tempfile.TemporaryDirectory() as td:
        temp_dir = Path(td)
        with zipfile.ZipFile(REF, 'r') as z_in:
            z_in.extractall(temp_dir)

        # 치환 대상이 있는 경우 섹션 XML 텍스트 치환
        if replacements:
            for xml_path in temp_dir.glob("Contents/section*.xml"):
                text = xml_path.read_text(encoding="utf-8")
                modified = False
                for old_val, new_val in replacements:
                    if old_val in text:
                        text = text.replace(old_val, new_val)
                        modified = True
                if modified:
                    try:
                        root = ET.fromstring(text.encode("utf-8"))
                        for lsa in list(root.iter(hp_linesegarray)):
                            for parent in root.iter():
                                if lsa in list(parent):
                                    parent.remove(lsa)
                                    break
                        xml_path.write_bytes(ET.tostring(root, encoding="utf-8", xml_declaration=True))
                    except Exception:
                        xml_path.write_text(text, encoding="utf-8")

        if out_file.exists():
            out_file.unlink()

        with zipfile.ZipFile(out_file, 'w', compression=zipfile.ZIP_DEFLATED) as z_out:
            mimetype_path = temp_dir / "mimetype"
            if mimetype_path.exists():
                z_out.write(mimetype_path, "mimetype", compress_type=zipfile.ZIP_STORED)

            for r, dirs, files in os.walk(temp_dir):
                for file in files:
                    full = Path(r) / file
                    rel = full.relative_to(temp_dir)
                    if str(rel) == "mimetype":
                        continue
                    z_out.write(full, str(rel))

    fix_script = SKILL_DIR / "scripts" / "fix_namespaces.py"
    if fix_script.exists():
        try:
            import subprocess
            subprocess.run([sys.executable, str(fix_script), str(out_file)],
                           capture_output=True, check=False)
        except Exception:
            pass

    return out_file


def main():
    parser = argparse.ArgumentParser(description="교육부·교육청 표준 연구학교 연구계획서 HWPX 생성기")
    parser.add_argument("--school", help="학교명 (예: ○○초등학교)")
    parser.add_argument("--school-short", help="학교명 약칭 (예: ○○초)")
    parser.add_argument("--title", help="연구 주제 (예: AI·디지털 문해력 신장을 위한 맞춤형 교육과정)")
    parser.add_argument("--year", help="연구 학년도 (예: 2026)")
    parser.add_argument("--period", help="연구 기간 (예: 2026. 3. 1. ~ 2029. 2. 28.(3년))")
    parser.add_argument("--sample", action="store_true", help="샘플 양식 그대로 생성")
    parser.add_argument("-o", "--output", default="연구계획서.hwpx", help="출력 파일 경로 (.hwpx)")

    args = parser.parse_args()

    out_path = generate(
        output_path=args.output,
        school=args.school,
        school_short=args.school_short,
        title=args.title,
        year=args.year,
        period=args.period
    )
    print(f"[OK] Research school plan generated: {out_path}")


if __name__ == "__main__":
    main()
