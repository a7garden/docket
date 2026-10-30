//! 지식베이스. 프로젝트마다 참고 문서를 모아 두고, 계획 · 대화 · 산출물 작성 때 관련 있는 구획을 찾아 프롬프트에 붙인다.
//!
//! - 출처는 셋이다. 사용자가 고른 폴더(복사하지 않고 그 자리를 훑는다) · 끌어 놓은 파일과 폴더(kb/inbox/ 로 복사) · 산출물의 최신 판.
//! - 글자는 kb/text/ 에 뽑아 둔다. Claude 의 Read 가 docx · hwpx · pdf 를 바로 읽지 못해서다. 발췌 밖의 원문은 이 사본을 연다.
//! - 색인 카드: 구획마다 Claude(가벼운 모델)가 요약 · 핵심어 · 비슷한 말 · 답할 질문을 한 번 적어 둔다.
//!   Claude 에는 임베딩이 없어서, 「미리 한 번 소화해 뜻으로 찾게 해 두는」 일을 벡터 대신 글 카드로 한다.
//!   뜻은 같은데 낱말이 다른 경우(「회신」 ↔ 「결과 통보」)를 카드의 비슷한 말이 메운다.
//! - 찾기는 로컬 BM25 다. 카드와 원문에 점수를 매기고 카드에 무게를 더 준다. 찾을 때는 Claude 를 부르지 않는다.
//!   「고르기 다듬기」를 켜면 후보를 Claude 에 한 번 넘겨 다시 고른다.
//! - 낡은 자료: 같은 문서의 옛 판이 함께 걸리는 것이 가장 흔한 오염이라, 넣기 전에 거른다. 같은 폴더에서 판 표시를 뗀 이름이 같은 파일은
//!   가장 높은 판만 넣고(판 묶기), 사람이 정한 제외 목록에 걸린 것도 넣지 않는다. 그래도 붙은 자료는 「지금 코드 · 메모가 먼저, 어긋나면 밝힌다」고 일러 붙인다.
//!   수정 시각으로는 가리지 않는다 — 받아 오거나 복사한 파일은 그날 시각이 되고, 같은 날 만든 v1 · v6 도 있다.
//! - 자동 갱신: 이슈를 완료하면 「자동 갱신」을 켠 산출물 가운데 그 코드 변경과 관련 있는 것을 Claude 가 가리고, 고른 것만 새 판을 쓴다.
//!
//! ```text
//! projects/<pid>/kb/
//!   catalog.json          파일 · 구획 · 카드 · 건너뛴 까닭
//!   inbox/                끌어 놓은 파일 · 폴더
//!   text/<키>.txt         뽑은 글자
//!   *.last.jsonl          마지막 카드 · 다듬기 · 판정 호출 기록
//! ```
//!
//! 목차
//! 1. 색인 목록(catalog) — 모양 · 읽고 쓰기
//! 2. 훑기 · 제외 · 판 묶기 · 글자 사본 · 구획 나누기
//! 3. 낱말 나누기 · BM25 찾기 · 발췌
//! 4. 색인 카드 만들기
//! 5. 색인 순회 · 진행 상황
//! 6. 실행에 붙이기 (찾기 · 다듬기 · 프롬프트 블록)
//! 7. 자동 갱신 (이슈 완료 → 산출물 새 판)
//! 8. 화면에 보내는 모양

use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

use crate::error::{Error, Result};
use crate::extract;
use crate::model::*;
use crate::runner;
use crate::store::{Store, same_path, write_atomic};

/// 한 번에 훑는 파일 수. 넘으면 나머지는 넣지 않고 화면에 알린다. 큰 폴더(저장소 전체 등)를 잘못 골랐을 때 색인이 끝나지 않는 것을 막는다.
const MAX_FILES: usize = 5000;
/// 이보다 큰 파일은 넣지 않는다.
const MAX_BYTES: u64 = 20 * 1024 * 1024;
/// 구획 크기(바이트). 빈 줄에서 SOFT 를 넘으면 끊고, 빈 줄이 없어도 HARD 에서 끊는다. 한글은 한 글자가 3바이트다.
const SECTION_SOFT: usize = 4_500;
const SECTION_HARD: usize = 9_000;
/// 카드 호출 한 번에 넘기는 구획 본문의 합 · 구획 하나에서 넘기는 앞부분 (바이트)
const CARD_BATCH: usize = 24_000;
const CARD_SECTION_MAX: usize = 6_000;
/// 카드를 만들지 못한 파일을 다시 시도하는 횟수
const CARD_TRIES: u32 = 2;
/// 다듬기를 켰을 때 로컬로 먼저 고르는 후보 수
const RERANK_POOL: usize = 30;
/// 프롬프트에 붙이는 자료 블록의 상한(글자). 계획 형식 · 규칙을 가리지 않게 한다.
const BLOCK_MAX: usize = 12_000;
/// 자동 갱신 판정에 한 번에 넘기는 산출물 수
const JUDGE_MAX: usize = 8;

