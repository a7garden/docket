//! DB 자료. 사용자가 적은 조회 명령을 앱이 돌려 표준 출력(탭으로 나눈 행)을 받고, 정리한 결과를 스냅숏으로 둔다.
//! 지난 스냅숏과 견준 변경은 산출물의 DB 트리거(`db:<자료 id>`)가 따른다 — 반영 대기 · 판정 · 새 판 쓰기는 이슈 변경과 같은 길이다(kb.rs).
//!
//! 명령은 앱이 돌리고 Claude 에는 넘기지 않는다. 접속 정보가 프롬프트 · 실행 기록에 남지 않게 하려는 것이다.
//! Claude 는 스냅숏 파일과 변경 요약만 받는다.
//!
//! 저장 자리: projects/<pid>/db/<자료 id>/ index.json · <스냅숏 id>.tsv(첫 줄은 칸 이름)

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result, msg};
use crate::model::*;
use crate::store::Store;

/// 자료마다 남길 스냅숏 수. 넘으면 오래된 것부터 지운다.
pub const SNAP_MAX: usize = 100;
/// 변경 요약 글의 상한. 판정 · 작성 프롬프트가 너무 길어지지 않게 한다.
const BRIEF_MAX: usize = 6000;
/// 출력 상한. 구조 조회가 이보다 크면 명령이 잘못됐을 가능성이 크다.
const OUTPUT_MAX: usize = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SnapMeta {
	pub id: String,
	pub at: i64,
	pub rows: usize,
	/// 바로 앞 스냅숏과 견준 수. 첫 스냅숏은 모두 0 이다(비교의 바탕).
	pub added: usize,
	pub removed: usize,
	pub changed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DbIndex {
	pub snapshots: Vec<SnapMeta>,
	/// 마지막으로 명령을 돌린 때. 바뀐 것이 없어도 갱신한다.
	pub checked_at: i64,
	/// 마지막 실행의 오류. 성공하면 비운다.
	pub error: String,
}

/* ---------- 자리 ---------- */

pub fn source_dir(store: &Store, pid: &str, sid: &str) -> PathBuf {
	store.project_dir(pid).join("db").join(sid)
}

pub fn read_index(dir: &Path) -> DbIndex {
	std::fs::read(dir.join("index.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_index(dir: &Path, idx: &DbIndex) -> Result<()> {
	std::fs::create_dir_all(dir)?;
	let tmp = dir.join("index.json.tmp");
	std::fs::write(&tmp, serde_json::to_vec_pretty(idx)?)?;
	std::fs::rename(&tmp, dir.join("index.json"))?;
	Ok(())
}

pub fn snap_path(dir: &Path, id: &str) -> PathBuf {
	dir.join(format!("{id}.tsv"))
}

/// 스냅숏의 행. 첫 줄(칸 이름)은 뺀다.
pub fn rows_of(dir: &Path, id: &str) -> Option<Vec<String>> {
	let text = std::fs::read_to_string(snap_path(dir, id)).ok()?;
	Some(text.lines().skip(1).map(str::to_string).collect())
}

/* ---------- 정리 · 비교 ---------- */

/// 출력을 행으로 정리한다. 끝 공백 · 빈 줄 · psql 의 「(N rows)」 꼬리를 빼고 정렬한다.
/// 정렬하는 까닭: 같은 구조를 두 번 받았을 때 행 순서만 달라 「바뀜」으로 보이지 않게.
pub fn normalize(raw: &str) -> Vec<String> {
	let mut rows: Vec<String> = raw
		.lines()
		.map(|l| l.trim_end_matches(['\r', ' ']).to_string())
		.filter(|l| !l.trim().is_empty())
		.filter(|l| !is_footer(l.trim()))
		.collect();
	rows.sort();
	rows
}

fn is_footer(l: &str) -> bool {
	l.starts_with('(') && l.ends_with(')') && (l.contains(" row") || l.contains("행"))
}

fn cells(row: &str) -> Vec<&str> {
	row.split('\t').collect()
}

fn key_of(row: &str, key_cols: usize) -> String {
	cells(row).into_iter().take(key_cols.max(1)).collect::<Vec<_>>().join(".")
}

/// 열쇠 → 행. 같은 열쇠가 또 나오면 「#2」를 붙여 따로 센다(열쇠 칸을 적게 잡은 조회).
fn keyed(rows: &[String], key_cols: usize) -> BTreeMap<String, &str> {
	let mut out: BTreeMap<String, &str> = BTreeMap::new();
	let mut seen: HashMap<String, usize> = HashMap::new();
	for r in rows {
		let k = key_of(r, key_cols);
		let n = seen.entry(k.clone()).or_insert(0);
		*n += 1;
		let k = if *n == 1 { k } else { format!("{k}#{n}") };
		out.insert(k, r.as_str());
	}
	out
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Diff {
	pub added: Vec<String>,
	pub removed: Vec<String>,
	/// 열쇠와 바뀐 칸(칸 번호 · 전 값 · 새 값)
	pub changed: Vec<(String, Vec<(usize, String, String)>)>,
}

impl Diff {
	pub fn is_empty(&self) -> bool {
		self.added.is_empty() && self.removed.is_empty() && self.changed.is_empty()
	}

	/// 추가 2 · 삭제 1 · 바뀜 3
	pub fn summary(&self) -> String {
		let mut parts = Vec::new();
		if !self.added.is_empty() {
			parts.push(format!("추가 {}", self.added.len()));
		}
		if !self.removed.is_empty() {
			parts.push(format!("삭제 {}", self.removed.len()));
		}
		if !self.changed.is_empty() {
			parts.push(format!("바뀜 {}", self.changed.len()));
		}
		if parts.is_empty() { "바뀐 것 없음".into() } else { parts.join(" · ") }
	}
}

pub fn diff(old: &[String], new: &[String], key_cols: usize) -> Diff {
	let a = keyed(old, key_cols);
	let b = keyed(new, key_cols);
	let mut d = Diff::default();
	for (k, row) in &b {
		match a.get(k) {
			None => d.added.push((*row).to_string()),
			Some(prev) if prev != row => {
				let (pc, nc) = (cells(prev), cells(row));
				let width = pc.len().max(nc.len());
				let cols: Vec<(usize, String, String)> = (0..width)
					.filter_map(|i| {
						let (x, y) = (pc.get(i).copied().unwrap_or(""), nc.get(i).copied().unwrap_or(""));
						(x != y).then(|| (i, x.to_string(), y.to_string()))
					})
					.collect();
				d.changed.push((k.clone(), cols));
			}
			_ => {}
		}
	}
	for (k, row) in &a {
		if !b.contains_key(k) {
			d.removed.push((*row).to_string());
		}
	}
	d
}

fn col_name(columns: &[String], i: usize) -> String {
	columns.get(i).map(|c| c.trim()).filter(|c| !c.is_empty()).map(str::to_string).unwrap_or_else(|| format!("칸 {}", i + 1))
}

/// 판정 · 작성에 넘길 변경 글. 최신 스냅숏 파일 경로를 함께 적어 전체 구조는 Claude 가 Read 로 본다.
pub fn brief(src: &DbSource, d: &Diff, base: &SnapMeta, latest: &SnapMeta, latest_path: &Path) -> String {
	let when = |at: i64| chrono::DateTime::from_timestamp_millis(at).map(|t| t.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string()).unwrap_or_default();
	let mut s = format!(
		"## DB 자료 「{}」의 구조 변경\n{} → {} 에 받은 구조를 견줬다. {}.\n- 지금 구조 전체: {} (탭으로 나눈 표, 첫 줄은 칸 이름)\n",
		src.name,
		when(base.at),
		when(latest.at),
		d.summary(),
		latest_path.display()
	);
	if !src.columns.is_empty() {
		s.push_str(&format!("- 칸: {}\n", src.columns.join(" · ")));
	}
	let mut body = String::new();
	let mut cut = false;
	let mut push = |body: &mut String, line: String| {
		if body.len() + line.len() > BRIEF_MAX {
			cut = true;
			return;
		}
		body.push_str(&line);
	};
	if !d.added.is_empty() {
		push(&mut body, "\n### 추가된 행\n".into());
		for r in &d.added {
			push(&mut body, format!("- {}\n", r.replace('\t', " | ")));
		}
	}
	if !d.removed.is_empty() {
		push(&mut body, "\n### 삭제된 행\n".into());
		for r in &d.removed {
			push(&mut body, format!("- {}\n", r.replace('\t', " | ")));
		}
	}
	if !d.changed.is_empty() {
		push(&mut body, "\n### 바뀐 행\n".into());
		for (k, cols) in &d.changed {
			let what: Vec<String> = cols.iter().map(|(i, x, y)| format!("{}: {} → {}", col_name(&src.columns, *i), show(x), show(y))).collect();
			push(&mut body, format!("- {k} — {}\n", what.join(" · ")));
		}
	}
	s.push_str(&body);
	if cut {
		s.push_str("\n(변경이 많아 앞부분만 실었다. 나머지는 지금 구조 파일에서 본다.)\n");
	}
	s
}

fn show(v: &str) -> &str {
	if v.is_empty() { "(빈 값)" } else { v }
}

/* ---------- 비밀번호 지우기 ---------- */

/// 오류 글 · 화면에 보일 글에서 비밀번호 꼴을 지운다. `password=…` · `PGPASSWORD=…` · `pwd=…` · `postgres://사용자:비번@`.
pub fn scrub(s: &str) -> String {
	let mut out = String::with_capacity(s.len());
	// ASCII 만 바꿔 바이트 위치가 원문과 같게 둔다.
	let lower = s.to_ascii_lowercase();
	let keys = ["pgpassword=", "password=", "pwd="];
	let bytes = s.as_bytes();
	let mut i = 0;
	while i < s.len() {
		if let Some(k) = keys.iter().find(|k| lower[i..].starts_with(*k)) {
			out.push_str(&s[i..i + k.len()]);
			out.push_str("***");
			i += k.len();
			while i < s.len() && !matches!(bytes[i], b' ' | b'\t' | b'\r' | b'\n' | b'"' | b'\'' | b';' | b'&') {
				i += 1;
			}
			continue;
		}
		if lower[i..].starts_with("://") {
			// 스킴 뒤 사용자:비번@ 의 비번만 가린다.
			let rest = &s[i + 3..];
			let end = rest.find(|c: char| c.is_whitespace() || c == '/' || c == '"').unwrap_or(rest.len());
			let auth = &rest[..end];
			if let (Some(at), Some(colon)) = (auth.rfind('@'), auth.find(':'))
				&& colon < at
			{
				out.push_str("://");
				out.push_str(&auth[..colon + 1]);
				out.push_str("***");
				out.push_str(&auth[at..]);
				i += 3 + end;
				continue;
			}
		}
		let ch = s[i..].chars().next().unwrap_or(' ');
		out.push(ch);
		i += ch.len_utf8();
	}
	out
}

/* ---------- 받기 ---------- */

/// 지금 받는 중인 자료(pid/sid). 같은 자료를 겹쳐 받지 않는다.
static BUSY: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

struct BusyGuard(String);
impl Drop for BusyGuard {
	fn drop(&mut self) {
		BUSY.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.0);
	}
}

/// 명령을 cmd 로 돌리고 표준 출력을 돌려준다. 창은 띄우지 않는다.
/// chcp 65001 로 cmd 의 안내 글(명령을 찾지 못함 등)도 UTF-8 로 받고, psql 은 PGCLIENTENCODING 으로 UTF-8 을 내게 한다.
async fn run_command(src: &DbSource, cwd: &Path) -> Result<String> {
	let mut cmd = std::process::Command::new("cmd");
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		cmd.raw_arg(format!("/D /S /C \"chcp 65001>nul & {}\"", src.command.trim()));
		cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
	}
	#[cfg(not(windows))]
	{
		cmd = std::process::Command::new("sh");
		cmd.args(["-c", src.command.trim()]);
	}
	cmd.current_dir(cwd)
		.env("PGCLIENTENCODING", "UTF8")
		.stdin(std::process::Stdio::null())
		.stdout(std::process::Stdio::piped())
		.stderr(std::process::Stdio::piped());
	let mut cmd = tokio::process::Command::from(cmd);
	cmd.kill_on_drop(true);
	let child = cmd.spawn().map_err(|e| Error::Msg(format!("명령을 띄우지 못했습니다: {e}")))?;
	let secs = src.timeout_sec.clamp(5, 600);
	let out = match tokio::time::timeout(Duration::from_secs(secs), child.wait_with_output()).await {
		Ok(r) => r.map_err(|e| Error::Msg(format!("명령 출력을 읽지 못했습니다: {e}")))?,
		Err(_) => return msg(format!("{secs}초 안에 끝나지 않아 멈췄습니다")),
	};
	if out.stdout.len() > OUTPUT_MAX {
		return msg("출력이 너무 큽니다(64MB 넘음). 조회문을 확인하세요");
	}
	let stdout = String::from_utf8_lossy(&out.stdout).to_string();
	if !out.status.success() {
		let err = String::from_utf8_lossy(&out.stderr);
		let err = if err.trim().is_empty() { stdout.chars().take(500).collect::<String>() } else { err.chars().take(800).collect() };
		return msg(format!("명령이 실패했습니다(종료 코드 {}): {}", out.status.code().unwrap_or(-1), scrub(err.trim())));
	}
	Ok(stdout)
}

/// 한 번 받은 결과.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
	/// 앞 스냅숏과 달라 새 스냅숏을 남겼다. 첫 스냅숏은 바탕이라 false 다.
	pub changed: bool,
	pub first: bool,
	pub rows: usize,
	pub summary: String,
	pub snapshot: Option<SnapMeta>,
}

/// 자료 하나를 받아 스냅숏으로 남긴다. 바뀐 것이 없으면 받은 시각만 고친다.
pub async fn fetch(app: &AppHandle, pid: &str, sid: &str) -> Result<FetchResult> {
	let store = app.state::<Store>();
	let project = store.project(pid)?;
	let src = project.db_sources.iter().find(|s| s.id == sid).cloned().ok_or_else(|| Error::Msg("DB 자료를 찾을 수 없습니다".into()))?;
	if src.command.trim().is_empty() {
		return msg("조회 명령이 비어 있습니다");
	}
	let key = format!("{pid}/{sid}");
	if !BUSY.lock().unwrap_or_else(|e| e.into_inner()).insert(key.clone()) {
		return msg("이미 받는 중입니다");
	}
	let _busy = BusyGuard(key);
	let dir = source_dir(&store, pid, sid);
	let cwd = if src.cwd.trim().is_empty() { PathBuf::from(&project.path) } else { PathBuf::from(src.cwd.trim()) };
	let res = run_command(&src, &cwd).await.and_then(|out| {
		let rows = normalize(&out);
		if rows.is_empty() {
			// 빈 결과를 스냅숏으로 남기면 다음 비교에서 모든 행이 「추가」로 보인다. 접속 실패를 빈 출력으로 내는 명령도 있다.
			return msg("명령이 행을 하나도 내지 않았습니다. 조회문 · 접속 정보를 확인하세요");
		}
		Ok(rows)
	});
	let mut idx = read_index(&dir);
	idx.checked_at = now_ms();
	let rows = match res {
		Ok(r) => r,
		Err(e) => {
			idx.error = e.to_string();
			write_index(&dir, &idx)?;
			return Err(e);
		}
	};
	idx.error.clear();
	let prev = idx.snapshots.last().cloned();
	let prev_rows = prev.as_ref().and_then(|p| rows_of(&dir, &p.id));
	if prev_rows.as_deref() == Some(rows.as_slice()) {
		write_index(&dir, &idx)?;
		return Ok(FetchResult { changed: false, first: false, rows: rows.len(), summary: "바뀐 것 없음".into(), snapshot: prev });
	}
	let d = prev_rows.as_ref().map(|old| diff(old, &rows, src.key_cols)).unwrap_or_default();
	let id = format!("{}", now_ms());
	let header = if src.columns.is_empty() {
		let width = rows.iter().map(|r| cells(r).len()).max().unwrap_or(0);
		(0..width).map(|i| col_name(&[], i)).collect::<Vec<_>>().join("\t")
	} else {
		src.columns.join("\t")
	};
	std::fs::create_dir_all(&dir)?;
	std::fs::write(snap_path(&dir, &id), format!("{header}\n{}\n", rows.join("\n")))?;
	let meta = SnapMeta { id: id.clone(), at: now_ms(), rows: rows.len(), added: d.added.len(), removed: d.removed.len(), changed: d.changed.len() };
	idx.snapshots.push(meta.clone());
	while idx.snapshots.len() > SNAP_MAX {
		let old = idx.snapshots.remove(0);
		let _ = std::fs::remove_file(snap_path(&dir, &old.id));
	}
	write_index(&dir, &idx)?;
	let first = prev_rows.is_none();
	Ok(FetchResult { changed: !first, first, rows: rows.len(), summary: if first { "처음 받음 · 비교의 바탕".into() } else { d.summary() }, snapshot: Some(meta) })
}

/* ---------- 반영 대기 ---------- */

/// (자료 폴더, 바탕, 최신) → 요약. 목록을 읽을 때마다 큰 표를 견주지 않게 한다. 스냅숏은 바뀌지 않으므로 지우지 않아도 맞다.
static SUMMARY: LazyLock<Mutex<HashMap<(PathBuf, String, String), String>>> = LazyLock::new(Default::default);

fn cached_summary(dir: &Path, base: &str, latest: &str, key_cols: usize) -> Option<String> {
	let key = (dir.to_path_buf(), base.to_string(), latest.to_string());
	if let Some(s) = SUMMARY.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
		return Some(s.clone());
	}
	let d = diff(&rows_of(dir, base)?, &rows_of(dir, latest)?, key_cols);
	let s = if d.is_empty() { String::new() } else { d.summary() };
	SUMMARY.lock().unwrap_or_else(|e| e.into_inner()).insert(key, s.clone());
	Some(s)
}

