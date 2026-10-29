//! 플러그인 설치 · 지우기. zip 이나 plugin.json(이 든 폴더)을 골라 plugins/<id>/ 에 넣는다.
//!
//! - 꾸러미에서 plugin.json 과 main 의 파일 둘만 꺼낸다. node_modules · 소스처럼 돌 때 쓰지 않는 것을 앱 데이터에 쌓지 않는다.
//! - zip 의 항목은 `enclosed_name` 으로만 읽는다. `..` · 절대 경로 항목으로 폴더 밖에 쓰는 것(zip slip)을 막는다.
//! - 같은 id 가 이미 있으면 휴지통으로 옮긴 뒤 넣는다. 잘못 덮어도 꺼낼 수 있다.
//! - 설치는 사용자가 권한 목록을 보고 고른 것이라, 매니페스트의 권한을 허락한 것으로 남기고 켠다.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::manifest::{self, Manifest};
use super::{MANIFEST, data_dir, dir, find, load, terminal, wasm};
use crate::error::{Error, Result, msg};
use crate::model::Settings;
use crate::store::Store;

/// 꾸러미 안 파일 하나의 상한. wasm 이 이보다 크면 잘못 고른 파일로 본다.
const FILE_LIMIT: u64 = 64 << 20;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspect {
	pub manifest: Manifest,
	/// 있으면 설치하지 않는다
	pub problem: String,
	/// 같은 id 로 이미 있는 것의 판. 옛 정의면 「옛 정의」, 없으면 비어 있다.
	pub installed: String,
	pub source: String,
}

enum Source {
	Dir(PathBuf),
	Zip { path: PathBuf, prefix: PathBuf },
}

fn open_zip(path: &Path) -> Result<zip::ZipArchive<fs::File>> {
	zip::ZipArchive::new(fs::File::open(path)?).map_err(|e| Error::Msg(format!("zip 을 열지 못했습니다: {e}")))
}

fn source(path: &Path) -> Result<Source> {
	if path.is_dir() {
		return Ok(Source::Dir(path.to_path_buf()));
	}
	let name = path.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
	if name == MANIFEST {
		return Ok(Source::Dir(path.parent().unwrap_or(Path::new(".")).to_path_buf()));
	}
	if !name.ends_with(".zip") {
		return msg("플러그인은 zip 이나 plugin.json 을 고릅니다");
	}
	// plugin.json 이 맨 위나 한 단계 아래 폴더(`open-in-code/plugin.json`)에 있는 꾸러미를 받는다. 압축 도구마다 감싸는 폴더가 다르다.
	let mut z = open_zip(path)?;
	let mut found: Option<PathBuf> = None;
	for i in 0..z.len() {
		let Ok(f) = z.by_index(i) else { continue };
		let Some(p) = f.enclosed_name() else { continue };
		if p.file_name().is_some_and(|n| n == MANIFEST) && p.components().count() <= 2 && found.as_ref().is_none_or(|q| p.components().count() < q.components().count()) {
			found = Some(p);
		}
	}
	let Some(m) = found else { return msg("zip 에 plugin.json 이 없습니다") };
	Ok(Source::Zip { path: path.to_path_buf(), prefix: m.parent().map(Path::to_path_buf).unwrap_or_default() })
}

/// 꾸러미 안의 파일 하나를 읽는다. 없으면 None.
fn read(src: &Source, name: &str) -> Result<Option<Vec<u8>>> {
	match src {
		Source::Dir(d) => {
			let p = d.join(name);
			if !p.is_file() {
				return Ok(None);
			}
			if fs::metadata(&p)?.len() > FILE_LIMIT {
				return msg(format!("{name} 이 64MB 를 넘습니다"));
			}
			Ok(Some(fs::read(p)?))
		}
		Source::Zip { path, prefix } => {
			let want = prefix.join(name);
			let mut z = open_zip(path)?;
			for i in 0..z.len() {
				let Ok(mut f) = z.by_index(i) else { continue };
				if f.enclosed_name().as_deref() != Some(want.as_path()) {
					continue;
				}
				if f.size() > FILE_LIMIT {
					return msg(format!("{name} 이 64MB 를 넘습니다"));
				}
				let mut b = Vec::new();
				f.by_ref().take(FILE_LIMIT + 1).read_to_end(&mut b)?;
				return Ok(Some(b));
			}
			Ok(None)
		}
	}
}

