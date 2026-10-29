//! 플러그인: 앱 데이터의 plugins/ 에 둔 플러그인을 읽고, 켜진 것을 메뉴 · 사건 · 터미널 자리에서 부른다.
//!
//! ```text
//! plugins/<id>/plugin.json    매니페스트 (manifest.rs)
//! plugins/<id>/<main>.wasm    코드. Extism 샌드박스에서 돈다 (wasm.rs · 호스트 함수 api.rs)
//! plugins/<id>.json           옛 정의. 터미널 기여 하나짜리 플러그인으로 읽는다
//! plugins-data/<id>/          settings.json(설정 칸 값) · kv.json(storage) · log.jsonl(실패 · docket_log)
//! ```
//!
//! - 켜고 끄기는 settings.json 의 enabledPlugins, 허락한 권한은 pluginGrants 에 둔다. 매니페스트는 사용자 · 작성자가 쓴 것이라 앱이 고쳐 쓰지 않는다.
//! - 허락한 것보다 권한이 넓어진 플러그인은 켜져 있어도 부르지 않는다. 설치한 뒤 파일만 바꿔 권한을 몰래 늘리지 못하게 하려는 것이다.
//!   옛 정의는 이 구조 전에 사용자가 켜 둔 것이라 허락한 것으로 본다.
//! - 사건은 기다리지 않고 쏜다. 플러그인이 느리거나 실패해도 이슈 흐름은 멈추지 않고, 실패는 그 플러그인의 log.jsonl 에만 남는다.
//!   이슈 이력에 쓰면 updated_at 이 올라 보드 순서가 바뀌고, 알림으로 띄우면 사건마다 실패할 때 알림이 쏟아진다.
//!
//! 구획: 정의 · 읽기 · 고르기 · 틀 · 설정 칸 · 기록 · 부르기 · 시험

pub mod api;
pub mod install;
pub mod manifest;
pub mod terminal;
mod wasm;

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result, msg};
use crate::model::{Settings, now_ms};
use crate::store::Store;
use api::{Reply, Target};
use manifest::Manifest;
use terminal::Terminal;

pub const MANIFEST: &str = "plugin.json";

pub fn dir(root: &Path) -> PathBuf {
	root.join("plugins")
}

pub fn data_dir(root: &Path, id: &str) -> PathBuf {
	root.join("plugins-data").join(id)
}

/* ---------- 정의 ---------- */

/// 화면에 보내는 플러그인 한 건. 읽지 못한 것도 문제와 함께 싣는다. 하나가 깨졌다고 목록 전체가 사라지면 안 된다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
	#[serde(flatten)]
	pub manifest: Manifest,
	/// plugin.json 또는 옛 정의 파일
	pub file: String,
	/// 플러그인 폴더. 옛 정의는 비어 있다.
	pub dir: String,
	pub legacy: bool,
	pub enabled: bool,
	/// 찾은 터미널 실행 파일. 못 찾았거나 터미널이 없으면 비어 있다.
	pub exe_path: String,
	/// 매니페스트에 있으나 아직 허락하지 않은 권한. 비어야 부른다.
	pub missing: Vec<String>,
	/// 이것이 있으면 쓰지 않는다
	pub problem: String,
	/// 쓸 수는 있으나 알아 둘 것
	pub warning: String,
	/// 최근 7일 동안 실패한 사건 · 메뉴 수
	pub failures: u32,
	pub log: String,
}

impl PluginView {
	/// 켜져 있고, 문제가 없고, 권한을 다 허락했는지
	pub fn usable(&self) -> bool {
		self.enabled && self.problem.is_empty() && self.missing.is_empty()
	}