/// 이 산출물에 아직 반영되지 않은 DB 변경. 이슈의 반영 대기와 같은 규칙이다.
/// - 최신 스냅숏에 대한 기록이 있으면 그 기록이 반영이 끝났는지로 정한다.
/// - 더 앞 스냅숏에서 반영하지 못한 기록(실패 · 작성 중 · 버린 판)이 마지막이면 대기다.
/// - 기록이 없거나 반영을 마쳤으면, 최신 스냅숏이 최신 판보다 뒤에 받은 것일 때만 대기다 — 손으로 쓴 판은 그때의 구조를 읽고 썼다.
///
/// 바탕은 반영을 마친 마지막 스냅숏, 없으면 최신 판 때의 스냅숏, 그것도 없으면 처음 받은 스냅숏이다.
pub fn pending_for(dir: &Path, d: &Deliverable, src: &DbSource) -> Option<PendingIssue> {
	let idx = read_index(dir);
	let latest = idx.snapshots.last()?;
	let since = d.versions.iter().map(|v| v.added_at).max().unwrap_or(0);
	let tag = format!("{TRIGGER_DB}{}", src.id);
	let last = d.auto_log.iter().rev().find(|e| e.source == tag);
	let waiting = match last {
		Some(e) if e.snapshot == latest.id => !e.settled(),
		Some(e) if !e.settled() => true,
		_ => latest.at > since,
	};
	if !waiting {
		return None;
	}
	let has = |id: &str| idx.snapshots.iter().any(|s| s.id == id);
	let settled_base = d.auto_log.iter().rev().find(|e| e.source == tag && e.settled() && has(&e.snapshot)).map(|e| e.snapshot.clone());
	let base = settled_base
		.or_else(|| idx.snapshots.iter().rev().find(|s| s.at <= since).map(|s| s.id.clone()))
		.unwrap_or_else(|| idx.snapshots[0].id.clone());
	if base == latest.id {
		return None;
	}
	let summary = cached_summary(dir, &base, &latest.id, src.key_cols)?;
	if summary.is_empty() {
		return None;
	}
	Some(PendingIssue {
		id: tag,
		kind: "db".into(),
		number: 0,
		title: src.name.clone(),
		done_at: latest.at,
		snapshot: latest.id.clone(),
		base,
		summary,
	})
}

