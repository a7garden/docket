//! 산출물 표지. 책장에 보일 최신 판의 첫 쪽을 파일 형식에 따라 고른다.
//!
//! 목차
//! 1. Thumb · deliverable_thumb — 그림 파일 · 글 앞부분 · 만들어 둔 표지 가운데 하나를 돌려준다
//! 2. embedded — 오피스 · 한글 파일에 든 미리 보기를 꺼낸다
//! 3. render — 플러그인의 render.py 로 첫 쪽을 그린다
//!
//! 표지는 앱 데이터의 deliverables/<id>/thumbs/ 에 둔다. 사용자의 산출물 폴더를 더럽히지 않고, 이 폴더는 처음부터 asset 범위 안이다.
//! 이름에 판 번호 · 크기 · 수정 시각이 들어 있어 파일이 바뀌면 저절로 다시 만든다.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tokio::sync::Semaphore;

use crate::model::short_id;
use crate::runner;
use crate::store::Store;

const IMAGE: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
const TEXT: &[&str] = &["md", "markdown", "txt", "csv", "tsv", "log", "json", "yaml", "yml", "xml", "html", "sql"];
const PAGED: &[&str] = &["docx", "doc", "xlsx", "xls", "pptx", "ppt", "hwpx", "hwp", "pdf", "odt", "ods", "odp", "rtf"];
/// 글 표지에 그릴 앞부분(바이트). 표지 칸에 다 들어가고도 남는다.
const TEXT_HEAD: usize = 4096;
const EMBEDDED_MAX: u64 = 5 * 1024 * 1024;
/// LibreOffice 는 큰 엑셀에 오래 걸린다. 넘으면 대체 표지로 끝낸다.
const RENDER_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Thumb {
	Image { path: String },
	Text { text: String },
	None,
}

/// 그리기는 한 번에 하나만 돈다. 오피스 변환을 여럿 띄우면 PC 가 느려진다.
fn gate() -> &'static Semaphore {
	static GATE: OnceLock<Semaphore> = OnceLock::new();
	GATE.get_or_init(|| Semaphore::new(1))
}

/// 이번 실행에서 그리지 못한 표지. 화면을 열 때마다 다시 그리지 않게 하되, 파일에 남기지 않아 도구를 깔고 앱을 다시 켜면 다시 시도한다.
fn failed() -> &'static Mutex<HashSet<PathBuf>> {
	static FAILED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
	FAILED.get_or_init(Mutex::default)
}