	fn main_path(&self) -> PathBuf {
		Path::new(&self.dir).join(&self.manifest.main)
	}
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginList {
	pub dir: String,
	pub plugins: Vec<PluginView>,
}

/* ---------- 읽기 ---------- */

/// 폴더 · 파일 이름 순으로 읽는다. 켜진 터미널 플러그인이 둘이면 앞의 것을 쓰므로 순서가 정해져 있어야 한다.
pub fn load(root: &Path, s: &Settings) -> Vec<PluginView> {
	let Ok(rd) = fs::read_dir(dir(root)) else { return Vec::new() };
	let mut entries: Vec<PathBuf> = rd
		.flatten()
		.map(|e| e.path())
		.filter(|p| !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')))
		.filter(|p| (p.is_dir() && p.join(MANIFEST).is_file()) || (p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("json"))))
		.collect();
	entries.sort();
	let mut seen = HashSet::new();
	entries.iter().map(|p| view(root, p, s, &mut seen)).collect()
}

fn view(root: &Path, path: &Path, s: &Settings, seen: &mut HashSet<String>) -> PluginView {
	let legacy = path.is_file();
	let stem = path.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
	let file = if legacy { path.to_path_buf() } else { path.join(MANIFEST) };
	let parsed = fs::read(&file).map_err(|e| e.to_string()).and_then(|b| {
		if legacy { manifest::from_legacy(&b) } else { serde_json::from_slice::<Manifest>(&b).map(|m| (m, String::new())).map_err(|e| e.to_string()) }
	});
	let (mut m, mut problem) = match parsed {
		Ok(x) => x,
		// 읽지 못한 옛 정의는 터미널로 쓰려던 것으로 본다. 켜 두었다면 「터미널에서 잇기」가 조용히 Windows 터미널로 넘어가지 않고 문제를 알린다.
		Err(e) => (
			Manifest { contributes: manifest::Contributes { terminal: legacy.then(Terminal::default), ..Default::default() }, ..Default::default() },
			format!("정의를 읽지 못했습니다: {e}"),
		),
	};
	if m.id.trim().is_empty() {
		m.id = stem;
	}
	if m.name.trim().is_empty() {
		m.name = m.id.clone();
	}
	let exe_path = m.contributes.terminal.as_ref().and_then(|t| terminal::resolve_exe(&t.exe));
	let has_main = !legacy && !m.main.is_empty() && path.join(&m.main).is_file();
	if problem.is_empty() {
		problem = manifest::check(&m, has_main, exe_path.is_some(), seen);
	}
	let warning = match &m.contributes.terminal {
		Some(t) if problem.is_empty() => terminal::warning(t),
		_ => String::new(),
	};
	let granted = s.plugin_grants.get(&m.id).cloned().unwrap_or_default();
	let missing = if legacy { Vec::new() } else { m.permissions.iter().filter(|p| !granted.contains(p)).cloned().collect() };
	let data = data_dir(root, &m.id);
	PluginView {
		enabled: s.enabled_plugins.contains(&m.id),
		file: file.to_string_lossy().to_string(),
		dir: if legacy { String::new() } else { path.to_string_lossy().to_string() },
		legacy,
		exe_path: exe_path.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
		missing,
		problem,
		warning,
		failures: failures(&data),
		log: data.join("log.jsonl").to_string_lossy().to_string(),
		manifest: m,
	}
}

pub fn find(root: &Path, s: &Settings, id: &str) -> Result<PluginView> {
	load(root, s).into_iter().find(|v| v.manifest.id == id).ok_or_else(|| Error::Msg(format!("플러그인이 없습니다: {id}")))
}

/* ---------- 고르기 ---------- */

/// 「터미널에서 잇기」에 쓸 플러그인: 켜진 것 중 폴더 · 파일 이름 순으로 첫 터미널 기여. 이름 · 정의 · 실행 파일을 돌려준다.
/// 켜 둔 것에 문제가 있으면 오류를 낸다. 조용히 Windows 터미널로 넘어가면 사용자가 켜 둔 연동이 빠진 것을 알아채지 못한다.
pub fn terminal(root: &Path, s: &Settings) -> Result<Option<(String, Terminal, PathBuf)>> {
	let Some(v) = load(root, s).into_iter().find(|v| v.enabled && v.manifest.contributes.terminal.is_some()) else {
		return Ok(None);
	};
	let name = v.manifest.name.clone();
	if !v.problem.is_empty() {
		return msg(format!("「{name}」 플러그인을 쓸 수 없습니다: {} · 설정 › 플러그인에서 확인하세요", v.problem));
	}
	if !v.missing.is_empty() {
		return msg(format!("「{name}」 플러그인의 권한을 다시 허락해야 합니다: {} · 설정 › 플러그인에서 허락하세요", v.missing.join(" · ")));
	}
	let t = v.manifest.contributes.terminal.unwrap_or_default();
	Ok(Some((name, t, PathBuf::from(v.exe_path))))
}

/* ---------- 틀 ---------- */

const HERDR_NOTE: &str = "켜 둔 herdr 에 이슈마다 새 탭 「#번호 제목」을 만들어 claude --resume 으로 세션을 잇습니다. 그 세션이 이미 떠 있으면 그 탭으로 옮깁니다. herdr 가 꺼져 있으면 Windows 터미널에 띄운 뒤 붙입니다. claude 는 herdr 가 PATH 에서 찾습니다.";

/// 틀을 plugins/<id>/plugin.json 으로 쓴다. 이미 있으면 덮지 않는다. 사용자가 고쳐 둔 인자를 지우지 않으려는 것이다.
/// 다만 인자를 하나도 채우지 않은 옛 정의(plugins/<id>.json)는 인자를 채우기 전에 만든 빈 틀이라 휴지통으로 옮기고 새 틀을 쓴다.
pub fn create_preset(store: &Store, id: &str) -> Result<PathBuf> {
	let m = match id {
		"herdr" => Manifest {
			id: "herdr".into(),
			name: "herdr".into(),
			version: "1.0.0".into(),
			api_version: manifest::API_VERSION,
			description: HERDR_NOTE.into(),
			permissions: vec!["process:herdr".into()],
			contributes: manifest::Contributes { terminal: Some(terminal::herdr()), ..Default::default() },
			..Default::default()
		},
		_ => return msg(format!("모르는 틀입니다: {id}")),
	};
	let d = dir(&store.root).join(id);
	if d.exists() {
		return msg(format!("이미 있습니다: {}", d.display()));
	}
	let old = dir(&store.root).join(format!("{id}.json"));
	if old.exists() {
		let blank = fs::read(&old).ok().and_then(|b| manifest::from_legacy(&b).ok()).and_then(|(m, _)| m.contributes.terminal).is_some_and(|t| terminal::is_blank(&t));
		if !blank {
			return msg(format!("이미 있습니다: {}", old.display()));
		}
		store.trash(&old, &format!("{id}.json"))?;
	}
	fs::create_dir_all(&d)?;
	let path = d.join(MANIFEST);
	fs::write(&path, serde_json::to_vec_pretty(&m)?)?;
	Ok(path)
}

/* ---------- 설정 칸 ---------- */

/// 매니페스트의 설정 칸 값. 저장한 값이 없는 칸은 기본값으로 채운다.
pub fn settings_get(root: &Path, m: &Manifest) -> Value {
	let saved: serde_json::Map<String, Value> = fs::read(data_dir(root, &m.id).join("settings.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
	let mut out = serde_json::Map::new();
	for f in &m.contributes.settings {
		let v = saved.get(&f.key).cloned().filter(|v| !v.is_null()).unwrap_or_else(|| match (&f.default, f.kind.as_str()) {
			(d, _) if !d.is_null() => d.clone(),
			(_, "toggle") => json!(false),
			(_, "select") => json!(f.options.first().cloned().unwrap_or_default()),
			_ => json!(""),
		});
		out.insert(f.key.clone(), v);
	}
	Value::Object(out)
}

/// 매니페스트에 있는 칸만 남겨 쓴다. 화면이 보낸 엉뚱한 키가 쌓이지 않게.
pub fn settings_set(root: &Path, m: &Manifest, values: &Value) -> Result<Value> {
	let keys: HashSet<&str> = m.contributes.settings.iter().map(|f| f.key.as_str()).collect();
	let kept: serde_json::Map<String, Value> = values.as_object().map(|o| o.iter().filter(|(k, _)| keys.contains(k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
	crate::store::write_atomic(&data_dir(root, &m.id).join("settings.json"), &serde_json::to_vec_pretty(&kept)?)?;
	Ok(settings_get(root, m))
}

/* ---------- 기록 ---------- */

/// 기록이 이보다 커지면 뒤쪽 줄만 남긴다.
const LOG_LIMIT: u64 = 256 * 1024;
const LOG_KEEP: usize = 300;
const FAILURE_WINDOW_MS: i64 = 7 * 24 * 3600 * 1000;

/// log.jsonl 에 한 줄 붙인다. kind 는 event · command · log.
pub fn log(data: &Path, kind: &str, name: &str, ok: bool, text: &str) {
	let line = json!({ "at": now_ms(), "kind": kind, "name": name, "ok": ok, "text": text.chars().take(2000).collect::<String>() });
	let path = data.join("log.jsonl");
	let _ = fs::create_dir_all(data);
	if fs::metadata(&path).is_ok_and(|m| m.len() > LOG_LIMIT)
		&& let Ok(all) = fs::read_to_string(&path)
	{
		let lines: Vec<&str> = all.lines().collect();
		let tail = lines[lines.len().saturating_sub(LOG_KEEP)..].join("\n");
		let _ = fs::write(&path, format!("{tail}\n"));
	}
	if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(&path) {
		let _ = writeln!(f, "{line}");
	}
}

fn failures(data: &Path) -> u32 {
	let Ok(all) = fs::read_to_string(data.join("log.jsonl")) else { return 0 };
	let since = now_ms() - FAILURE_WINDOW_MS;
	all.lines()
		.filter_map(|l| serde_json::from_str::<Value>(l).ok())
		.filter(|v| v["ok"] == false && v["kind"] != "log" && v["at"].as_i64().is_some_and(|at| at >= since))
		.count() as u32
}

/* ---------- 부르기 ---------- */

fn call(app: &AppHandle, v: &PluginView, func: &str, head: Value, target: &Target) -> std::result::Result<String, String> {
	let store = app.state::<Store>();
	let grants = v.manifest.permissions.clone();
	let data = data_dir(&store.root, &v.manifest.id);
	let input = api::input(&store, &v.manifest, &grants, head, target, settings_get(&store.root, &v.manifest));
	let hosts: Vec<String> = grants.iter().filter_map(|g| g.strip_prefix("http:")).map(str::to_string).collect();
	let ctx = || api::functions(api::HostCtx { app: app.clone(), name: v.manifest.name.clone(), grants: grants.clone(), data: data.clone() });
	wasm::call(&v.manifest.id, &v.main_path(), &grants, &hosts, ctx, func, &input.to_string())
}

/// 사건을 그 사건을 적은 켜진 플러그인에 보낸다. 기다리지 않는다. store 의 잠금을 쥔 채 부르지 않는다 —
/// 플러그인이 docket_issue_get 으로 다시 읽으면 멈춘다.
pub fn dispatch(app: &AppHandle, event: &'static str, target: Target) {
	let app = app.clone();
	tauri::async_runtime::spawn_blocking(move || {
		let store = app.state::<Store>();
		let Ok(s) = store.settings() else { return };
		for v in load(&store.root, &s).into_iter().filter(|v| v.usable() && !v.manifest.main.is_empty() && v.manifest.contributes.events.iter().any(|e| e == event)) {
			if let Err(e) = call(&app, &v, "on_event", json!({ "event": event }), &target) {
				log(&data_dir(&store.root, &v.manifest.id), "event", event, false, &e);
			}
		}
	});
}

/// 메뉴 항목을 누른 것. 플러그인이 돌려준 것을 화면에 넘긴다. 실패도 기록에 남기고, 사용자가 누른 것이라 오류로 알린다.
pub fn invoke(app: &AppHandle, id: &str, command: &str, place: &str, target: Target) -> Result<Reply> {
	let store = app.state::<Store>();
	let v = find(&store.root, &store.settings()?, id)?;
	if !v.usable() {
		return msg(format!("「{}」 플러그인을 쓸 수 없습니다 · 설정 › 플러그인에서 확인하세요", v.manifest.name));
	}
	if !v.manifest.contributes.menus.iter().any(|m| m.command == command && m.place == place) {
		return msg(format!("「{}」 에 그런 메뉴가 없습니다: {command}", v.manifest.name));
	}
	let data = data_dir(&store.root, id);
	match call(app, &v, "on_command", json!({ "command": command, "where": place }), &target).and_then(|out| api::reply(&out, &v.manifest.permissions)) {
		Ok(r) => Ok(r),
		Err(e) => {
			log(&data, "command", command, false, &e);
			msg(format!("「{}」 · {e}", v.manifest.name))
		}
	}
}

/// 권한을 허락하고 켠다. 매니페스트의 권한 그대로를 허락한 것으로 남긴다.
pub fn grant(store: &Store, id: &str) -> Result<Settings> {
	let mut s = store.settings()?;
	let v = find(&store.root, &s, id)?;
	s.plugin_grants.insert(id.to_string(), v.manifest.permissions.clone());
	if !s.enabled_plugins.iter().any(|x| x == id) {
		s.enabled_plugins.push(id.to_string());
	}
	wasm::forget(id);
	store.save_settings(&s)
}

#[cfg(test)]
mod tests {
	use super::*;

	fn root() -> PathBuf {
		let r = std::env::temp_dir().join(format!("docket-plugins-{}", crate::model::short_id()));
		fs::create_dir_all(dir(&r)).unwrap();
		r
	}

	#[test]
	fn load_reads_folders_and_legacy_with_problems_per_entry() {
		let r = root();
		let d = dir(&r);
		fs::write(d.join("a-broken.json"), "{ not json").unwrap();
		fs::write(d.join("b-herdr.json"), r#"{ "id": "herdr", "kind": "terminal", "exe": "herdr", "launch": ["--x"] }"#).unwrap();
		fs::create_dir_all(d.join("c-menu")).unwrap();
		fs::write(
			d.join("c-menu").join(MANIFEST),
			r#"{ "id": "c-menu", "apiVersion": 1, "main": "plugin.wasm", "permissions": ["notify"], "contributes": { "menus": [{ "where": "issue", "command": "x", "label": "엑스" }] } }"#,
		)
		.unwrap();
		fs::write(d.join("c-menu").join("plugin.wasm"), b"\0asm").unwrap();

		let s = Settings { enabled_plugins: vec!["a-broken".into(), "herdr".into(), "c-menu".into()], ..Default::default() };
		let list = load(&r, &s);
		assert_eq!(list.len(), 3);
		assert!(list[0].problem.starts_with("정의를 읽지 못했습니다"));
		assert!(list[1].legacy && list[1].missing.is_empty(), "옛 정의는 허락한 것으로 본다");
		assert_eq!(list[2].problem, "");
		assert_eq!(list[2].missing, vec!["notify"], "허락하기 전에는 부르지 않는다");
		assert!(!list[2].usable());

		// 읽지 못한 옛 정의를 켜 두었으면 터미널 자리에서 문제를 알린다.
		assert!(terminal(&r, &s).unwrap_err().to_string().contains("정의를 읽지 못했습니다"));

		// 허락한 뒤 권한을 늘리면 다시 빠진다.
		let s = Settings { plugin_grants: [("c-menu".to_string(), vec!["notify".to_string()])].into(), ..s };
		assert!(load(&r, &s)[2].usable());
		fs::write(
			d.join("c-menu").join(MANIFEST),
			r#"{ "id": "c-menu", "apiVersion": 1, "main": "plugin.wasm", "permissions": ["notify", "process:cmd"], "contributes": { "menus": [{ "where": "issue", "command": "x", "label": "엑스" }] } }"#,
		)
		.unwrap();
		assert_eq!(load(&r, &s)[2].missing, vec!["process:cmd"]);
		fs::remove_dir_all(&r).unwrap();
	}

	#[test]
	fn settings_fill_defaults_and_drop_unknown_keys() {
		let r = root();
		let m: Manifest = serde_json::from_str(
			r#"{ "id": "s", "contributes": { "settings": [
				{ "key": "url", "label": "주소", "type": "text" },
				{ "key": "on", "label": "켜기", "type": "toggle" },
				{ "key": "mode", "label": "꼴", "type": "select", "options": ["a", "b"] } ] } }"#,
		)
		.unwrap();
		assert_eq!(settings_get(&r, &m), json!({ "url": "", "on": false, "mode": "a" }));
		assert_eq!(settings_set(&r, &m, &json!({ "url": "x", "junk": 1 })).unwrap(), json!({ "url": "x", "on": false, "mode": "a" }));
		fs::remove_dir_all(&r).unwrap();
	}

	#[test]
	fn log_counts_recent_failures_only() {
		let r = root();
		let d = data_dir(&r, "x");
		log(&d, "event", "failed", false, "웹훅이 404");
		log(&d, "log", "", false, "플러그인이 남긴 말");
		log(&d, "command", "open", true, "");
		assert_eq!(failures(&d), 1);
		fs::remove_dir_all(&r).unwrap();
	}
}