/// 반영 대기 한 줄의 변경 글.
pub fn pending_brief(dir: &Path, src: &DbSource, p: &PendingIssue) -> Option<String> {
	let idx = read_index(dir);
	let base = idx.snapshots.iter().find(|s| s.id == p.base)?;
	let latest = idx.snapshots.iter().find(|s| s.id == p.snapshot)?;
	let d = diff(&rows_of(dir, &base.id)?, &rows_of(dir, &latest.id)?, src.key_cols);
	Some(brief(src, &d, base, latest, &snap_path(dir, &latest.id)))
}

/// 두 스냅숏의 변경 글. 화면의 「비교」가 쓴다.
pub fn compare(store: &Store, pid: &str, sid: &str, from: &str, to: &str) -> Result<String> {
	let p = store.project(pid)?;
	let src = p.db_sources.iter().find(|s| s.id == sid).ok_or_else(|| Error::Msg("DB 자료를 찾을 수 없습니다".into()))?;
	let dir = source_dir(store, pid, sid);
	let idx = read_index(&dir);
	let a = idx.snapshots.iter().find(|s| s.id == from).ok_or_else(|| Error::Msg("그 스냅숏이 없습니다".into()))?;
	let b = idx.snapshots.iter().find(|s| s.id == to).ok_or_else(|| Error::Msg("그 스냅숏이 없습니다".into()))?;
	let (ra, rb) = (rows_of(&dir, &a.id).unwrap_or_default(), rows_of(&dir, &b.id).unwrap_or_default());
	Ok(brief(src, &diff(&ra, &rb, src.key_cols), a, b, &snap_path(&dir, &b.id)))
}