fn fallback_id(src: &Source) -> String {
	let p = match src {
		Source::Dir(d) => d.clone(),
		Source::Zip { path, prefix } => if prefix.as_os_str().is_empty() { path.with_extension("") } else { prefix.clone() },
	};
	p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

/// 설치하기 전에 매니페스트 · 문제 · 이미 있는 판을 본다. 화면이 권한 목록을 보이고 허락을 받는다.
pub fn inspect(store: &Store, s: &Settings, path: &Path) -> Result<Inspect> {
	let src = source(path)?;
	let bytes = read(&src, MANIFEST)?.ok_or_else(|| Error::Msg("plugin.json 이 없습니다".into()))?;
	let mut m: Manifest = serde_json::from_slice(&bytes).map_err(|e| Error::Msg(format!("plugin.json 을 읽지 못했습니다: {e}")))?;
	if m.id.trim().is_empty() {
		m.id = fallback_id(&src);
	}
	if m.name.trim().is_empty() {
		m.name = m.id.clone();
	}
	let has_main = !m.main.is_empty() && manifest::plain_file_name(&m.main) && read(&src, &m.main)?.is_some();
	let exe_found = m.contributes.terminal.as_ref().is_some_and(|t| terminal::resolve_exe(&t.exe).is_some());
	let problem = manifest::check(&m, has_main, exe_found, &mut HashSet::new());
	let installed = load(&store.root, s).into_iter().find(|v| v.manifest.id == m.id).map(|v| if v.legacy { "옛 정의".to_string() } else { v.manifest.version }).unwrap_or_default();
	Ok(Inspect { manifest: m, problem, installed, source: path.to_string_lossy().to_string() })
}

/// 꾸러미를 plugins/<id>/ 에 넣고 권한을 허락해 켠다.
pub fn install(store: &Store, path: &Path) -> Result<Settings> {
	let mut s = store.settings()?;
	let insp = inspect(store, &s, path)?;
	if !insp.problem.is_empty() {
		return msg(format!("설치할 수 없습니다: {}", insp.problem));
	}
	let m = insp.manifest;
	let src = source(path)?;
	// 이름이 점으로 시작하는 폴더는 목록이 읽지 않는다(mod.rs load). 다 쓰기 전의 반쪽 플러그인이 보이지 않게.
	let staging = dir(&store.root).join(format!(".installing-{}", m.id));
	let _ = fs::remove_dir_all(&staging);
	fs::create_dir_all(&staging)?;
	fs::write(staging.join(MANIFEST), serde_json::to_vec_pretty(&m)?)?;
	if !m.main.is_empty() {
		let wasm = read(&src, &m.main)?.ok_or_else(|| Error::Msg(format!("main 의 파일이 없습니다: {}", m.main)))?;
		fs::write(staging.join(&m.main), wasm)?;
	}
	if let Ok(old) = find(&store.root, &s, &m.id) {
		let target = if old.legacy { PathBuf::from(&old.file) } else { PathBuf::from(&old.dir) };
		store.trash(&target, &format!("플러그인-{}", m.id))?;
	}
	let dest = dir(&store.root).join(&m.id);
	if dest.exists() {
		store.trash(&dest, &format!("플러그인-{}", m.id))?;
	}
	fs::rename(&staging, &dest)?;
	wasm::forget(&m.id);
	s.plugin_grants.insert(m.id.clone(), m.permissions.clone());
	if !s.enabled_plugins.contains(&m.id) {
		s.enabled_plugins.push(m.id.clone());
	}
	store.save_settings(&s)
}

/// 플러그인과 그 데이터(설정 칸 값 · 저장소 · 기록)를 휴지통으로 옮기고, 켜기 · 허락을 지운다.
pub fn uninstall(store: &Store, id: &str) -> Result<Settings> {
	let mut s = store.settings()?;
	let v = find(&store.root, &s, id)?;
	let target = if v.legacy { PathBuf::from(&v.file) } else { PathBuf::from(&v.dir) };
	store.trash(&target, &format!("플러그인-{id}"))?;
	let data = data_dir(&store.root, id);
	if data.exists() {
		store.trash(&data, &format!("플러그인-{id}-데이터"))?;
	}
	wasm::forget(id);
	s.plugin_grants.remove(id);
	s.enabled_plugins.retain(|x| x != id);
	store.save_settings(&s)
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::Write;

	fn zip_with(entries: &[(&str, &[u8])]) -> PathBuf {
		let path = std::env::temp_dir().join(format!("docket-plugin-{}.zip", crate::model::short_id()));
		let mut w = zip::ZipWriter::new(fs::File::create(&path).unwrap());
		for (name, body) in entries {
			w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
			w.write_all(body).unwrap();
		}
		w.finish().unwrap();
		path
	}

	const MENU: &[u8] = br#"{ "id": "m", "apiVersion": 1, "main": "plugin.wasm", "contributes": { "menus": [{ "where": "issue", "command": "x", "label": "x" }] } }"#;

	#[test]
	fn zip_source_finds_manifest_one_level_down() {
		let z = zip_with(&[("m/plugin.json", MENU), ("m/plugin.wasm", b"\0asm"), ("m/src/index.ts", b"")]);
		let src = source(&z).unwrap();
		assert!(read(&src, MANIFEST).unwrap().is_some());
		assert_eq!(read(&src, "plugin.wasm").unwrap().unwrap(), b"\0asm");
		assert!(read(&src, "nope.wasm").unwrap().is_none());
		fs::remove_file(z).unwrap();
	}

	#[test]
	fn zip_slip_entries_are_not_read() {
		// main 이 꾸러미 밖을 가리키면 검사에서 막고, 항목 이름이 밖을 가리키면 읽지 않는다.
		let z = zip_with(&[("plugin.json", MENU), ("../plugin.wasm", b"\0asm")]);
		let src = source(&z).unwrap();
		assert!(read(&src, "plugin.wasm").unwrap().is_none());
		assert!(!manifest::plain_file_name("../plugin.wasm"));
		assert!(!manifest::plain_file_name(r"C:\x\plugin.wasm"));
		fs::remove_file(z).unwrap();
	}

	#[test]
	fn zip_without_manifest_is_refused() {
		let z = zip_with(&[("a/b/plugin.json", MENU)]);
		assert!(source(&z).is_err(), "두 단계 아래는 찾지 않는다");
		fs::remove_file(z).unwrap();
	}
}
