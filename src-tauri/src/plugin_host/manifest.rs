//! 플러그인 매니페스트(`plugins/<id>/plugin.json`)와 옛 정의(`plugins/<id>.json`) 읽기 · 검사.
//!
//! ```json
//! { "id": "open-in-code", "name": "VS Code 로 열기", "version": "1.0.0", "apiVersion": 1, "main": "plugin.wasm",
//!   "description": "", "permissions": ["issue:read", "process:code"],
//!   "contributes": {
//!     "menus": [{ "where": "issue", "command": "open", "label": "VS Code 로 열기", "when": "changes" }],
//!     "events": ["implemented", "failed"],
//!     "settings": [{ "key": "webhook", "label": "웹훅 주소", "type": "text" }],
//!     "terminal": { "exe": "herdr", "probe": [] } } }
//! ```
//!
//! - 기여(contributes)는 넷이다: 메뉴 항목 · 사건 · 설정 칸 · 터미널. 화면에 그리는 것은 앱이고, 플러그인 코드는 화면에서 돌지 않는다.
//! - 메뉴 · 사건이 있으면 코드(main 의 .wasm)가 있어야 한다. 터미널 · 설정 칸만 쓰는 플러그인은 코드가 없어도 된다.
//! - 권한은 설치할 때 사용자가 허락한다. 허락한 것보다 넓어지면 다시 허락받기 전에는 돌지 않는다 (mod.rs missing).
//!
//! 구획: 정의 · 권한 · 검사 · 옛 정의 · 시험

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::terminal::{self, Terminal};
use crate::store::safe_id;

/// 이 앱이 아는 플러그인 API 판. 기여 지점 · 입력 꼴 · 호스트 함수를 바꾸면 올린다. 더 높은 판을 적은 플러그인은 쓰지 않는다.
pub const API_VERSION: u32 = 1;

/// issue: 이슈 카드 우클릭 · 상세 「더 보기」 · file: 바뀐 파일 머리 · project: 사이드바 프로젝트
pub const PLACES: &[&str] = &["issue", "file", "project"];
/// 메뉴 항목을 누를 수 있는 조건. changes: 바뀐 파일이 있을 때 · session: 이어 갈 세션이 있을 때
pub const WHENS: &[&str] = &["", "changes", "session"];
pub const EVENTS: &[&str] = &["planned", "implemented", "failed", "reverted", "done", "dropped", "deliverable"];
const FIELD_TYPES: &[&str] = &["text", "toggle", "select"];