/* ---------- 화면에 보내는 모양 ---------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbSourceView {
	#[serde(flatten)]
	pub source: DbSource,
	pub dir: String,
	pub checked_at: i64,
	pub error: String,
	/// 최근 것이 앞이다
	pub snapshots: Vec<SnapMeta>,
	pub busy: bool,
	/// 이 자료를 트리거로 고른 산출물 제목
	pub used_by: Vec<String>,
}

pub fn views(store: &Store, pid: &str) -> Result<Vec<DbSourceView>> {
	let p = store.project(pid)?;
	let list = store.list_deliverables(pid).unwrap_or_default();
	let busy = BUSY.lock().unwrap_or_else(|e| e.into_inner()).clone();
	Ok(p.db_sources
		.iter()
		.map(|s| {
			let dir = source_dir(store, pid, &s.id);
			let idx = read_index(&dir);
			let tag = format!("{TRIGGER_DB}{}", s.id);
			DbSourceView {
				source: s.clone(),
				dir: dir.to_string_lossy().to_string(),
				checked_at: idx.checked_at,
				error: idx.error,
				snapshots: idx.snapshots.into_iter().rev().collect(),
				busy: busy.contains(&format!("{pid}/{}", s.id)),
				used_by: list.iter().filter(|v| v.deliverable.triggers.contains(&tag)).map(|v| v.deliverable.title.clone()).collect(),
			}
		})
		.collect())
}

/// 저장할 목록을 다듬는다. 새 자료에는 id 를 붙이고, 이름 · 명령이 빈 것은 받지 않는다.
pub fn clean(list: &[DbSource]) -> Result<Vec<DbSource>> {
	let mut out: Vec<DbSource> = Vec::new();
	for s in list {
		let name = s.name.trim();
		if name.is_empty() {
			return msg("DB 자료 이름을 적어 주세요");
		}
		if s.command.trim().is_empty() {
			return msg(format!("「{name}」의 조회 명령을 적어 주세요"));
		}
		let cwd = s.cwd.trim();
		if !cwd.is_empty() && !Path::new(cwd).is_dir() {
			return msg(format!("「{name}」의 실행 폴더가 없습니다: {cwd}"));
		}
		let mut columns: Vec<String> = s.columns.iter().map(|c| c.trim().to_string()).collect();
		while columns.last().is_some_and(|c| c.is_empty()) {
			columns.pop();
		}
		out.push(DbSource {
			id: if s.id.trim().is_empty() { short_id() } else { s.id.trim().to_string() },
			name: name.to_string(),
			command: s.command.trim().to_string(),
			cwd: cwd.to_string(),
			columns,
			key_cols: s.key_cols.clamp(1, 20),
			timeout_sec: s.timeout_sec.clamp(5, 600),
		});
	}
	Ok(out)
}

/* ---------- 받은 뒤 ---------- */