/* ---------- 1. 색인 목록 ---------- */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Card {
	pub summary: String,
	pub keywords: Vec<String>,
	pub aliases: Vec<String>,
	pub questions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Section {
	pub heading: String,
	/// 글자 사본 안의 바이트 범위. 줄 머리에서만 끊으므로 늘 글자 경계다.
	pub start: usize,
	pub end: usize,
	/// 본문 해시. 파일이 바뀌어도 해시가 같은 구획은 카드를 다시 만들지 않는다.
	pub hash: String,
	pub card: Option<Card>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct KbFile {
	pub path: String,
	/// folder · inbox · deliverable
	pub source: String,
	pub label: String,
	pub deliverable_id: String,
	pub text_path: String,
	pub mtime: i64,
	pub size: u64,
	pub sections: Vec<Section>,
	/// 비어 있지 않으면 색인하지 않은 까닭
	pub skipped: String,
	/// exclude: 제외 목록 · version: 판 묶기. 이때는 지난 구획 · 카드를 지우지 않고 둔다 — 다시 넣을 때 카드를 새로 만들지 않게.
	pub held: String,
	pub card_error: String,
	pub card_tries: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Catalog {
	pub files: Vec<KbFile>,
	pub indexed_at: i64,
	/// 지금까지 카드를 만드는 데 든 비용(USD). 비용이 쌓이는 것을 화면에서 보게 한다.
	pub card_cost_usd: f64,
	/// MAX_FILES 를 넘어 다 훑지 못했다
	pub truncated: bool,
}

fn load_catalog(dir: &Path) -> Catalog {
	fs::read(dir.join("catalog.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_catalog(dir: &Path, c: &Catalog) -> Result<()> {
	write_atomic(&dir.join("catalog.json"), &serde_json::to_vec(c)?)
}

fn hash_of(s: &str) -> String {
	let mut h = std::collections::hash_map::DefaultHasher::new();
	s.hash(&mut h);
	format!("{:016x}", h.finish())
}

fn file_name(path: &str) -> String {
	Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string())
}

/// 프롬프트에 넣을 앞부분. 글자 경계에서 자른다.
fn clip_bytes(s: &str, max: usize) -> &str {
	if s.len() <= max {
		return s;
	}
	let mut e = max;
	while !s.is_char_boundary(e) {
		e -= 1;
	}
	&s[..e]
}

/// 카드 모델. 설정에서 비우면 제목 모델, 그것도 비면 haiku 다.
pub fn card_model(s: &Settings) -> String {
	[s.kb_card_model.trim(), s.title_model.trim()].into_iter().find(|m| !m.is_empty()).unwrap_or("haiku").to_string()
}

/// 답 글에서 JSON 을 꺼낸다. 모델이 설명을 덧붙이거나 코드 블록으로 감싸도 처음 괄호부터 마지막 괄호까지 읽는다.
pub(crate) fn json_in(text: &str) -> Option<Value> {
	let t = text.trim();
	if let Ok(v) = serde_json::from_str::<Value>(t) {
		return Some(v);
	}
	let start = t.find(['[', '{'])?;
	let close = if t.as_bytes()[start] == b'[' { ']' } else { '}' };
	let end = t.rfind(close)?;
	if end <= start {
		return None;
	}
	serde_json::from_str::<Value>(&t[start..=end]).ok()
}

/* ---------- 2. 훑기 · 글자 사본 · 구획 ---------- */

struct Found {
	path: PathBuf,
	/// 훑기 시작한 폴더(참조 폴더 · inbox). 제외 목록의 이름 조각은 이 안쪽 경로에만 맞춘다.
	root: PathBuf,
	source: &'static str,
	label: String,
	did: String,
}

/// 버전 관리 · 빌드 산출 폴더는 문서가 아니다.
fn skip_dir(name: &str) -> bool {
	name.starts_with('.') || matches!(name, "node_modules" | "target" | "__pycache__")
}

/// 이름만 보고 비밀일 수 있는 파일을 뺀다. 카드를 만들 때 내용이 Claude 로 나가서다.
fn secret_name(name: &str) -> bool {
	let n = name.to_lowercase();
	n.starts_with(".env")
		|| n.contains("secret")
		|| n.contains("credential")
		|| n.starts_with("id_rsa")
		|| [".pem", ".key", ".pfx", ".p12", ".keystore", ".jks"].iter().any(|e| n.ends_with(e))
}

/// 하위 폴더까지 훑는다. MAX_FILES 를 넘으면 true. 숨은 파일 · 오피스 잠금 파일(~$)은 조용히 건너뛴다(.env 는 남겨 까닭을 보인다).
fn walk(root: &Path, source: &'static str, out: &mut Vec<Found>) -> bool {
	let mut stack = vec![root.to_path_buf()];
	while let Some(d) = stack.pop() {
		let Ok(rd) = fs::read_dir(&d) else { continue };
		for e in rd.filter_map(|e| e.ok()) {
			let Ok(t) = e.file_type() else { continue };
			let name = e.file_name().to_string_lossy().to_string();
			if t.is_symlink() {
				continue;
			}
			if t.is_dir() {
				if !skip_dir(&name) {
					stack.push(e.path());
				}
				continue;
			}
			if (name.starts_with('.') && !name.to_lowercase().starts_with(".env")) || name.starts_with("~$") {
				continue;
			}
			if out.len() >= MAX_FILES {
				return true;
			}
			out.push(Found { path: e.path(), root: root.to_path_buf(), source, label: String::new(), did: String::new() });
		}
	}
	false
}

/// 제외 목록에 걸리는지. 전체 경로는 그 파일이거나 그 아래, 이름 조각은 훑기 시작한 폴더 안쪽의 폴더 · 파일 이름에만 맞춘다 —
/// 「workspace」 같은 말이 참조 폴더 바깥 경로에 걸려 통째로 빠지지 않게. 대소문자는 가리지 않는다.
fn excluded(path: &Path, root: &Path, rules: &[String]) -> bool {
	let norm = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_lowercase();
	let full = norm(&path.to_string_lossy());
	let rel: Vec<String> = path
		.strip_prefix(root)
		.map(|r| r.components().map(|c| c.as_os_str().to_string_lossy().to_lowercase()).collect())
		.unwrap_or_default();
	rules.iter().any(|r| {
		if Path::new(r).is_absolute() {
			let r = norm(r);
			full == r || full.starts_with(&format!("{r}\\"))
		} else {
			let r = r.trim().to_lowercase();
			!r.is_empty() && rel.iter().any(|c| c.contains(&r))
		}
	})
}

/// 파일 이름 끝의 판 표시. 이름 끝에서 `_` · `-` · 빈칸으로 끊은 조각을 하나씩 뗀다.
#[derive(Debug, Default, PartialEq)]
struct Mark {
	/// 판 표시를 뗀 이름(소문자). 같은 폴더에서 이것이 같으면 한 문서의 판으로 본다.
	base: String,
	/// v14 · v1.1
	version: Option<Vec<u64>>,
	/// 20261027 (여덟 자리)
	date: Option<u64>,
	/// 「 (1)」 — 내려받기 · 복사로 생긴 사본
	copy: bool,
}

/// 판의 순서 (판 번호 · 날짜)
type Rank = (Option<Vec<u64>>, Option<u64>);

fn parse_version(t: &str) -> Option<Vec<u64>> {
	let v = t.strip_prefix('v')?;
	let parts: Vec<u64> = v.split('.').map(|p| p.parse().ok()).collect::<Option<_>>()?;
	(!parts.is_empty()).then_some(parts)
}

fn mark(stem: &str) -> Mark {
	let mut m = Mark::default();
	let mut rest = stem.trim();
	while let Some(at) = rest.rfind(['_', '-', ' ']) {
		let tok = rest[at + 1..].to_lowercase();
		if tok.is_empty() || matches!(tok.as_str(), "최종" | "최종본" | "수정" | "수정본" | "final") {
			// 순서를 말해 주지 않는 표시는 떼기만 한다
		} else if m.version.is_none()
			&& let Some(v) = parse_version(&tok)
		{
			m.version = Some(v);
		} else if m.date.is_none() && tok.len() == 8 && tok.starts_with("20") && tok.bytes().all(|b| b.is_ascii_digit()) {
			m.date = tok.parse().ok();
		} else if tok.len() > 2 && tok.starts_with('(') && tok.ends_with(')') && tok[1..tok.len() - 1].bytes().all(|b| b.is_ascii_digit()) {
			m.copy = true;
		} else {
			break;
		}
		rest = rest[..at].trim_end();
	}
	m.base = rest.to_lowercase();
	m
}

/// 같은 판에 형식이 여럿이면 남길 순서. 원본 형식은 제목 구조가 살아 있어 구획이 잘 나뉘고, PDF 는 내보낸 사본인 때가 많다.
fn format_rank(path: &Path) -> u8 {
	match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
		Some("docx" | "hwpx" | "pptx" | "xlsx") => 0,
		Some("pdf") => 2,
		_ => 1,
	}
}

/// 판 묶기. 같은 폴더에서 판 표시를 뗀 이름이 같은 파일을 한 문서로 보고, 넣지 않을 파일과 그 까닭을 낸다.
/// 확실할 때만 뺀다 — 판 번호로(판 번호가 없으면 이름 속 날짜로) 낮은 판 · 같은 판의 다른 형식 · 원본이 곁에 있는 사본.
/// 판 표시가 없는 파일은 순서를 알 수 없어 판으로는 빼지 않는다. 읽는 형식이 아닌 파일은 묶지 않는다 — 읽지 못하는 새 판이 읽히는 옛 판을 가리지 않게.
fn older_versions(paths: &[&Path]) -> HashMap<usize, String> {
	let marks: Vec<Mark> = paths.iter().map(|p| mark(&p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default())).collect();
	let mut groups: HashMap<(String, String), Vec<usize>> = HashMap::new();
	for (i, p) in paths.iter().enumerate() {
		let readable = p.extension().is_some_and(|e| extract::KB_EXTS.contains(&e.to_string_lossy().to_lowercase().as_str()));
		if readable && !marks[i].base.is_empty() {
			let dir = p.parent().map(|d| d.to_string_lossy().to_lowercase()).unwrap_or_default();
			groups.entry((dir, marks[i].base.clone())).or_default().push(i);
		}
	}
	let rank = |i: usize| (marks[i].version.clone(), marks[i].date);
	let name = |i: usize| file_name(&paths[i].to_string_lossy());
	let mut out = HashMap::new();
	for g in groups.values().filter(|g| g.len() > 1) {
		// 1. 낮은 판. 판 번호가 있는 것끼리, 없으면 날짜만 있는 것끼리 견준다.
		let by_version = g.iter().any(|&i| marks[i].version.is_some());
		let comparable = |i: usize| if by_version { marks[i].version.is_some() } else { marks[i].date.is_some() };
		// 같은 판이 여럿이면 까닭에 적을 이름으로 남을 것(원본 형식 · 사본 아님)을 고른다.
		let pick = |i: usize| (rank(i), std::cmp::Reverse((marks[i].copy, format_rank(paths[i]))));
		if let Some(top) = g.iter().copied().filter(|&i| comparable(i)).max_by_key(|&i| pick(i)) {
			for &i in g.iter().filter(|&&i| comparable(i) && rank(i) < rank(top)) {
				out.insert(i, format!("새 판이 있어 넣지 않음 · {}", name(top)));
			}
		}
		// 2. 남은 것 가운데 판이 같은 것끼리 하나만 남긴다.
		let alive: Vec<usize> = g.iter().copied().filter(|i| !out.contains_key(i)).collect();
		let mut same: HashMap<Rank, Vec<usize>> = HashMap::new();
		for &i in &alive {
			same.entry(rank(i)).or_default().push(i);
		}
		for s in same.values().filter(|s| s.len() > 1) {
			let best = s.iter().copied().min_by_key(|&i| (marks[i].copy, format_rank(paths[i]), name(i).chars().count())).unwrap();
			let ext = |i: usize| paths[i].extension().map(|e| e.to_string_lossy().to_lowercase());
			for &i in s.iter().filter(|&&i| i != best) {
				if ext(i) != ext(best) {
					out.insert(i, format!("같은 판의 다른 형식을 넣어 넣지 않음 · {}", name(best)));
				} else if marks[i].copy && !marks[best].copy {
					out.insert(i, format!("원본이 있어 넣지 않음 · {}", name(best)));
				}
			}
		}
	}
	out
}

/// 제목 줄(# …)에서 끊고, 길면 빈 줄에서, 그래도 길면 줄 머리에서 끊는다. 뽑은 엑셀 · 슬라이드는 「## 시트」 · 「## 슬라이드」가 제목 줄이다.
fn split_sections(text: &str) -> Vec<(String, usize, usize)> {
	let mut out = Vec::new();
	let (mut heading, mut start, mut pos) = (String::new(), 0usize, 0usize);
	for line in text.split_inclusive('\n') {
		let t = line.trim();
		let is_head = t.starts_with('#') && t.trim_start_matches('#').starts_with(' ');
		let len = pos - start;
		if len > 0 && (is_head || (len >= SECTION_SOFT && t.is_empty()) || len >= SECTION_HARD) {
			if !text[start..pos].trim().is_empty() {
				out.push((heading.clone(), start, pos));
			}
			start = pos;
		}
		if is_head {
			heading = t.trim_start_matches('#').trim().chars().take(80).collect();
		}
		pos += line.len();
	}
	if pos > start && !text[start..pos].trim().is_empty() {
		out.push((heading, start, pos));
	}
	out
}

fn modified_ms(m: &fs::Metadata) -> i64 {
	m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// 바뀐 파일 하나를 다시 뽑는다. 해시가 같은 구획은 지난 카드를 그대로 옮긴다.
fn build(dir: &Path, path: &Path, key: &str, mtime: i64, size: u64, prev: Option<KbFile>) -> KbFile {
	let mut file = KbFile { path: key.to_string(), mtime, size, ..Default::default() };
	if secret_name(&file_name(key)) {
		file.skipped = "비밀 파일일 수 있어 넣지 않음".into();
		return file;
	}
	if size > MAX_BYTES {
		file.skipped = "20MB 를 넘어 넣지 않음".into();
		return file;
	}
	match extract::text_of(path) {
		Err(e) => file.skipped = e,
		Ok(text) => {
			let tp = dir.join("text").join(format!("{}.txt", hash_of(&key.to_lowercase())));
			if let Err(e) = write_atomic(&tp, text.as_bytes()) {
				file.skipped = format!("글자 사본을 쓰지 못함: {e}");
				return file;
			}
			file.text_path = tp.to_string_lossy().to_string();
			let old: HashMap<String, Card> =
				prev.map(|p| p.sections.into_iter().filter_map(|s| Some((s.hash, s.card?))).collect()).unwrap_or_default();
			file.sections = split_sections(&text)
				.into_iter()
				.map(|(heading, start, end)| {
					let hash = hash_of(&text[start..end]);
					Section { card: old.get(&hash).cloned(), heading, start, end, hash }
				})
				.collect();
		}
	}
	file
}

/// 출처를 훑어 목록을 새로 맞춘다. 크기 · 수정 시각이 그대로인 파일은 다시 뽑지 않는다. 오래 걸릴 수 있어 spawn_blocking 안에서 부른다.
fn refresh(app: &AppHandle, pid: &str) -> Result<Catalog> {
	let store = app.state::<Store>();
	let p = store.project(pid)?;
	let dir = store.kb_dir(pid);
	fs::create_dir_all(dir.join("inbox"))?;
	fs::create_dir_all(dir.join("text"))?;
	let old = load_catalog(&dir);
	let cost = old.card_cost_usd;
	let mut by_path: HashMap<String, KbFile> = old.files.into_iter().map(|f| (f.path.clone(), f)).collect();

	// 산출물을 먼저 담는다. 산출물 폴더가 참조 폴더 안에 있으면 같은 파일이 두 번 잡히는데, 앞의 것이 남으므로 산출물 표시가 이긴다
	// (산출물을 쓸 때 자기 자신을 근거에서 빼려면 이 표시가 있어야 한다).
	let mut found = Vec::new();
	let mut truncated = false;
	if p.kb.include_deliverables {
		for v in store.list_deliverables(pid)? {
			let d = v.deliverable;
			let Some(last) = d.versions.last() else { continue };
			if let Ok(path) = store.version_path(pid, &d.id, last.n)
				&& path.is_file()
			{
				found.push(Found { root: PathBuf::new(), path, source: "deliverable", label: d.title.clone(), did: d.id.clone() });
			}
		}
	}
	for f in &p.kb.folders {
		truncated |= walk(Path::new(f), "folder", &mut found);
	}
	truncated |= walk(&dir.join("inbox"), "inbox", &mut found);

	let mut seen = HashSet::new();
	found.retain(|f| seen.insert(f.path.to_string_lossy().to_lowercase()));

	// 넣지 않을 것을 먼저 가린다. 산출물은 이미 최신 판만 들어와 가리지 않는다.
	// 판 묶기는 제외한 것 · 사람이 다시 넣은 것을 빼고 견준다 — 다시 넣은 옛 판이 새 판을 밀어내지 않게.
	let mut held: HashMap<usize, (&str, String)> = HashMap::new();
	for (i, f) in found.iter().enumerate() {
		if f.source != "deliverable" && excluded(&f.path, &f.root, &p.kb.exclude) {
			held.insert(i, ("exclude", "제외 목록에 있어 넣지 않음".into()));
		}
	}
	let kept = |f: &Found| p.kb.keep.iter().any(|k| same_path(k, &f.path.to_string_lossy()));
	let pool: Vec<usize> = (0..found.len()).filter(|i| found[*i].source != "deliverable" && !held.contains_key(i) && !kept(&found[*i])).collect();
	let paths: Vec<&Path> = pool.iter().map(|&i| found[i].path.as_path()).collect();
	for (j, why) in older_versions(&paths) {
		held.insert(pool[j], ("version", why));
	}

	let mut files = Vec::new();
	for (i, f) in found.into_iter().enumerate() {
		let key = f.path.to_string_lossy().to_string();
		let (mtime, size) = fs::metadata(&f.path).map(|m| (modified_ms(&m), m.len())).unwrap_or((0, 0));
		let prev = by_path.remove(&key);
		let mut file = if let Some((kind, why)) = held.remove(&i) {
			// 넣지 않되 지난 구획 · 카드 · 사본은 남긴다. 찾기 · 카드 만들기는 skipped 를 보고 건너뛴다.
			let mut pf = prev.unwrap_or_else(|| KbFile { path: key.clone(), ..Default::default() });
			(pf.mtime, pf.size, pf.held, pf.skipped) = (mtime, size, kind.into(), why);
			pf
		} else {
			match prev {
				Some(pf) if pf.held.is_empty() && pf.mtime == mtime && pf.size == size && (!pf.skipped.is_empty() || Path::new(&pf.text_path).is_file()) => pf,
				// 빠져 있던 것은 늘 다시 뽑는다. 빠진 동안 덮어 둔 까닭(비밀 파일 등)을 다시 가리고, 카드는 해시가 같으면 옮겨 온다.
				pf => build(&dir, &f.path, &key, mtime, size, pf),
			}
		};
		file.source = f.source.into();
		file.label = f.label;
		file.deliverable_id = f.did;
		files.push(file);
	}
	// 빠진 파일의 사본을 치운다. 출처에서 지웠는데 사본이 남아 있으면 Claude 가 지운 문서를 근거로 쓴다.
	for gone in by_path.values().filter(|g| !g.text_path.is_empty()) {
		let _ = fs::remove_file(&gone.text_path);
	}
	let cat = Catalog { files, indexed_at: now_ms(), card_cost_usd: cost, truncated };
	save_catalog(&dir, &cat)?;
	Ok(cat)
}

/* ---------- 3. 낱말 · 찾기 · 발췌 ---------- */

/// 어절 끝에서 뗄 조사. 긴 것을 먼저 본다. 형태소 분석기 없이 「검토를」 · 「검토는」 이 「검토」로 모이게 하려는 것이다.
const JOSA: &[&str] = &[
	"으로써", "으로서", "에서는", "에게서", "으로", "에서", "에게", "까지", "부터", "처럼", "보다", "하고", "이나", "이고", "은", "는", "이", "가", "을", "를",
	"의", "에", "와", "과", "도", "만", "로",
];

fn is_hangul(c: char) -> bool {
	('\u{AC00}'..='\u{D7A3}').contains(&c)
}

/// 찾기 낱말. 한글 어절은 조사를 떼고, 세 글자 이상이면 두 글자씩 끊은 조각(2-gram)도 함께 낸다 — 붙여 쓴 합성어(「재해위험성」)를 「위험」으로도 찾게 한다.
pub fn tokens(s: &str) -> Vec<String> {
	let mut out = Vec::new();
	for w in s.split(|c: char| !c.is_alphanumeric()) {
		if w.is_empty() {
			continue;
		}
		let w = w.to_lowercase();
		if w.chars().any(is_hangul) {
			let mut stem = w.as_str();
			for j in JOSA {
				if stem.ends_with(j) && stem.chars().count() > j.chars().count() + 1 {
					stem = &stem[..stem.len() - j.len()];
					break;
				}
			}
			let cs: Vec<char> = stem.chars().collect();
			if cs.len() >= 2 {
				out.push(stem.to_string());
			}
			if cs.len() > 2 {
				for pair in cs.windows(2) {
					out.push(pair.iter().collect());
				}
			}
		} else if w.chars().count() >= 2 {
			out.push(w);
		}
	}
	out
}

fn card_text(c: &Card) -> String {
	format!("{} {} {} {}", c.summary, c.keywords.join(" "), c.aliases.join(" "), c.questions.join(" "))
}

/// 구획 안에서 찾는 말이 가장 많이 걸린 줄을 가운데 두고 max 글자까지 앞뒤로 넓힌다.
fn excerpt(body: &str, q: &HashSet<&str>, max: usize) -> String {
	let lines: Vec<&str> = body.lines().map(str::trim_end).filter(|l| !l.trim().is_empty()).collect();
	if lines.is_empty() {
		return String::new();
	}
	let hits = |l: &str| tokens(l).iter().filter(|t| q.contains(t.as_str())).count();
	let mut best = 0;
	let mut best_n = 0;
	for (i, l) in lines.iter().copied().enumerate() {
		let n = hits(l);
		if n > best_n {
			best = i;
			best_n = n;
		}
	}
	let (mut lo, mut hi) = (best, best + 1);
	let mut len = lines[best].chars().count();
	loop {
		let mut grew = false;
		if hi < lines.len() && len + lines[hi].chars().count() <= max {
			len += lines[hi].chars().count();
			hi += 1;
			grew = true;
		}
		if lo > 0 && len + lines[lo - 1].chars().count() <= max {
			lo -= 1;
			len += lines[lo].chars().count();
			grew = true;
		}
		if !grew {
			break;
		}
	}
	let s = lines[lo..hi].join("\n");
	if s.chars().count() > max { format!("{}…", s.chars().take(max).collect::<String>()) } else { s }
}

struct Doc {
	file: usize,
	sec: usize,
	tf: HashMap<String, f32>,
	len: f32,
}

/// 로컬 BM25. 원문 1 · 파일 이름과 제목 1.5 · 카드 2 의 무게로 센다. 한 파일에서 셋까지만 고른다 — 긴 문서 하나가 자리를 다 차지하지 않게.
/// exclude_did 를 주면 그 산출물은 뺀다(산출물을 쓸 때 자기 자신을 근거로 붙이지 않게).
pub fn search_local(dir: &Path, query: &str, k: usize, exclude_did: &str) -> Vec<KbHit> {
	let cat = load_catalog(dir);
	let mut q = tokens(query);
	q.sort();
	q.dedup();
	if q.is_empty() || k == 0 {
		return Vec::new();
	}
	let mut docs = Vec::new();
	let mut texts: HashMap<usize, String> = HashMap::new();
	for (fi, f) in cat.files.iter().enumerate() {
		if !f.skipped.is_empty() || f.sections.is_empty() || (!exclude_did.is_empty() && f.deliverable_id == exclude_did) {
			continue;
		}
		let Ok(text) = fs::read_to_string(&f.text_path) else { continue };
		let name = file_name(&f.path);
		for (si, s) in f.sections.iter().enumerate() {
			let Some(body) = text.get(s.start..s.end) else { continue };
			let mut tf: HashMap<String, f32> = HashMap::new();
			let mut len = 0.0f32;
			let mut add = |t: &str, w: f32| {
				for tok in tokens(t) {
					*tf.entry(tok).or_insert(0.0) += w;
					len += w;
				}
			};
			add(body, 1.0);
			add(&format!("{name} {} {}", f.label, s.heading), 1.5);
			if let Some(c) = &s.card {
				add(&card_text(c), 2.0);
			}
			docs.push(Doc { file: fi, sec: si, tf, len });
		}
		texts.insert(fi, text);
	}
	if docs.is_empty() {
		return Vec::new();
	}
	let n = docs.len() as f32;
	let avg = (docs.iter().map(|d| d.len).sum::<f32>() / n).max(1.0);
	let df: HashMap<&str, f32> = q.iter().map(|t| (t.as_str(), docs.iter().filter(|d| d.tf.contains_key(t)).count() as f32)).collect();
	let (k1, b) = (1.2f32, 0.75f32);
	let mut scored: Vec<(f32, usize)> = docs
		.iter()
		.enumerate()
		.filter_map(|(i, d)| {
			let mut s = 0.0f32;
			for t in &q {
				let Some(&tf) = d.tf.get(t) else { continue };
				let df = df[t.as_str()];
				let idf = (1.0 + (n - df + 0.5) / (df + 0.5)).ln();
				s += idf * tf * (k1 + 1.0) / (tf + k1 * (1.0 - b + b * d.len / avg));
			}
			(s > 0.0).then_some((s, i))
		})
		.collect();
	scored.sort_by(|x, y| y.0.partial_cmp(&x.0).unwrap_or(std::cmp::Ordering::Equal));

	let qset: HashSet<&str> = q.iter().map(|s| s.as_str()).collect();
	let mut per_file: HashMap<usize, usize> = HashMap::new();
	let mut out = Vec::new();
	for (score, i) in scored {
		let d = &docs[i];
		let used = per_file.entry(d.file).or_insert(0);
		if *used >= 3 {
			continue;
		}
		*used += 1;
		let f = &cat.files[d.file];
		let s = &f.sections[d.sec];
		let body = texts.get(&d.file).and_then(|t| t.get(s.start..s.end)).unwrap_or("");
		out.push(KbHit {
			path: f.path.clone(),
			text_path: f.text_path.clone(),
			source: f.source.clone(),
			label: f.label.clone(),
			section: s.heading.clone(),
			why: s.card.as_ref().map(|c| c.summary.clone()).unwrap_or_default(),
			excerpt: excerpt(body, &qset, 700),
			score: score as f64,
		});
		if out.len() >= k {
			break;
		}
	}
	out
}

/* ---------- 4. 색인 카드 ---------- */

const CARD_SYSTEM: &str = "너는 문서 색인 카드를 만든다. 나중에 뜻으로 찾을 수 있게 구획마다 요약 · 핵심어 · 비슷한 말 · 이 구획이 답할 질문을 한국어로 적는다. JSON 배열 하나만 답한다.";

/// 카드가 없는 구획을 CARD_BATCH 안쪽으로 묶는다.
fn card_batches(f: &KbFile) -> Vec<Vec<usize>> {
	let mut out = Vec::new();
	let mut cur = Vec::new();
	let mut size = 0;
	for (i, s) in f.sections.iter().enumerate().filter(|(_, s)| s.card.is_none()) {
		let len = (s.end - s.start).min(CARD_SECTION_MAX);
		if !cur.is_empty() && size + len > CARD_BATCH {
			out.push(std::mem::take(&mut cur));
			size = 0;
		}
		cur.push(i);
		size += len;
	}
	if !cur.is_empty() {
		out.push(cur);
	}
	out
}

fn card_prompt(f: &KbFile, text: &str, batch: &[usize]) -> String {
	let label = if f.label.is_empty() { String::new() } else { format!(" (산출물 「{}」)", f.label) };
	let mut s = format!(
		"아래는 문서 「{}」{label}의 구획들이다. 구획마다 카드 하나를 만들어 JSON 배열 하나로만 답한다. 설명 · 코드 블록 없이 배열만 낸다.\n\n\
		[{{\"n\": 구획 번호, \"summary\": \"무엇을 다루는지 두 문장 이내\", \"keywords\": [\"핵심어\", \"… 8개 이내\"], \
		\"aliases\": [\"본문에 없어도 같은 뜻으로 찾을 만한 말 · 약어 · 영문 표기\", \"… 8개 이내\"], \"questions\": [\"이 구획이 답하는 질문\", \"… 3개 이내\"]}}]\n",
		file_name(&f.path)
	);
	for &i in batch {
		let sec = &f.sections[i];
		let body = text.get(sec.start..sec.end).unwrap_or("");
		s.push_str(&format!("\n### [{i}] {}\n{}\n", sec.heading, clip_bytes(body, CARD_SECTION_MAX).trim()));
	}
	s
}

/// 답에서 카드를 읽어 구획에 붙인다. 붙인 수를 돌려준다.
fn apply_cards(f: &mut KbFile, batch: &[usize], answer: &str) -> usize {
	let Some(Value::Array(items)) = json_in(answer) else { return 0 };
	let strs = |v: &Value, k: &str| -> Vec<String> {
		v.get(k).and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).take(8).collect()).unwrap_or_default()
	};
	let mut n = 0;
	for it in &items {
		let Some(idx) = it.get("n").and_then(|x| x.as_u64()).map(|x| x as usize) else { continue };
		if !batch.contains(&idx) {
			continue;
		}
		let summary = it.get("summary").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
		f.sections[idx].card = Some(Card { summary, keywords: strs(it, "keywords"), aliases: strs(it, "aliases"), questions: strs(it, "questions") });
		n += 1;
	}
	n
}

fn pending_cards(cat: &Catalog) -> usize {
	cat.files
		.iter()
		.filter(|f| f.skipped.is_empty() && f.card_tries < CARD_TRIES)
		.map(|f| f.sections.iter().filter(|s| s.card.is_none()).count())
		.sum()
}

/* ---------- 5. 색인 순회 · 진행 상황 ---------- */

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
	pub running: bool,
	/// scan: 훑고 뽑는 중 · cards: 카드를 만드는 중
	pub stage: String,
	pub done: usize,
	pub total: usize,
	/// 마지막 순회가 남긴 말 (오류 · 중지)
	pub message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct KbEvent<'a> {
	project_id: &'a str,
	progress: &'a Progress,
}

/// 색인 순회의 상태. 한 순회가 프로젝트를 하나씩 맡는다 — 둘을 함께 돌리면 같은 catalog.json 을 함께 쓴다.
#[derive(Default)]
pub struct Kb {
	progress: Mutex<HashMap<String, Progress>>,
	queue: Mutex<Vec<String>>,
	wake: Notify,
	stops: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Kb {
	/// 다음 순회에서 그 프로젝트를 다시 훑게 한다. 이미 줄에 있으면 한 번만 돈다.
	pub fn request(&self, pid: &str) {
		{
			let mut q = self.queue.lock().unwrap();
			if !q.iter().any(|x| x == pid) {
				q.push(pid.to_string());
			}
		}
		self.wake.notify_one();
	}

	pub fn stop(&self, pid: &str) -> bool {
		self.queue.lock().unwrap().retain(|x| x != pid);
		match self.stops.lock().unwrap().get(pid) {
			Some(f) => {
				f.store(true, Ordering::SeqCst);
				true
			}
			None => false,
		}
	}

	fn progress(&self, pid: &str) -> Progress {
		self.progress.lock().unwrap().get(pid).cloned().unwrap_or_default()
	}
}

fn set_progress(app: &AppHandle, pid: &str, p: Progress) {
	app.state::<Kb>().progress.lock().unwrap().insert(pid.to_string(), p.clone());
	let _ = app.emit("docket://kb", KbEvent { project_id: pid, progress: &p });
}

/// 켠 프로젝트면 다시 훑게 한다. 산출물에 새 판이 생기거나 자료를 넣었을 때 부른다.
pub fn touch(app: &AppHandle, pid: &str) {
	if app.state::<Store>().project(pid).map(|p| p.kb.enabled).unwrap_or(false) {
		app.state::<Kb>().request(pid);
	}
}

fn enqueue_enabled(app: &AppHandle) {
	for p in app.state::<Store>().projects().unwrap_or_default().into_iter().filter(|p| p.kb.enabled) {
		app.state::<Kb>().request(&p.id);
	}
}

/// 색인 순회. 켤 때 한 번, 그 뒤 10분마다, 그리고 request 를 받을 때 돈다.
/// 2026.10.28 : 10분. 참조 폴더는 앱이 모르게 바뀌므로 주기로 따라잡는다. 바뀐 파일만 다시 뽑으니 훑기 자체는 가볍다.
pub fn spawn_indexer(app: AppHandle) {
	tauri::async_runtime::spawn(async move {
		enqueue_enabled(&app);
		loop {
			let next = app.state::<Kb>().queue.lock().unwrap().first().cloned();
			let Some(pid) = next else {
				let kb = app.state::<Kb>();
				tokio::select! {
					_ = kb.wake.notified() => {}
					_ = tokio::time::sleep(Duration::from_secs(600)) => enqueue_enabled(&app),
				}
				continue;
			};
			let flag = Arc::new(AtomicBool::new(false));
			{
				let kb = app.state::<Kb>();
				kb.queue.lock().unwrap().retain(|x| x != &pid);
				kb.stops.lock().unwrap().insert(pid.clone(), flag.clone());
			}
			let res = index_project(&app, &pid, &flag).await;
			app.state::<Kb>().stops.lock().unwrap().remove(&pid);
			let message = match res {
				Err(e) => e.to_string(),
				Ok(()) if flag.load(Ordering::SeqCst) => "중지했습니다".into(),
				Ok(()) => String::new(),
			};
			let last = app.state::<Kb>().progress(&pid);
			set_progress(&app, &pid, Progress { running: false, stage: String::new(), message, ..last });
		}
	});
}

async fn index_project(app: &AppHandle, pid: &str, stop: &AtomicBool) -> Result<()> {
	let store = app.state::<Store>();
	let project = store.project(pid)?;
	if !project.kb.enabled {
		return Ok(());
	}
	set_progress(app, pid, Progress { running: true, stage: "scan".into(), ..Default::default() });
	let (a, p) = (app.clone(), pid.to_string());
	let mut cat = tokio::task::spawn_blocking(move || refresh(&a, &p)).await.map_err(|e| Error::Msg(e.to_string()))??;

	let total = pending_cards(&cat);
	if total == 0 || stop.load(Ordering::SeqCst) {
		return Ok(());
	}
	let settings = store.settings()?;
	let exe = runner::resolve_claude(&settings.claude_path)
		.ok_or_else(|| Error::Msg("claude 실행 파일을 찾지 못해 색인 카드를 만들지 못했습니다".into()))?;
	let model = card_model(&settings);
	let dir = store.kb_dir(pid);
	let mut done = 0;
	set_progress(app, pid, Progress { running: true, stage: "cards".into(), done, total, ..Default::default() });
	for fi in 0..cat.files.len() {
		if cat.files[fi].skipped.is_empty() && cat.files[fi].card_tries < CARD_TRIES {
			let Ok(text) = fs::read_to_string(&cat.files[fi].text_path) else { continue };
			for batch in card_batches(&cat.files[fi]) {
				if stop.load(Ordering::SeqCst) {
					return Ok(());
				}
				let prompt = card_prompt(&cat.files[fi], &text, &batch);
				let answer = runner::quick_call(exe.clone(), (pid, "card"), &model, CARD_SYSTEM, prompt, &dir, dir.join("cards.last.jsonl"), 180).await;
				let f = &mut cat.files[fi];
				let failed = match answer {
					Some((a, cost)) => {
						cat.card_cost_usd += cost;
						apply_cards(f, &batch, &a) < batch.len()
					}
					None => true,
				};
				done += batch.len();
				if failed {
					f.card_tries += 1;
					f.card_error = "카드를 다 만들지 못함 (호출 실패 · 시간 초과 · 답을 읽지 못함)".into();
				}
				save_catalog(&dir, &cat)?;
				set_progress(app, pid, Progress { running: true, stage: "cards".into(), done: done.min(total), total, ..Default::default() });
				if failed {
					break;
				}
			}
		}
	}
	Ok(())
}

/* ---------- 6. 실행에 붙이기 ---------- */

const RERANK_SYSTEM: &str = "너는 개발 작업에 참고할 문서 구획을 고른다. 후보 가운데 이 일과 관련 있는 것만 관련 깊은 순으로 고른다. JSON 배열 하나만 답한다.";

fn rerank_prompt(query: &str, hits: &[KbHit], k: usize) -> String {
	let mut s = format!("## 할 일\n{}\n\n## 후보\n", clip_bytes(query, 6000).trim());
	for (i, h) in hits.iter().enumerate() {
		let name = if h.label.is_empty() { file_name(&h.path) } else { h.label.clone() };
		s.push_str(&format!("\n[{i}] {name} › {}\n", h.section));
		if !h.why.is_empty() {
			s.push_str(&format!("요약: {}\n", h.why));
		}
		s.push_str(&format!("{}\n", h.excerpt.chars().take(300).collect::<String>()));
	}
	s.push_str(&format!("\n이 일과 관련 있는 후보 번호를 관련 깊은 순으로 {k}개 이내로 JSON 배열(예: [3, 0, 7])로만 답한다. 관련 있는 것이 없으면 [] 로 답한다.\n"));
	s
}

/// 프로젝트 지식베이스에서 query 와 가까운 구획을 고른다. 끈 프로젝트면 빈 목록이다.
/// 다듬기를 켰으면 후보를 Claude 에 넘겨 다시 고른다. 호출이 실패하면 로컬 순위를 그대로 쓴다 — 찾기 때문에 실행이 멈추지 않게.
pub async fn find(app: &AppHandle, p: &Project, settings: &Settings, query: &str, exclude_did: &str) -> Vec<KbHit> {
	if !p.kb.enabled || query.trim().is_empty() {
		return Vec::new();
	}
	let k = p.kb.top_k.max(1) as usize;
	let dir = app.state::<Store>().kb_dir(&p.id);
	let want = if p.kb.rerank { RERANK_POOL.max(k) } else { k };
	let (d, q, ex) = (dir.clone(), query.to_string(), exclude_did.to_string());
	let hits = tokio::task::spawn_blocking(move || search_local(&d, &q, want, &ex)).await.unwrap_or_default();
	if !p.kb.rerank || hits.len() <= k {
		return hits.into_iter().take(k).collect();
	}
	let Some(exe) = runner::resolve_claude(&settings.claude_path) else { return hits.into_iter().take(k).collect() };
	let answer = runner::quick_call(exe, (&p.id, "rerank"), &card_model(settings), RERANK_SYSTEM, rerank_prompt(query, &hits, k), &dir, dir.join("rerank.last.jsonl"), 60).await;
	let picked: Option<Vec<usize>> = answer
		.and_then(|(a, _)| json_in(&a))
		.and_then(|v| v.as_array().map(|a| a.iter().filter_map(|x| x.as_u64()).map(|x| x as usize).collect()));
	match picked {
		Some(idx) => {
			let mut out = Vec::new();
			for i in idx {
				if let Some(h) = hits.get(i)
					&& !out.iter().any(|o: &KbHit| o.path == h.path && o.section == h.section)
				{
					out.push(h.clone());
				}
				if out.len() >= k {
					break;
				}
			}
			out
		}
		None => hits.into_iter().take(k).collect(),
	}
}

/// 프롬프트에 붙이는 자료 블록. 비어 있으면 빈 글이다.
pub fn prompt_block(hits: &[KbHit]) -> String {
	if hits.is_empty() {
		return String::new();
	}
	let mut s = String::from(
		"## 지식베이스에서 찾은 자료\n\
		이 프로젝트에 모아 둔 참고 문서에서 이번 일과 가까운 구획을 앱이 찾아 붙였다. 근거로 쓰되 관계없으면 무시한다. \
		자료는 낡았을 수 있다 — 지금 코드 · 이 일의 메모 · 사용자의 말과 어긋나면 그쪽을 따르고, 어긋난 자료와 그 내용을 답에 밝힌다. \
		아직 구현하지 않은 요구일 수도 있으니 어긋난다고 조용히 버리지 않는다. \
		더 읽어야 하면 「글자 사본」을 Read 로 연다 — 원본이 docx · hwpx · pdf 여도 사본은 글이다. 근거로 쓴 자료는 원본 경로로 밝힌다.\n",
	);
	for h in hits {
		let name = if h.label.is_empty() { file_name(&h.path) } else { format!("산출물 「{}」", h.label) };
		let section = if h.section.is_empty() { String::new() } else { format!(" › {}", h.section) };
		let mut one = format!("\n### {name}{section}\n- 원본: {}\n- 글자 사본: {}\n", h.path, h.text_path);
		if !h.why.is_empty() {
			one.push_str(&format!("- 요약: {}\n", h.why));
		}
		for l in h.excerpt.lines() {
			one.push_str(&format!("> {l}\n"));
		}
		if s.chars().count() + one.chars().count() > BLOCK_MAX {
			break;
		}
		s.push_str(&one);
	}
	s
}

/// 실행 기록에 남길 모양. 발췌는 빼서 issue.json 이 커지지 않게 한다.
pub fn brief(hits: &[KbHit]) -> Vec<KbHit> {
	hits.iter().map(|h| KbHit { excerpt: String::new(), ..h.clone() }).collect()
}

/* ---------- 7. 자동 갱신 ---------- */

const JUDGE_SYSTEM: &str = "너는 코드 변경이 어느 문서에 반영되어야 하는지 가린다. 문서가 다루는 내용이 이 변경으로 틀리게 되거나 빠지게 될 때만 고른다. JSON 배열 하나만 답한다.";

/// 이슈 하나의 변경을 판정 · 갱신에 넘길 글로 묶는다. 변경분은 앞부분만 싣는다.
fn change_brief(i: &Issue) -> String {
	let mut s = format!("## 이슈 #{} {}\n", i.number, i.title);
	if let Some(p) = &i.plan
		&& !p.summary.trim().is_empty()
	{
		s.push_str(&format!("\n계획: {}\n", p.summary.trim()));
	}
	if let Some(r) = &i.result
		&& !r.summary.trim().is_empty()
	{
		s.push_str(&format!("\n결과: {}\n", r.summary.trim()));
	}
	let mut rels: Vec<&str> = Vec::new();
	for c in &i.changes {
		if !rels.contains(&c.rel.as_str()) {
			rels.push(&c.rel);
		}
	}
	s.push_str("\n바뀐 파일\n");
	for r in &rels {
		s.push_str(&format!("- {r}\n"));
	}
	s.push_str("\n### 변경분 앞부분\n```diff\n");
	let mut budget: usize = 6000;
	'all: for c in &i.changes {
		s.push_str(&format!("--- {}\n", c.rel));
		for h in &c.hunks {
			for l in &h.lines {
				if budget < l.len() + 1 {
					break 'all;
				}
				budget -= l.len() + 1;
				s.push_str(l);
				s.push('\n');
			}
		}
	}
	s.push_str("```\n");
	s
}

/// 산출물 하나를 판정에 넘길 짧은 글. 카드가 있으면 카드 요약을, 없으면 최신 판의 앞부분을 쓴다.
fn describe(app: &AppHandle, pid: &str, list: &[Deliverable]) -> Vec<String> {
	let store = app.state::<Store>();
	let cat = load_catalog(&store.kb_dir(pid));
	list.iter()
		.map(|d| {
			let mut s = format!("{}{}\n", d.title, if d.note.trim().is_empty() { String::new() } else { format!(" · {}", d.note.trim()) });
			if !d.guide.trim().is_empty() {
				s.push_str(&format!("작성 지침: {}\n", d.guide.trim().chars().take(300).collect::<String>()));
			}
			let cards: Vec<String> = cat
				.files
				.iter()
				.filter(|f| f.deliverable_id == d.id)
				.flat_map(|f| f.sections.iter().filter_map(|s| s.card.as_ref().map(|c| format!("- {} {}", s.heading, c.summary))))
				.collect();
			if !cards.is_empty() {
				s.push_str(&cards.join("\n").chars().take(1500).collect::<String>());
			} else if let Some(v) = d.versions.last()
				&& let Ok(path) = store.version_path(pid, &d.id, v.n)
				&& let Ok(text) = extract::text_of(&path)
			{
				s.push_str(&text.chars().take(1500).collect::<String>());
			}
			s
		})
		.collect()
}

fn judge_prompt(brief: &str, cands: &[(&Deliverable, &String)]) -> String {
	let mut s = format!("{brief}\n## 산출물 후보\n");
	for (d, desc) in cands {
		s.push_str(&format!("\n### id: {}\n{}\n", d.id, desc.trim()));
	}
	s.push_str(
		"\n위 코드 변경 때문에 내용을 고쳐야 할 산출물만 골라 JSON 배열로만 답한다. \
		꼴: [{\"id\": \"산출물 id\", \"reason\": \"무엇이 왜 달라지는지 한 문장\"}]. 고칠 것이 없으면 [] 로 답한다.\n",
	);
	s
}

fn auto_request(i: &Issue, reason: &str, brief: &str, file_hint: Option<String>) -> String {
	let hint = file_hint.map(|p| format!("- 지금 판 파일: {p} — 이 파일의 구성과 문구를 바탕으로 고친 새 판을 만든다. 이 파일은 고치지 않는다.\n")).unwrap_or_default();
	format!(
		"이슈 #{n} 의 코드 변경이 끝났다. 이 산출물에 반영해야 할 내용이 있으면 반영한 새 판을 낸다.\n\
		- 고칠 곳은 이 변경과 관련된 부분으로 한정하고, 나머지는 지금 판의 문구 · 구성을 그대로 둔다.\n\
		- 반영할 것이 없으면 skip 을 true 로 하고 reason 에 까닭을 적는다. 이때 새 판을 만들지 않는다.\n\
		{hint}\n판정 까닭: {reason}\n\n{brief}",
		n = i.number
	)
}

/// 이슈를 완료한 뒤 부른다. 판정 · 갱신 결과는 그 이슈의 흐름에 deliverable 로 남는다.
pub async fn after_complete(app: AppHandle, pid: String, iid: String) {
	if let Err(e) = auto_update(&app, &pid, &iid).await {
		log_issue(&app, &pid, &iid, format!("판정 · 실패 · {e}"));
	}
}

pub fn log_issue(app: &AppHandle, pid: &str, iid: &str, text: String) {
	if let Ok(v) = app.state::<Store>().update_issue(pid, iid, |i| {
		i.log("deliverable", text);
		Ok(())
	}) {
		runner::emit_issue(app, &v);
	}
}

/// 산출물의 자동 관리 기록에 한 줄을 남긴다. 이슈 흐름의 기록(log_issue)과 짝이다.
fn log_deliverable(app: &AppHandle, pid: &str, did: &str, i: &Issue, verdict: &str, reason: &str) {
	let e = AutoEntry { at: now_ms(), issue_id: i.id.clone(), number: i.number, verdict: verdict.into(), reason: reason.into(), version: 0 };
	if let Ok(v) = app.state::<Store>().update_deliverable(pid, did, |d| {
		d.push_auto(e);
		Ok(())
	}) {
		runner::emit_deliverable(app, &v);
	}
}

/// 밀린 변경을 한꺼번에 반영할 때 받는 이슈 수의 상한. 넘으면 요청이 너무 길어진다.
pub const CATCH_UP_MAX: usize = 10;

/// 「밀린 변경 반영」. 사용자가 고른 이슈들의 변경을 한 요청으로 묶어 새 판을 쓴다.
/// 판정은 건너뛴다 — 반영할 이슈를 사람이 골랐다. 그래도 고칠 것이 없으면 Claude 가 skip 으로 답한다.
pub fn catch_up(app: &AppHandle, pid: &str, did: &str, issue_ids: &[String]) -> Result<DeliverableView> {
	if issue_ids.is_empty() {
		return Err(Error::Msg("반영할 이슈를 고르세요".into()));
	}
	if issue_ids.len() > CATCH_UP_MAX {
		return Err(Error::Msg(format!("한 번에 {CATCH_UP_MAX}건까지 반영합니다. 나눠서 반영하세요.")));
	}
	let store = app.state::<Store>();
	let d = store.get_deliverable(pid, did)?.deliverable;
	let last = d.versions.last().cloned().ok_or_else(|| Error::Msg("판이 하나는 있어야 반영합니다".into()))?;
	let mut issues: Vec<Issue> = issue_ids.iter().map(|id| store.raw_issue(pid, id)).collect::<Result<_>>()?;
	issues.sort_by_key(|i| i.number);
	let briefs: Vec<String> = issues.iter().map(change_brief).collect();
	let lower = last.file.to_lowercase();
	let text_like = [".md", ".markdown", ".txt"].iter().any(|e| lower.ends_with(e));
	let hint = if text_like { String::new() } else { store.version_path(pid, did, last.n).map(|p| format!("- 지금 판 파일: {} — 이 파일의 구성과 문구를 바탕으로 고친 새 판을 만든다. 이 파일은 고치지 않는다.\n", p.display())).unwrap_or_default() };
	let nums: Vec<String> = issues.iter().map(|i| format!("#{}", i.number)).collect();
	let request = format!(
		"이슈 {} 의 코드 변경이 이 산출물에 아직 반영되지 않았다. 아래 변경을 모두 반영한 새 판을 낸다.\n\
		- 고칠 곳은 이 변경들과 관련된 부분으로 한정하고, 나머지는 지금 판의 문구 · 구성을 그대로 둔다.\n\
		- 변경끼리 어긋나면 번호가 큰(나중) 이슈를 따른다.\n\
		- 반영할 것이 하나도 없으면 skip 을 true 로 하고 reason 에 까닭을 적는다. 이때 새 판을 만들지 않는다.\n\
		{hint}\n{}",
		nums.join(" "),
		briefs.join("\n")
	);
	runner::document_job(app, pid, Some(did.to_string()), request, "", issues.iter().map(|i| i.id.clone()).collect())
}

async fn auto_update(app: &AppHandle, pid: &str, iid: &str) -> Result<()> {
	let store = app.state::<Store>();
	let issue = store.raw_issue(pid, iid)?;
	// 코드를 고치지 않은 이슈는 산출물에 반영할 것도 없다.
	if issue.changes.is_empty() {
		return Ok(());
	}
	let all: Vec<Deliverable> =
		store.list_deliverables(pid)?.into_iter().map(|v| v.deliverable).filter(|d| d.auto_update && !d.versions.is_empty()).collect();
	if all.is_empty() {
		return Ok(());
	}
	let (busy, cands): (Vec<Deliverable>, Vec<Deliverable>) = all.into_iter().partition(|d| d.job.is_some());
	for d in &busy {
		log_issue(app, pid, iid, format!("{} · 건너뜀 · 이미 작성 중", d.title));
		log_deliverable(app, pid, &d.id, &issue, "busy", "이미 작성 중");
	}
	if cands.is_empty() {
		return Ok(());
	}
	// 판정이 실패하면 후보 모두에 실패로 남긴다. 남기지 않으면 기록에는 아무 일도 없던 것처럼 보인다.
	let ids: Vec<String> = cands.iter().map(|d| d.id.clone()).collect();
	let res = judge_and_write(app, pid, iid, &issue, cands).await;
	if let Err(e) = &res {
		for did in &ids {
			log_deliverable(app, pid, did, &issue, "failed", &format!("판정 실패 · {e}"));
		}
	}
	res
}

async fn judge_and_write(app: &AppHandle, pid: &str, iid: &str, issue: &Issue, mut cands: Vec<Deliverable>) -> Result<()> {
	let store = app.state::<Store>();
	let settings = store.settings()?;
	let exe = runner::resolve_claude(&settings.claude_path).ok_or_else(|| Error::Msg("claude 실행 파일을 찾지 못했습니다".into()))?;
	let brief = change_brief(issue);
	let (a, p, list) = (app.clone(), pid.to_string(), cands.clone());
	let mut descs = tokio::task::spawn_blocking(move || describe(&a, &p, &list)).await.map_err(|e| Error::Msg(e.to_string()))?;

	// 많으면 변경 글과 낱말이 많이 겹치는 것부터 JUDGE_MAX 개만 넘긴다. 판정 호출이 너무 길어지지 않게.
	if cands.len() > JUDGE_MAX {
		let q: HashSet<String> = tokens(&brief).into_iter().collect();
		let mut order: Vec<(usize, usize)> = descs.iter().enumerate().map(|(i, d)| (tokens(d).iter().filter(|t| q.contains(*t)).count(), i)).collect();
		order.sort_by(|x, y| y.0.cmp(&x.0));
		let keep: Vec<usize> = order.into_iter().take(JUDGE_MAX).map(|(_, i)| i).collect();
		cands = keep.iter().map(|&i| cands[i].clone()).collect();
		descs = keep.iter().map(|&i| descs[i].clone()).collect();
	}
	let pairs: Vec<(&Deliverable, &String)> = cands.iter().zip(descs.iter()).collect();
	let dir = store.kb_dir(pid);
	let answer = runner::quick_call(exe, (pid, "judge"), &card_model(&settings), JUDGE_SYSTEM, judge_prompt(&brief, &pairs), &store.project_dir(pid), dir.join("judge.last.jsonl"), 120)
		.await
		.ok_or_else(|| Error::Msg("판정 호출이 실패했습니다".into()))?;
	let Some(Value::Array(items)) = json_in(&answer.0) else { return Err(Error::Msg("판정 답을 읽지 못했습니다".into())) };
	let chosen: Vec<(Deliverable, String)> = items
		.iter()
		.filter_map(|it| {
			let id = it.get("id")?.as_str()?;
			let d = cands.iter().find(|d| d.id == id)?;
			Some((d.clone(), it.get("reason").and_then(|x| x.as_str()).unwrap_or("").trim().to_string()))
		})
		.collect();
	let rest: Vec<&Deliverable> = cands.iter().filter(|d| !chosen.iter().any(|(c, _)| c.id == d.id)).collect();
	let mut line = String::from("판정");
	if !chosen.is_empty() {
		line.push_str(&format!(" · 고칠 산출물: {}", chosen.iter().map(|(d, _)| d.title.as_str()).collect::<Vec<_>>().join(", ")));
	}
	if !rest.is_empty() {
		line.push_str(&format!(" · 관계없음: {}", rest.iter().map(|d| d.title.as_str()).collect::<Vec<_>>().join(", ")));
	}
	log_issue(app, pid, iid, line);
	for d in &rest {
		log_deliverable(app, pid, &d.id, issue, "unrelated", "");
	}

	for (d, reason) in chosen {
		// 글 판이 아니면(docx · hwpx …) 본문을 프롬프트에 실을 수 없어 파일 경로를 준다.
		let last = d.versions.last().cloned().unwrap_or_default();
		let lower = last.file.to_lowercase();
		let text_like = [".md", ".markdown", ".txt"].iter().any(|e| lower.ends_with(e));
		let hint = if text_like { None } else { store.version_path(pid, &d.id, last.n).ok().map(|p| p.to_string_lossy().to_string()) };
		if let Err(e) = runner::document_from(app, pid, Some(d.id.clone()), auto_request(issue, &reason, &brief, hint), iid) {
			log_issue(app, pid, iid, format!("{} · 실패 · {e}", d.title));
			log_deliverable(app, pid, &d.id, issue, "failed", &e.to_string());
		}
	}
	Ok(())
}

/* ---------- 8. 화면에 보내는 모양 ---------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbFileView {
	pub path: String,
	pub source: String,
	pub label: String,
	pub size: u64,
	pub sections: usize,
	pub cards: usize,
	pub skipped: String,
	/// exclude · version · 빈 글
	pub held: String,
	/// 판 묶기에서 「다시 넣기」로 되살린 파일
	pub kept: bool,
	pub card_error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KbView {
	pub kb: ProjectKb,
	pub dir: String,
	pub inbox_dir: String,
	pub exts: Vec<String>,
	pub files: Vec<KbFileView>,
	pub sections: usize,
	pub cards: usize,
	pub pending: usize,
	pub indexed_at: i64,
	pub card_cost_usd: f64,
	pub truncated: bool,
	pub card_model: String,
	pub progress: Progress,
}

pub fn status(app: &AppHandle, pid: &str) -> Result<KbView> {
	let store = app.state::<Store>();
	let p = store.project(pid)?;
	let dir = store.kb_dir(pid);
	let cat = load_catalog(&dir);
	let files: Vec<KbFileView> = cat
		.files
		.iter()
		.map(|f| KbFileView {
			path: f.path.clone(),
			source: f.source.clone(),
			label: f.label.clone(),
			size: f.size,
			sections: f.sections.len(),
			cards: f.sections.iter().filter(|s| s.card.is_some()).count(),
			skipped: f.skipped.clone(),
			held: f.held.clone(),
			kept: p.kb.keep.iter().any(|k| same_path(k, &f.path)),
			card_error: f.card_error.clone(),
		})
		.collect();
	// 빠진 파일은 카드를 남겨 두지만 찾기에 쓰이지 않으므로 세지 않는다.
	let live = || files.iter().filter(|f| f.skipped.is_empty());
	let (sections, cards) = (live().map(|f| f.sections).sum(), live().map(|f| f.cards).sum());
	Ok(KbView {
		kb: p.kb,
		inbox_dir: dir.join("inbox").to_string_lossy().to_string(),
		dir: dir.to_string_lossy().to_string(),
		exts: extract::KB_EXTS.iter().map(|s| s.to_string()).collect(),
		sections,
		cards,
		pending: pending_cards(&cat),
		files,
		indexed_at: cat.indexed_at,
		card_cost_usd: cat.card_cost_usd,
		truncated: cat.truncated,
		card_model: card_model(&store.settings()?),
		progress: app.state::<Kb>().progress(pid),
	})
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionView {
	pub heading: String,
	pub card: Option<Card>,
	pub excerpt: String,
}

/// 파일 하나의 구획과 카드. 화면의 파일 상세에 보인다.
pub fn cards_of(app: &AppHandle, pid: &str, path: &str) -> Result<Vec<SectionView>> {
	let cat = load_catalog(&app.state::<Store>().kb_dir(pid));
	let f = cat.files.iter().find(|f| f.path == path).ok_or_else(|| Error::Msg("색인에 없는 파일입니다".into()))?;
	let text = fs::read_to_string(&f.text_path).unwrap_or_default();
	Ok(f
		.sections
		.iter()
		.map(|s| SectionView {
			heading: s.heading.clone(),
			card: s.card.clone(),
			excerpt: text.get(s.start..s.end).map(|b| b.trim().chars().take(400).collect()).unwrap_or_default(),
		})
		.collect())
}

#[cfg(test)]
mod tests {
	use super::*;

	/// 조사를 떼고, 붙여 쓴 합성어는 두 글자 조각으로도 찾힌다.
	#[test]
	fn tokens_strip_josa_and_split_compounds() {
		let t = tokens("재해위험성을 검토는 API");
		assert!(t.contains(&"재해위험성".to_string()), "{t:?}");
		assert!(t.contains(&"위험".to_string()), "{t:?}");
		assert!(t.contains(&"검토".to_string()), "{t:?}");
		assert!(t.contains(&"api".to_string()), "{t:?}");
		assert!(!t.iter().any(|x| x.ends_with('을')), "{t:?}");
	}

	/// 제목 줄에서 끊고, 구획은 글자 경계 범위로 남는다.
	#[test]
	fn sections_follow_headings() {
		let text = "머리말\n# 개요\n한글 본문\n## 판정\n기준표\n";
		let s = split_sections(text);
		assert_eq!(s.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), vec!["", "개요", "판정"]);
		assert_eq!(&text[s[2].1..s[2].2], "## 판정\n기준표\n");
	}

	/// 카드의 비슷한 말로 본문에 없는 낱말도 찾힌다. 자기 산출물은 뺄 수 있다.
	#[test]
	fn search_uses_cards_and_excludes() {
		let dir = std::env::temp_dir().join(format!("docket-kb-{}", short_id()));
		fs::create_dir_all(&dir).unwrap();
		let tp = dir.join("a.txt");
		fs::write(&tp, "# 회신\n검토 결과를 보낸다.\n").unwrap();
		let text = fs::read_to_string(&tp).unwrap();
		let sections = split_sections(&text)
			.into_iter()
			.map(|(heading, start, end)| Section {
				heading,
				start,
				end,
				hash: String::new(),
				card: Some(Card { aliases: vec!["결과 통보".into()], ..Default::default() }),
			})
			.collect();
		let cat = Catalog {
			files: vec![KbFile { path: "C:/문서/회신.md".into(), text_path: tp.to_string_lossy().into(), deliverable_id: "d1".into(), sections, ..Default::default() }],
			..Default::default()
		};
		save_catalog(&dir, &cat).unwrap();
		let hits = search_local(&dir, "통보 기준", 5, "");
		assert_eq!(hits.len(), 1);
		assert_eq!(hits[0].section, "회신");
		assert!(search_local(&dir, "통보 기준", 5, "d1").is_empty());
		let _ = fs::remove_dir_all(&dir);
	}

	#[test]
	fn json_in_reads_wrapped_answers() {
		assert_eq!(json_in("```json\n[1, 2]\n```").unwrap(), serde_json::json!([1, 2]));
		assert_eq!(json_in("답: {\"a\": 1} 끝").unwrap(), serde_json::json!({"a": 1}));
		assert!(json_in("없음").is_none());
	}

	/// 이름 끝의 판 · 날짜 · 사본 표시를 떼고, 순서를 말해 주지 않는 이름은 그대로 둔다.
	#[test]
	fn marks_read_version_date_copy() {
		let m = mark("산림인접건축_담당자매뉴얼_v14_20261027");
		assert_eq!((m.base.as_str(), m.version, m.date, m.copy), ("산림인접건축_담당자매뉴얼", Some(vec![14]), Some(20261027), false));
		let m = mark("01.LLM플랫폼 배포가이드_v1.1");
		assert_eq!((m.base.as_str(), m.version), ("01.llm플랫폼 배포가이드", Some(vec![1, 1])));
		let m = mark("검토의견서_TEST20260903_001 (1)");
		assert_eq!((m.base.as_str(), m.copy), ("검토의견서_test20260903_001", true));
		let m = mark("운영매뉴얼_v0.4_20261016_내부용");
		assert_eq!((m.base.as_str(), m.version), ("운영매뉴얼_v0.4_20261016_내부용", None));
	}

	/// 낮은 판 · 같은 판의 다른 형식 · 원본이 곁에 있는 사본만 빼고, 판 표시가 없는 것과 다른 폴더의 것은 남긴다.
	#[test]
	fn older_versions_keep_only_the_latest() {
		let names = [
			r"D:\d\매뉴얼_v4_20261026.pptx",
			r"D:\d\매뉴얼_v14_20261027.pptx",
			r"D:\d\매뉴얼_v14_20261027.pdf",
			r"D:\d\확인요청_v1_20261013.hwpx",
			r"D:\d\확인요청_v6_20261013.hwpx",
			r"D:\d\확인요청.hwpx",
			r"D:\d\의견서 (1).pdf",
			r"D:\d\의견서.pdf",
			r"D:\d\보고_최종.docx",
			r"D:\d\보고.docx",
			r"D:\e\매뉴얼_v1.pptx",
			r"D:\d\옛양식_v9.hwp",
		];
		let paths: Vec<&Path> = names.iter().map(Path::new).collect();
		let out = older_versions(&paths);
		let mut gone: Vec<usize> = out.keys().copied().collect();
		gone.sort();
		assert_eq!(gone, vec![0, 2, 3, 6], "{out:?}");
		assert!(out[&0].contains("매뉴얼_v14_20261027.pptx"), "{out:?}");
		assert!(out[&2].starts_with("같은 판의 다른 형식"), "{out:?}");
	}

	/// 이름 조각은 훑기 시작한 폴더 안쪽에만 맞추고, 전체 경로는 그 아래를 모두 뺀다.
	#[test]
	fn exclude_rules_match_inside_root() {
		let root = Path::new(r"D:\workspace\docs");
		let f = Path::new(r"D:\workspace\docs\설계\이전판\요구_v1.docx");
		assert!(excluded(f, root, &["이전판".into()]));
		assert!(excluded(f, root, &[r"d:/workspace/docs/설계".into()]));
		assert!(!excluded(f, root, &["workspace".into()]));
		assert!(!excluded(f, root, &[r"D:\workspace\docs\설".into()]));
	}

	/// 붙이는 자료에는 「지금 코드가 먼저 · 어긋나면 밝힌다」가 함께 간다.
	#[test]
	fn prompt_block_warns_about_stale() {
		let b = prompt_block(&[KbHit { path: "a.md".into(), excerpt: "본문".into(), ..Default::default() }]);
		assert!(b.contains("낡았을 수 있다") && b.contains("밝힌다"), "{b}");
		assert!(prompt_block(&[]).is_empty());
	}

	#[test]
	fn secret_names_are_skipped() {
		assert!(secret_name(".env.local"));
		assert!(secret_name("server.pem"));
		assert!(!secret_name("요구사항.docx"));
	}
}