/* ---------- 정의 ---------- */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Manifest {
	/// 비우면 폴더 이름 (옛 정의는 파일 이름)
	pub id: String,
	pub name: String,
	pub version: String,
	pub api_version: u32,
	pub description: String,
	/// 플러그인 폴더 안의 .wasm 파일 이름. 메뉴 · 사건이 없으면 비워도 된다.
	pub main: String,
	pub permissions: Vec<String>,
	pub contributes: Contributes,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Contributes {
	pub menus: Vec<Menu>,
	pub events: Vec<String>,
	pub settings: Vec<Field>,
	pub terminal: Option<Terminal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Menu {
	#[serde(rename = "where")]
	pub place: String,
	/// on_command 에 넘기는 이름. 플러그인이 어느 항목을 눌렀는지 가린다.
	pub command: String,
	pub label: String,
	pub when: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Field {
	pub key: String,
	pub label: String,
	/// text · toggle · select
	#[serde(rename = "type")]
	pub kind: String,
	/// select 의 고를 값
	pub options: Vec<String>,
	pub default: serde_json::Value,
	pub hint: String,
}

impl Manifest {
	/// 코드를 불러야 하는 기여가 있는지
	pub fn needs_code(&self) -> bool {
		!self.contributes.menus.is_empty() || !self.contributes.events.is_empty()
	}
}

/* ---------- 권한 ---------- */

/// 이름만으로 쓰는 권한. 나머지는 `process:<exe>` · `http:<호스트>` 처럼 대상을 붙인다.
pub const PLAIN_PERMISSIONS: &[&str] = &["issue:read", "notify", "open", "storage"];

pub fn known_permission(p: &str) -> bool {
	PLAIN_PERMISSIONS.contains(&p)
		|| p.strip_prefix("process:").is_some_and(|x| !x.trim().is_empty() && !x.contains(['/', '\\']))
		|| p.strip_prefix("http:").is_some_and(|x| !x.trim().is_empty() && !x.contains(['/', ':']))
}

/// `process:<이름>` 의 이름. 실행 파일 경로에서 이름만 떼어 비교한다 (`C:\x\herdr.exe` → herdr).
pub fn exe_name(exe: &str) -> String {
	std::path::Path::new(exe.trim()).file_stem().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}

pub fn allows_process(perms: &[String], exe: &str) -> bool {
	let name = exe_name(exe);
	!name.is_empty() && perms.iter().any(|p| p.strip_prefix("process:").is_some_and(|x| x.eq_ignore_ascii_case(&name)))
}

/* ---------- 검사 ---------- */

/// 쓸 수 없게 하는 문제. 비면 쓸 수 있다. `has_main` 은 main 의 파일이 실제로 있는지(설치 전이면 꾸러미 안에 있는지)다.
pub fn check(m: &Manifest, has_main: bool, terminal_exe_found: bool, seen: &mut HashSet<String>) -> String {
	if safe_id(&m.id).is_err() {
		return format!("id 는 영문 · 숫자 · - · _ 로 씁니다: {}", m.id);
	}
	if !seen.insert(m.id.clone()) {
		return format!("같은 id({}) 의 플러그인이 앞에 있습니다", m.id);
	}
	if m.api_version == 0 {
		return "apiVersion 을 적으세요 (지금은 1)".into();
	}
	if m.api_version > API_VERSION {
		return format!("이 앱보다 새 API 판({}) 의 플러그인입니다 · 앱을 업데이트하세요 (이 앱: {API_VERSION})", m.api_version);
	}
	if let Some(p) = m.permissions.iter().find(|p| !known_permission(p)) {
		return format!("모르는 권한입니다: {p} (쓸 수 있는 것: {} · process:<실행 파일> · http:<호스트>)", PLAIN_PERMISSIONS.join(" "));
	}
	let c = &m.contributes;
	if c.menus.is_empty() && c.events.is_empty() && c.settings.is_empty() && c.terminal.is_none() {
		return "기여하는 것이 없습니다 (contributes 의 menus · events · settings · terminal)".into();
	}
	for menu in &c.menus {
		if !PLACES.contains(&menu.place.as_str()) {
			return format!("메뉴의 where 를 모릅니다: {} (쓸 수 있는 것: {})", menu.place, PLACES.join(" "));
		}
		if !WHENS.contains(&menu.when.as_str()) {
			return format!("메뉴의 when 을 모릅니다: {} (쓸 수 있는 것: changes · session · 비움)", menu.when);
		}
		if menu.command.trim().is_empty() || menu.label.trim().is_empty() {
			return "메뉴에는 command 와 label 을 적습니다".into();
		}
	}
	if let Some(e) = c.events.iter().find(|e| !EVENTS.contains(&e.as_str())) {
		return format!("모르는 사건입니다: {e} (쓸 수 있는 것: {})", EVENTS.join(" "));
	}
	let mut keys = HashSet::new();
	for f in &c.settings {
		if f.key.trim().is_empty() || !keys.insert(f.key.as_str()) {
			return format!("설정 칸의 key 가 비었거나 겹칩니다: {}", f.key);
		}
		if !FIELD_TYPES.contains(&f.kind.as_str()) {
			return format!("설정 칸의 type 을 모릅니다: {} (쓸 수 있는 것: {})", f.kind, FIELD_TYPES.join(" "));
		}
		if f.kind == "select" && f.options.is_empty() {
			return format!("select 칸({}) 에는 options 를 적습니다", f.key);
		}
	}
	if !m.main.is_empty() && !plain_file_name(&m.main) {
		return format!("main 은 플러그인 폴더 안의 파일 이름만 적습니다: {}", m.main);
	}
	if m.needs_code() && m.main.is_empty() {
		return "메뉴 · 사건을 쓰려면 main 에 .wasm 파일을 적습니다".into();
	}
	if !m.main.is_empty() && !has_main {
		return format!("main 의 파일이 없습니다: {}", m.main);
	}
	if let Some(t) = &c.terminal {
		if !allows_process(&m.permissions, &t.exe) {
			return format!("터미널의 실행 파일을 권한에 적습니다: process:{}", exe_name(&t.exe));
		}
		let p = terminal::check(t, terminal_exe_found);
		if !p.is_empty() {
			return format!("터미널: {p}");
		}
	}
	String::new()
}

/// 폴더 이름 · 상위 폴더 · 절대 경로가 없는 파일 이름 하나인지. 설치할 때 꾸러미 밖의 파일을 끌어오지 못하게 한다.
pub fn plain_file_name(name: &str) -> bool {
	let p = std::path::Path::new(name);
	!name.trim().is_empty() && p.components().count() == 1 && matches!(p.components().next(), Some(std::path::Component::Normal(_)))
}

/* ---------- 옛 정의 ---------- */

/// 2026-10-29 전의 정의 꼴(`plugins/<id>.json` · kind 가 terminal 인 터미널 정의 한 장). 터미널 기여 하나짜리 플러그인으로 읽는다.
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Legacy {
	id: String,
	name: String,
	kind: String,
	note: String,
	#[serde(flatten)]
	terminal: Terminal,
}

/// 옛 정의를 매니페스트로 바꾼다. 권한은 터미널의 실행 파일 하나다 (쓰던 사람이 이미 켜 두었으므로 허락한 것으로 본다 · mod.rs).
/// 종류가 terminal 이 아니면 문제를 함께 돌려준다.
pub fn from_legacy(bytes: &[u8]) -> Result<(Manifest, String), String> {
	let l: Legacy = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
	let problem = if l.kind.is_empty() || l.kind == "terminal" { String::new() } else { format!("모르는 종류입니다: {} (옛 정의는 terminal 만 읽습니다)", l.kind) };
	let perm = format!("process:{}", exe_name(&l.terminal.exe));
	Ok((
		Manifest {
			id: l.id,
			name: l.name,
			version: String::new(),
			api_version: API_VERSION,
			description: l.note,
			main: String::new(),
			permissions: vec![perm],
			contributes: Contributes { terminal: Some(l.terminal), ..Default::default() },
		},
		problem,
	))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn menu_plugin() -> Manifest {
		serde_json::from_str(
			r#"{ "id": "open-in-code", "name": "열기", "apiVersion": 1, "main": "plugin.wasm", "permissions": ["issue:read", "process:code"],
			     "contributes": { "menus": [{ "where": "issue", "command": "open", "label": "VS Code 로 열기", "when": "changes" }] } }"#,
		)
		.unwrap()
	}

	#[test]
	fn checks_contributions_and_permissions() {
		assert_eq!(check(&menu_plugin(), true, false, &mut HashSet::new()), "");
		assert!(check(&menu_plugin(), false, false, &mut HashSet::new()).contains("main 의 파일이 없습니다"));
		let mut seen = HashSet::new();
		check(&menu_plugin(), true, false, &mut seen);
		assert!(check(&menu_plugin(), true, false, &mut seen).contains("같은 id"));

		let bad = |f: &dyn Fn(&mut Manifest)| {
			let mut m = menu_plugin();
			f(&mut m);
			check(&m, true, false, &mut HashSet::new())
		};
		assert!(bad(&|m| m.api_version = 2).contains("새 API"));
		assert!(bad(&|m| m.permissions.push("fs:write".into())).contains("모르는 권한"));
		assert!(bad(&|m| m.permissions.push("process:C:\\x\\cmd".into())).contains("모르는 권한"), "process 에는 경로가 아니라 이름을 적는다");
		assert!(bad(&|m| m.contributes.menus[0].place = "board".into()).contains("where"));
		assert!(bad(&|m| m.contributes.events.push("tick".into())).contains("모르는 사건"));
		assert!(bad(&|m| m.main = "..\\x.wasm".into()).contains("파일 이름만"));
		assert!(bad(&|m| m.main.clear()).contains("main 에 .wasm"));
		assert!(bad(&|m| m.contributes.menus.clear()).contains("기여하는 것이 없습니다"));
	}

	/// 저장소의 예제가 이 검사를 늘 통과해야 작성자가 그대로 따라 할 수 있다.
	#[test]
	fn example_manifest_passes() {
		let m: Manifest = serde_json::from_str(include_str!("../../../examples/plugins/open-in-code/plugin.json")).unwrap();
		assert_eq!(check(&m, true, false, &mut HashSet::new()), "");
	}

	#[test]
	fn terminal_needs_process_permission() {
		let mut m = Manifest {
			id: "herdr".into(),
			api_version: 1,
			contributes: Contributes { terminal: Some(terminal::herdr()), ..Default::default() },
			..Default::default()
		};
		assert!(check(&m, false, true, &mut HashSet::new()).contains("process:herdr"));
		m.permissions = vec!["process:herdr".into()];
		assert_eq!(check(&m, false, true, &mut HashSet::new()), "", "터미널만 쓰면 코드가 없어도 된다");
		assert!(allows_process(&m.permissions, r"C:\Users\me\.herdr\bin\HERDR.exe"));
		assert!(!allows_process(&m.permissions, "cmd"));
	}

	#[test]
	fn reads_legacy_terminal_definition() {
		let (m, problem) = from_legacy(br#"{ "id": "herdr", "name": "herdr", "kind": "terminal", "exe": "herdr", "probe": ["workspace", "list"], "attach": ["tab", "create"], "note": "note" }"#).unwrap();
		assert_eq!(problem, "");
		assert_eq!(m.permissions, vec!["process:herdr"]);
		assert_eq!(m.description, "note");
		assert_eq!(m.contributes.terminal.unwrap().attach, vec![vec!["tab".to_string(), "create".into()]]);
		assert!(from_legacy(br#"{ "kind": "hook", "exe": "x" }"#).unwrap().1.contains("모르는 종류"));
		assert!(from_legacy(b"{ not json").is_err());
	}
}