/// 산출물 트리거가 쓰는 자료만 받는다. 앱을 켤 때 · 이슈를 완료할 때 부른다.
/// 바뀐 자료의 id 를 돌려준다. 실패는 자료의 index.json 에 남고 여기서는 건너뛴다.
pub async fn fetch_used(app: &AppHandle, pid: &str) -> Vec<String> {
	let store = app.state::<Store>();
	let Ok(p) = store.project(pid) else { return Vec::new() };
	let list = store.list_deliverables(pid).unwrap_or_default();
	let used: HashSet<String> = list.iter().flat_map(|v| v.deliverable.db_triggers().into_iter().map(str::to_string).collect::<Vec<_>>()).collect();
	let mut changed = Vec::new();
	for s in p.db_sources.iter().filter(|s| used.contains(&s.id)) {
		match fetch(app, pid, &s.id).await {
			Ok(r) if r.changed => changed.push(s.id.clone()),
			Ok(_) => {}
			Err(e) => eprintln!("DB 자료 「{}」를 받지 못함: {e}", s.name),
		}
	}
	changed
}

/// 앱을 켤 때 한 번 받는다. 보관한 프로젝트는 건너뛴다. 바뀐 것이 있으면 그 산출물을 판정한다.
pub fn spawn_startup(app: AppHandle) {
	tauri::async_runtime::spawn(async move {
		// 창이 뜨고 나서 돌게 조금 기다린다.
		tokio::time::sleep(Duration::from_secs(20)).await;
		let projects = app.state::<Store>().projects().unwrap_or_default();
		for p in projects.iter().filter(|p| p.archived_at == 0 && !p.db_sources.is_empty()) {
			let changed = fetch_used(&app, &p.id).await;
			emit_project(&app, &p.id);
			if !changed.is_empty() {
				crate::kb::after_db_change(app.clone(), p.id.clone()).await;
			}
		}
	});
}

