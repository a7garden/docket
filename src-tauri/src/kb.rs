//! 지식베이스. 프로젝트마다 참고 문서를 모아 두고, 계획 · 대화 · 산출물 작성 때 관련 있는 구획을 찾아 프롬프트에 붙인다.
//!
//! - 출처는 셋이다. 사용자가 고른 폴더(복사하지 않고 그 자리를 훑는다) · 끌어 놓은 파일과 폴더(kb/inbox/ 로 복사) · 산출물의 최신 판.
//! - 글자는 kb/text/ 에 뽑아 둔다. Claude 의 Read 가 docx · hwpx · pdf 를 바로 읽지 못해서다. 발췌 밖의 원문은 이 사본을 연다.
//! - 색인 카드: 구획마다 Claude(가벼운 모델)가 요약 · 핵심어 · 비슷한 말 · 답할 질문을 한 번 적어 둔다.
//!   Claude 에는 임베딩이 없어서, 「미리 한 번 소화해 뜻으로 찾게 해 두는」 일을 벡터 대신 글 카드로 한다.
//!   뜻은 같은데 낱말이 다른 경우(「회신」 ↔ 「결과 통보」)를 카드의 비슷한 말이 메운다.
//! - 찾기는 로컬 BM25 다. 카드와 원문에 점수를 매기고 카드에 무게를 더 준다. 찾을 때는 Claude 를 부르지 않는다.
//!   「고르기 다듬기」를 켜면 후보를 Claude 에 한 번 넘겨 다시 고른다.
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
//! 2. 훑기 · 글자 사본 · 구획 나누기
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
use crate::store::{Store, write_atomic};

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
fn json_in(text: &str) -> Option<Value> {
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
			out.push(Found { path: e.path(), source, label: String::new(), did: String::new() });
		}
	}
	false
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
				found.push(Found { path, source: "deliverable", label: d.title.clone(), did: d.id.clone() });
			}
		}
	}
	for f in &p.kb.folders {
		truncated |= walk(Path::new(f), "folder", &mut found);
	}
	truncated |= walk(&dir.join("inbox"), "inbox", &mut found);

	let mut files = Vec::new();
	let mut seen = HashSet::new();
	for f in found {
		let key = f.path.to_string_lossy().to_string();
		if !seen.insert(key.to_lowercase()) {
			continue;
		}
		let (mtime, size) = fs::metadata(&f.path).map(|m| (modified_ms(&m), m.len())).unwrap_or((0, 0));
		let mut file = match by_path.remove(&key) {
			Some(pf) if pf.mtime == mtime && pf.size == size && (!pf.skipped.is_empty() || Path::new(&pf.text_path).is_file()) => pf,
			pf => build(&dir, &f.path, &key, mtime, size, pf),
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
				let answer = runner::quick_call(exe.clone(), &model, CARD_SYSTEM, prompt, &dir, dir.join("cards.last.jsonl"), 180).await;
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
	let answer = runner::quick_call(exe, &card_model(settings), RERANK_SYSTEM, rerank_prompt(query, &hits, k), &dir, dir.join("rerank.last.jsonl"), 60).await;
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
	let (busy, mut cands): (Vec<Deliverable>, Vec<Deliverable>) = all.into_iter().partition(|d| d.job.is_some());
	for d in &busy {
		log_issue(app, pid, iid, format!("{} · 건너뜀 · 이미 작성 중", d.title));
	}
	if cands.is_empty() {
		return Ok(());
	}
	let settings = store.settings()?;
	let exe = runner::resolve_claude(&settings.claude_path).ok_or_else(|| Error::Msg("claude 실행 파일을 찾지 못했습니다".into()))?;
	let brief = change_brief(&issue);
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
	let answer = runner::quick_call(exe, &card_model(&settings), JUDGE_SYSTEM, judge_prompt(&brief, &pairs), &store.project_dir(pid), dir.join("judge.last.jsonl"), 120)
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
	let rest: Vec<&str> = cands.iter().filter(|d| !chosen.iter().any(|(c, _)| c.id == d.id)).map(|d| d.title.as_str()).collect();
	let mut line = String::from("판정");
	if !chosen.is_empty() {
		line.push_str(&format!(" · 고칠 산출물: {}", chosen.iter().map(|(d, _)| d.title.as_str()).collect::<Vec<_>>().join(", ")));
	}
	if !rest.is_empty() {
		line.push_str(&format!(" · 관계없음: {}", rest.join(", ")));
	}
	log_issue(app, pid, iid, line);

	for (d, reason) in chosen {
		// 글 판이 아니면(docx · hwpx …) 본문을 프롬프트에 실을 수 없어 파일 경로를 준다.
		let last = d.versions.last().cloned().unwrap_or_default();
		let lower = last.file.to_lowercase();
		let text_like = [".md", ".markdown", ".txt"].iter().any(|e| lower.ends_with(e));
		let hint = if text_like { None } else { store.version_path(pid, &d.id, last.n).ok().map(|p| p.to_string_lossy().to_string()) };
		if let Err(e) = runner::document_from(app, pid, Some(d.id.clone()), auto_request(&issue, &reason, &brief, hint), iid) {
			log_issue(app, pid, iid, format!("{} · 실패 · {e}", d.title));
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
			card_error: f.card_error.clone(),
		})
		.collect();
	Ok(KbView {
		kb: p.kb,
		inbox_dir: dir.join("inbox").to_string_lossy().to_string(),
		dir: dir.to_string_lossy().to_string(),
		exts: extract::KB_EXTS.iter().map(|s| s.to_string()).collect(),
		sections: files.iter().map(|f| f.sections).sum(),
		cards: files.iter().map(|f| f.cards).sum(),
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

	#[test]
	fn secret_names_are_skipped() {
		assert!(secret_name(".env.local"));
		assert!(secret_name("server.pem"));
		assert!(!secret_name("요구사항.docx"));
	}
}
