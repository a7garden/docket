# docket 내장 Claude 플러그인

산출물을 파일로 만들 때 `claude --plugin-dir` 로 싣는다. 이 PC 의 Claude 에 무엇이 깔렸든 같은 스킬로 만들려는 것이다.
계획 · 구현 · 대화에는 싣지 않는다 — 스킬 목록이 실행마다 붙는다.
같은 일을 하는 계정 · 사용자 스킬(`anthropic-skills:docx` · `xlsx` · `pptx` · `pdf` · `docs`, 사용자 `hwpx` · `anti-slop`)은 그 실행에서 거부 규칙으로 막는다.

| 스킬 | 하는 일 | 필요한 것 |
|---|---|---|
| `docket:hwpx` | 한글 문서 만들기 · 양식 채우기 | Python · `skills/hwpx/requirements-one-shot.txt` |
| `docket:docx` | 워드 템플릿 사본 채우기 · 새로 만들기 | Python · `python-docx` |
| `docket:xlsx` | 엑셀 템플릿 사본의 칸만 고쳐 채우기(로고 · 그림 · 차트 보존) · 행 높이 맞추기 · 새로 만들기 · 수식 계산값 넣기 | Python · `openpyxl` · `lxml` (계산값은 LibreOffice) |
| `docket:pptx` | 파워포인트 템플릿 사본 채우기 · 슬라이드 복제 · 차트 · 그림 바꾸기 · 글자 크기 · 글꼴 · 넘침 검사 · 새로 만들기 | Python · `python-pptx` · `Pillow` |
| `docket:anti-slop` | 파일에 넣기 전 원고 다듬기 | 없음 |

어느 스킬에도 딸리지 않는 공용 도구는 `scripts/` 에 있다.

| 도구 | 하는 일 | 필요한 것 |
|---|---|---|
| `scripts/render.py` | 결과 파일의 쪽을 PNG 로 그린다(Read 로 눈으로 확인) | `PyMuPDF` · 워드 · 엑셀 · 파워포인트는 LibreOffice 또는 Microsoft Office(`pywin32`) · 한글은 Node(rhwp) 또는 한컴 |
| `scripts/rhwp_render.mjs` | 한글 쪽을 SVG 로 그린다. `skills/hwpx` 에 실린 rhwp(WASM)를 쓴다 — 한컴이 없어도 되지만 글자 폭을 어림해 쪽 나눔이 조금 다를 수 있다 | Node 18+ |
| `scripts/doctor.py` | 위 도구들이 이 PC 에 있는지 JSON 으로 낸다(「설정 › 산출물 › 문서 도구」) | Python |

## skills/hwpx

- 출처: https://github.com/jkf87/hwpx-skill (v1.18.0, 2026-09-10 판)
- 라이선스: MIT — 원 저장소 README 「라이선스」 절에 밝혀져 있다. 원 저장소에 LICENSE 파일은 없다(2026-10-29 확인).
- 그 안에서 쓰는 제3자 자료의 고지는 `skills/hwpx/THIRD_PARTY_NOTICES.md` · `skills/hwpx/licenses/` · `skills/hwpx/scripts/vendor/rhwp/LICENSE` 에 있다.
- 옮기면서 뺀 것: `tests/` · `__pycache__/` · `.gitignore`.
- **docket 이 고친 곳은 두 군데뿐이다. 원 저장소의 새 판으로 덮어쓰면 다시 넣는다.** 둘 다 `docket:` 주석으로 표시했다.
  - `scripts/hancom_worker.py` 의 `run_hancom` 첫머리 — `DOCKET_HANCOM=0` 이면 한컴을 띄우지 않고 「한컴 없음」으로 답한다. 한컴 열기 · PDF 는 모두 이 함수를 지난다.
  - `scripts/convert_hwp_hancom.ps1` 첫머리 — 같은 조건이면 멈추고 `convert_hwp.py`(rhwp)를 쓰라고 알린다.
  - 까닭: 한컴 자동화 보안 모듈이 등록되지 않은 PC 에서는 한컴을 띄울 때마다 접근 확인 창이 뜬다. 원샷 품질 검사가 기본으로 한컴을 열어 보므로 문서를 만들 때마다 창이 떴다.
    앱 설정 「한컴으로 확인」(기본 끔)이 이 값을 정한다.
  docket 에 맞지 않는 곳(그림을 `view_file` 로 본다 · 쪽 확인은 `render_hwpx.py`)은 본문을 고치지 않고 파일 산출물 프롬프트에서 바로잡는다.
- `scripts/vendor/rhwp` 는 `@rhwp/core` 0.7.10(MIT)이다. 원래는 한컴이 없을 때 hwp → hwpx 변환에 쓰이고, docket 은 쪽 그림(`scripts/rhwp_render.mjs`)에도 쓴다.

## skills/docx · xlsx · pptx

docket 용으로 새로 썼다. 템플릿 사본의 글자만 바꾸고 서식을 지키는 일에 좁혔다 — 산출물은 대부분 견본 양식을 채우는 일이다.
Anthropic 의 같은 이름 스킬은 독점 라이선스라 싣지 않고, 쓰지도 않는다.

## skills/anti-slop

docket 사용자가 만든 스킬(v2.0.6)을 옮겼다. 돌릴 때 읽는 것(`SKILL.md` · `references/` · `tests/regression_cases.json`)만 싣고
관리용 시험 · 확장(`tests/` 의 나머지 · `extensions/` · `agents/`)은 뺐다. 원본을 고치면 이 사본도 다시 옮긴다.