/// DB 트리거를 건 산출물의 반영 대기가 바뀌었을 수 있다. 화면에 다시 보낸다.
pub fn emit_project(app: &AppHandle, pid: &str) {
	let store = app.state::<Store>();
	for v in store.list_deliverables(pid).unwrap_or_default().iter().filter(|v| !v.deliverable.db_triggers().is_empty()) {
		crate::runner::emit_deliverable(app, v);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn rows(s: &[&str]) -> Vec<String> {
		s.iter().map(|x| x.to_string()).collect()
	}

	#[test]
	fn normalize_sorts_and_drops_noise() {
		let out = normalize("b\t2  \r\n\r\na\t1\n(2 rows)\n");
		assert_eq!(out, ["a\t1", "b\t2"]);
		// 같은 구조를 순서만 바꿔 받아도 같다.
		assert_eq!(normalize("a\t1\nb\t2"), normalize("b\t2\na\t1"));
	}

	#[test]
	fn diff_by_key_columns() {
		let old = rows(&["public\tuser\tid\tint4\t", "public\tuser\tname\tvarchar\t이름", "public\tuser\told\ttext\t"]);
		let new = rows(&["public\tuser\tid\tint4\t", "public\tuser\tname\tvarchar\t사용자 이름", "public\tuser\temail\ttext\t"]);
		let d = diff(&old, &new, 3);
		assert_eq!(d.added, ["public\tuser\temail\ttext\t"]);
		assert_eq!(d.removed, ["public\tuser\told\ttext\t"]);
		assert_eq!(d.changed.len(), 1);
		assert_eq!(d.changed[0].0, "public.user.name");
		assert_eq!(d.changed[0].1, vec![(4, "이름".to_string(), "사용자 이름".to_string())]);
		assert_eq!(d.summary(), "추가 1 · 삭제 1 · 바뀜 1");
		assert!(diff(&old, &old, 3).is_empty());
	}

	#[test]
	fn duplicate_keys_count_apart() {
		let d = diff(&rows(&["a\tx", "a\ty"]), &rows(&["a\tx"]), 1);
		assert_eq!(d.removed.len() + d.changed.len(), 1);
	}

	#[test]
	fn scrub_hides_passwords() {
		assert_eq!(scrub("set PGPASSWORD=s3cret& psql"), "set PGPASSWORD=***& psql");
		assert_eq!(scrub("host=db password=abc user=x"), "host=db password=*** user=x");
		assert_eq!(scrub("postgresql://reader:pa:ss@db:5432/app"), "postgresql://reader:***@db:5432/app");
		assert_eq!(scrub("FATAL: 사용자 인증 실패"), "FATAL: 사용자 인증 실패");
	}

	/// cmd 로 돌려 UTF-8 한글 출력을 그대로 받고, 실패 코드는 오류로 받는다.
	#[cfg(windows)]
	#[tokio::test]
	async fn run_command_reads_utf8_and_fails_on_exit_code() {
		let dir = std::env::temp_dir().join(format!("docket-dbcmd-{}", short_id()));
		std::fs::create_dir_all(&dir).unwrap();
		std::fs::write(dir.join("out.tsv"), "public\t사용자\t이름\n").unwrap();
		let ok = DbSource { command: "type out.tsv".into(), ..Default::default() };
		assert_eq!(normalize(&run_command(&ok, &dir).await.unwrap()), ["public\t사용자\t이름"]);
		let bad = DbSource { command: "echo PGPASSWORD=secret 1>&2 & exit /b 3".into(), ..Default::default() };
		let e = run_command(&bad, &dir).await.unwrap_err().to_string();
		assert!(e.contains("종료 코드 3") && !e.contains("secret"), "{e}");
		let _ = std::fs::remove_dir_all(dir);
	}

	fn snap(dir: &Path, id: &str, at: i64, body: &[&str], idx: &mut DbIndex) {
		std::fs::write(snap_path(dir, id), format!("h\n{}\n", body.join("\n"))).unwrap();
		idx.snapshots.push(SnapMeta { id: id.into(), at, ..Default::default() });
	}

	/// 판 뒤에 바뀐 구조만 대기이고, 반영을 마친 기록이 있으면 빠지며, 반영하지 못한 기록은 남는다.
	#[test]
	fn pending_follows_versions_and_log() {
		let dir = std::env::temp_dir().join(format!("docket-db-{}", short_id()));
		std::fs::create_dir_all(&dir).unwrap();
		let mut idx = DbIndex::default();
		snap(&dir, "1", 50, &["a\tx"], &mut idx);
		write_index(&dir, &idx).unwrap();
		let src = DbSource { id: "s".into(), name: "운영".into(), key_cols: 1, ..Default::default() };
		let mut d = Deliverable { triggers: vec!["db:s".into()], versions: vec![Version { n: 1, added_at: 100, ..Default::default() }], ..Default::default() };
		assert!(pending_for(&dir, &d, &src).is_none(), "처음 받은 것뿐인데 대기가 생겼다");

		snap(&dir, "2", 150, &["a\ty", "b\tz"], &mut idx);
		write_index(&dir, &idx).unwrap();
		let p = pending_for(&dir, &d, &src).expect("판 뒤에 바뀐 구조가 대기에 없다");
		assert_eq!((p.base.as_str(), p.snapshot.as_str(), p.summary.as_str()), ("1", "2", "추가 1 · 바뀜 1"));
		assert!(pending_brief(&dir, &src, &p).unwrap().contains("a — 칸 2: x → y"));

		d.auto_log.push(AutoEntry { source: "db:s".into(), snapshot: "2".into(), verdict: "failed".into(), ..Default::default() });
		assert!(pending_for(&dir, &d, &src).is_some(), "반영하지 못한 변경이 빠졌다");
		d.auto_log.push(AutoEntry { source: "db:s".into(), snapshot: "2".into(), verdict: "updated".into(), ..Default::default() });
		assert!(pending_for(&dir, &d, &src).is_none(), "반영한 변경이 남았다");

		// 반영을 마친 스냅숏이 다음 비교의 바탕이 된다.
		snap(&dir, "3", 300, &["a\ty", "b\tz", "c\tw"], &mut idx);
		write_index(&dir, &idx).unwrap();
		let p = pending_for(&dir, &d, &src).unwrap();
		assert_eq!((p.base.as_str(), p.summary.as_str()), ("2", "추가 1"));
		// 손으로 쓴 판이 더 뒤면 대기가 아니다.
		d.versions.push(Version { n: 2, added_at: 400, ..Default::default() });
		assert!(pending_for(&dir, &d, &src).is_none());
		let _ = std::fs::remove_dir_all(dir);
	}
}