fn ext_of(path: &Path) -> String {
	path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// 글 파일의 앞부분. 글자 중간에서 잘려도 온전한 글자까지만 쓴다. UTF-8 이 아니면 표지로 그리지 않는다.
fn text_head(path: &Path) -> Option<String> {
	let mut buf = Vec::with_capacity(TEXT_HEAD);
	fs::File::open(path).ok()?.take(TEXT_HEAD as u64).read_to_end(&mut buf).ok()?;
	match std::str::from_utf8(&buf) {
		Ok(s) => Some(s.to_string()),
		// 끝에서 잘린 글자(최대 3바이트)만 봐준다.
		Err(e) if e.error_len().is_none() => Some(String::from_utf8_lossy(&buf[..e.valid_up_to()]).into_owned()),
		Err(_) => None,
	}
}

/// 파일이 바뀌면 이름이 달라지는 표지 자리(확장자 없이).
fn cache_stem(dir: &Path, n: u32, file: &Path) -> Option<PathBuf> {
	let m = fs::metadata(file).ok()?;
	let at = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
	Some(dir.join(format!("v{n}-{}-{at}", m.len())))
}

fn cached(stem: &Path) -> Option<PathBuf> {
	["png", "jpg", "jpeg"].iter().map(|e| stem.with_extension(e)).find(|p| p.is_file())
}

/// 그 판의 지난 표지를 지운다. 파일을 고칠 때마다 쌓이지 않게.
fn drop_stale(dir: &Path, n: u32, keep: &Path) {
	let prefix = format!("v{n}-");
	let Ok(rd) = fs::read_dir(dir) else { return };
	for p in rd.filter_map(|e| e.ok()).map(|e| e.path()) {
		if p != keep && p.file_name().is_some_and(|f| f.to_string_lossy().starts_with(&prefix)) {
			let _ = fs::remove_file(p);
		}
	}
}

/// 오피스 · 한글 파일에 든 미리 보기를 꺼낸다. 돌려준 확장자로 저장한다.
fn embedded(file: &Path) -> Option<(Vec<u8>, &'static str)> {
	let mut zip = zip::ZipArchive::new(fs::File::open(file).ok()?).ok()?;
	for (name, ext) in [("docProps/thumbnail.jpeg", "jpg"), ("docProps/thumbnail.jpg", "jpg"), ("docProps/thumbnail.png", "png"), ("Preview/PrvImage.png", "png")] {
		let Ok(entry) = zip.by_name(name) else { continue };
		if entry.size() == 0 || entry.size() > EMBEDDED_MAX {
			continue;
		}
		let mut buf = Vec::new();
		if entry.take(EMBEDDED_MAX).read_to_end(&mut buf).is_ok() {
			return Some((buf, ext));
		}
	}
	None
}

/// render.py 로 첫 쪽을 그려 PNG 하나를 돌려준다. 한컴은 띄우지 않는다 — 띄울 때마다 접근 확인 창이 뜬다.
async fn render(app: &AppHandle, file: &Path) -> Option<Vec<u8>> {
	let script = runner::plugin_dir(app)?.join("scripts").join("render.py");
	let out = std::env::temp_dir().join(format!("docket-thumb-{}", short_id()));
	let mut png = None;
	for (exe, pre) in runner::python_candidates() {
		let run = runner::command(&exe)
			.args(&pre)
			.arg(&script)
			.arg(file)
			.arg(&out)
			.args(["--max-pages", "1", "--dpi", "60"])
			.env("DOCKET_HANCOM", "0")
			.env("PYTHONIOENCODING", "utf-8")
			.kill_on_drop(true)
			.output();
		let Ok(Ok(done)) = tokio::time::timeout(RENDER_TIMEOUT, run).await else { break };
		png = fs::read_dir(&out).ok().and_then(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).find(|p| ext_of(p) == "png")).and_then(|p| fs::read(p).ok());
		// 2 는 스크립트가 돌았지만 그릴 도구가 없다는 뜻이다. 다른 파이썬으로 다시 돌려 봐야 같다. 스토어 안내용 가짜 python 은 다른 코드로 끝난다.
		if png.is_some() || done.status.code() == Some(2) {
			break;
		}
		let _ = fs::remove_dir_all(&out);
	}
	let _ = fs::remove_dir_all(&out);
	png
}

/// 그 판의 표지. 만들 수 없으면 Thumb::None 이고, 화면은 형식 이름을 그린 대체 표지를 보인다.
pub async fn thumb(app: &AppHandle, pid: &str, did: &str, n: u32) -> crate::error::Result<Thumb> {
	let store = app.state::<Store>();
	let (file, source) = store.version_file(pid, did, n)?;
	let ext = ext_of(&file);
	if !file.is_file() {
		return Ok(Thumb::None);
	}
	if IMAGE.contains(&ext.as_str()) {
		return Ok(Thumb::Image { path: file.to_string_lossy().to_string() });
	}
	if TEXT.contains(&ext.as_str()) {
		return Ok(text_head(&file).map_or(Thumb::None, |text| Thumb::Text { text }));
	}
	if !PAGED.contains(&ext.as_str()) {
		return Ok(Thumb::None);
	}
	let dir = store.deliverable_dir(pid, did).join("thumbs");
	let Some(stem) = cache_stem(&dir, n, &file) else { return Ok(Thumb::None) };
	let image = |p: PathBuf| Thumb::Image { path: p.to_string_lossy().to_string() };
	if let Some(p) = cached(&stem) {
		return Ok(image(p));
	}
	let is_failed = || failed().lock().map(|f| f.contains(&stem)).unwrap_or(false);
	if is_failed() {
		return Ok(Thumb::None);
	}

	let Ok(_turn) = gate().acquire().await else { return Ok(Thumb::None) };
	// 기다리는 동안 같은 표지를 다른 호출이 만들었을 수 있다.
	if let Some(p) = cached(&stem) {
		return Ok(image(p));
	}
	if is_failed() {
		return Ok(Thumb::None);
	}
	// Claude 가 쓴 판의 미리 보기는 템플릿 그림이 그대로 남은 것일 수 있어 쓰지 않는다.
	let inner = if source == "claude" { None } else { embedded(&file) };
	let made = match inner {
		Some(found) => Some(found),
		None => render(app, &file).await.map(|b| (b, "png")),
	};
	let saved = made.and_then(|(bytes, ext)| {
		let path = stem.with_extension(ext);
		fs::create_dir_all(&dir).ok()?;
		fs::write(&path, bytes).ok()?;
		drop_stale(&dir, n, &path);
		Some(path)
	});
	Ok(match saved {
		Some(p) => image(p),
		None => {
			if let Ok(mut f) = failed().lock() {
				f.insert(stem);
			}
			Thumb::None
		}
	})
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::Write;

	fn temp(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("docket-thumb-test-{name}-{}", short_id()));
		fs::create_dir_all(&dir).unwrap();
		dir
	}

	/// 글자 중간에서 잘려도 온전한 글자까지 쓰고, 글이 아닌 파일은 표지로 그리지 않는다.
	#[test]
	fn text_head_cuts_on_char_boundary() {
		let dir = temp("text");
		let long = dir.join("긴.md");
		fs::write(&long, "가".repeat(TEXT_HEAD)).unwrap();
		let head = text_head(&long).unwrap();
		assert!(head.len() <= TEXT_HEAD && head.chars().all(|c| c == '가'));
		let bin = dir.join("b.txt");
		fs::write(&bin, [0xff, 0xfe, 0x00, 0x41]).unwrap();
		assert_eq!(text_head(&bin), None);
		let _ = fs::remove_dir_all(dir);
	}

	/// 한글 파일의 미리 보기를 꺼낸다. 없거나 zip 이 아니면 없다고 한다.
	#[test]
	fn embedded_finds_preview() {
		let dir = temp("zip");
		let path = dir.join("a.hwpx");
		let mut w = zip::ZipWriter::new(fs::File::create(&path).unwrap());
		w.start_file("Preview/PrvImage.png", zip::write::SimpleFileOptions::default()).unwrap();
		w.write_all(b"png").unwrap();
		w.finish().unwrap();
		assert_eq!(embedded(&path), Some((b"png".to_vec(), "png")));
		let plain = dir.join("b.docx");
		fs::write(&plain, "zip 아님").unwrap();
		assert_eq!(embedded(&plain), None);
		let _ = fs::remove_dir_all(dir);
	}

	/// 파일이 바뀌면 표지 이름이 달라지고, 지난 표지는 지워진다. 다른 판의 표지는 남는다.
	#[test]
	fn cache_follows_file() {
		let dir = temp("cache");
		let file = dir.join("a.pdf");
		fs::write(&file, "1").unwrap();
		let a = cache_stem(&dir, 2, &file).unwrap();
		fs::write(&file, "22").unwrap();
		let b = cache_stem(&dir, 2, &file).unwrap();
		assert_ne!(a, b);
		let (old, other, new) = (a.with_extension("png"), dir.join("v3-1-1.png"), b.with_extension("png"));
		for p in [&old, &other, &new] {
			fs::write(p, "x").unwrap();
		}
		drop_stale(&dir, 2, &new);
		assert!(!old.exists() && other.exists() && new.exists());
		assert_eq!(cached(&b), Some(new));
		let _ = fs::remove_dir_all(dir);
	}
}
