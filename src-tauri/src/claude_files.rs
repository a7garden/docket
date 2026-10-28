//! Claude Code 설정 파일을 찾고 읽고 쓴다. 지침(CLAUDE.md) · 스킬 · 에이전트 · 명령 · 규칙.
//!
//! 전역은 ~/.claude (CLAUDE_CONFIG_DIR 을 따른다), 프로젝트는 그 폴더의 CLAUDE.md · .claude/ 다.
//! 사용자가 저장을 눌렀을 때만 쓴다. 쓸 때는 원래 파일의 줄바꿈(CRLF · LF)과 BOM 을 그대로 지킨다.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::error::{Error, Result, msg};
use crate::store::write_atomic;

pub fn claude_home() -> PathBuf {
	match std::env::var_os("CLAUDE_CONFIG_DIR") {
		Some(p) if !p.is_empty() => PathBuf::from(p),
		_ => dirs::home_dir().unwrap_or_default().join(".claude"),
	}
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
	/// instructions · skill · agent · command · rule
	pub kind: String,
	/// global · project
	pub scope: String,
	pub name: String,
	pub description: String,
	pub path: String,
	/// 스킬은 폴더째 다룬다
	pub dir: String,
	pub exists: bool,
	/// 스킬 폴더 안의 다른 파일 (폴더 기준 상대 경로)
	pub files: Vec<String>,
	pub modified: i64,
}

fn mtime(path: &Path) -> i64 {
	fs::metadata(path)
		.and_then(|m| m.modified())
		.map(|t| chrono::DateTime::<chrono::Utc>::from(t).timestamp_millis())
		.unwrap_or(0)
}

/// 머리말(--- … ---)에서 한 줄 값과 `>` · `|` 블록 값을 읽는다. 스킬 목록에 이름과 설명을 보이는 데 그만큼이면 된다.
pub fn frontmatter(text: &str) -> HashMap<String, String> {
	let mut map = HashMap::new();
	let t = text.trim_start_matches('\u{feff}');
	let mut lines = t.lines();
	if lines.next().map(|l| l.trim()) != Some("---") {
		return map;
	}
	let mut block: Option<(String, bool, Vec<String>)> = None; // (키, 줄을 이을지, 줄들)
	let flush = |map: &mut HashMap<String, String>, block: &mut Option<(String, bool, Vec<String>)>| {
		if let Some((k, folded, ls)) = block.take() {
			map.insert(k, if folded { ls.join(" ") } else { ls.join("\n") });
		}
	};
	for line in lines {
		if line.trim() == "---" {
			break;
		}
		let indented = line.starts_with(' ') || line.starts_with('\t');
		if indented {
			if let Some((_, _, ls)) = block.as_mut() {
				ls.push(line.trim().to_string());
			}
			continue;
		}
		flush(&mut map, &mut block);
		let Some((k, v)) = line.split_once(':') else { continue };
		let k = k.trim().to_string();
		let v = v.trim();
		match v {
			">" | ">-" | ">+" => block = Some((k, true, Vec::new())),
			"|" | "|-" | "|+" => block = Some((k, false, Vec::new())),
			_ => {
				let v = v.strip_prefix('"').and_then(|s| s.strip_suffix('"')).or_else(|| v.strip_prefix('\'').and_then(|s| s.strip_suffix('\''))).unwrap_or(v);
				map.insert(k, v.replace("\\\"", "\""));
			}
		}
	}
	flush(&mut map, &mut block);
	map
}

fn read_meta(path: &Path) -> HashMap<String, String> {
	fs::read_to_string(path).map(|t| frontmatter(&t)).unwrap_or_default()
}

fn walk(dir: &Path, base: &Path, out: &mut Vec<PathBuf>, depth: usize) {
	if depth > 5 || out.len() > 400 {
		return;
	}
	let Ok(rd) = fs::read_dir(dir) else { return };
	let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
	entries.sort_by_key(|e| e.file_name());
	for e in entries {
		let name = e.file_name().to_string_lossy().to_string();
		if name.starts_with('.') || name == "node_modules" || name == "__pycache__" {
			continue;
		}
		let p = e.path();
		if p.is_dir() {
			walk(&p, base, out, depth + 1);
		} else {
			out.push(p.strip_prefix(base).unwrap_or(&p).to_path_buf());
		}
	}
}

fn rel_name(p: &Path) -> String {
	p.to_string_lossy().replace('\\', "/")
}

fn push_md_dir(out: &mut Vec<Resource>, kind: &str, scope: &str, dir: &Path, colon_names: bool) {
	let mut files = Vec::new();
	walk(dir, dir, &mut files, 0);
	for rel in files.into_iter().filter(|f| f.extension().map(|e| e.eq_ignore_ascii_case("md")).unwrap_or(false)) {
		let path = dir.join(&rel);
		let meta = read_meta(&path);
		let stem = rel_name(&rel.with_extension(""));
		let name = meta.get("name").cloned().filter(|n| !n.is_empty() && kind == "agent").unwrap_or(if colon_names { stem.replace('/', ":") } else { stem });
		out.push(Resource {
			kind: kind.into(),
			scope: scope.into(),
			name,
			description: meta.get("description").cloned().unwrap_or_default(),
			path: path.to_string_lossy().to_string(),
			dir: String::new(),
			exists: true,
			files: Vec::new(),
			modified: mtime(&path),
		});
	}
}

fn scan(out: &mut Vec<Resource>, scope: &str, base: &Path, is_home: bool) {
	let instructions: Vec<PathBuf> = if is_home {
		vec![base.join("CLAUDE.md")]
	} else {
		vec![base.join("CLAUDE.md"), base.join("CLAUDE.local.md"), base.join(".claude").join("CLAUDE.md"), base.join("AGENTS.md")]
	};
	for (i, p) in instructions.iter().enumerate() {
		let exists = p.is_file();
		// 첫 자리(CLAUDE.md)는 없어도 보여 준다. 저장하면 만들어진다.
		if exists || i == 0 {
			out.push(Resource {
				kind: "instructions".into(),
				scope: scope.into(),
				name: rel_name(p.strip_prefix(base).unwrap_or(p)),
				description: String::new(),
				path: p.to_string_lossy().to_string(),
				dir: String::new(),
				exists,
				files: Vec::new(),
				modified: mtime(p),
			});
		}
	}

	let cdir = if is_home { base.to_path_buf() } else { base.join(".claude") };
	if let Ok(rd) = fs::read_dir(cdir.join("skills")) {
		let mut dirs: Vec<_> = rd.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).collect();
		dirs.sort_by_key(|e| e.file_name());
		for e in dirs {
			let dir = e.path();
			let Some(main) = ["SKILL.md", "skill.md"].iter().map(|n| dir.join(n)).find(|p| p.is_file()) else { continue };
			let meta = read_meta(&main);
			let mut files = Vec::new();
			walk(&dir, &dir, &mut files, 0);
			out.push(Resource {
				kind: "skill".into(),
				scope: scope.into(),
				name: meta.get("name").cloned().filter(|n| !n.is_empty()).unwrap_or_else(|| e.file_name().to_string_lossy().to_string()),
				description: meta.get("description").cloned().unwrap_or_default(),
				path: main.to_string_lossy().to_string(),
				dir: dir.to_string_lossy().to_string(),
				exists: true,
				files: files.iter().map(|f| rel_name(f)).collect(),
				modified: mtime(&main),
			});
		}
	}
	push_md_dir(out, "agent", scope, &cdir.join("agents"), false);
	push_md_dir(out, "command", scope, &cdir.join("commands"), true);
	push_md_dir(out, "rule", scope, &cdir.join("rules"), false);
}

pub fn list(project_root: Option<&Path>) -> Vec<Resource> {
	let mut out = Vec::new();
	scan(&mut out, "global", &claude_home(), true);
	if let Some(p) = project_root {
		scan(&mut out, "project", p, false);
	}
	out
}

/* ---------- 경로 확인 ---------- */

fn norm(p: &Path) -> String {
	p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

fn under(p: &Path, root: &Path) -> bool {
	let (p, r) = (norm(p), norm(root));
	!r.is_empty() && (p == r || p.starts_with(&format!("{r}\\")))
}

/// 화면이 넘긴 경로가 허락한 뿌리(~/.claude · 등록한 프로젝트 · 앱 데이터) 안인지 본다. `..` 은 받지 않는다.
pub fn check_allowed(path: &Path, roots: &[PathBuf]) -> Result<()> {
	if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
		return msg("허용하지 않는 경로입니다");
	}
	if roots.iter().any(|r| under(path, r)) { Ok(()) } else { msg("허용하지 않는 경로입니다") }
}

/* ---------- 읽기 · 쓰기 ---------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
	pub path: String,
	pub content: String,
	pub modified: i64,
	pub crlf: bool,
	pub bom: bool,
	pub exists: bool,
}

pub fn read_text(path: &Path) -> Result<TextFile> {
	if !path.exists() {
		return Ok(TextFile { path: path.to_string_lossy().to_string(), content: String::new(), modified: 0, crlf: false, bom: false, exists: false });
	}
	let bytes = fs::read(path)?;
	let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
	let body = if bom { &bytes[3..] } else { &bytes[..] };
	// UTF-8 이 아닌 파일(CP949 등)을 손실 변환해 저장하면 글자가 깨진 채 굳는다. 아예 열지 않는다.
	let text = String::from_utf8(body.to_vec()).map_err(|_| Error::Msg("UTF-8 이 아닌 파일이라 열 수 없습니다".into()))?;
	let crlf = text.contains("\r\n");
	Ok(TextFile {
		path: path.to_string_lossy().to_string(),
		content: text.replace("\r\n", "\n"),
		modified: mtime(path),
		crlf,
		bom,
		exists: true,
	})
}

/// expected_modified 가 지금 파일과 다르면 쓰지 않는다. 열어 둔 사이 다른 편집기 · 세션이 고친 것을 덮지 않기 위해서다.
pub fn write_text(path: &Path, content: &str, crlf: bool, bom: bool, expected_modified: i64, force: bool) -> Result<TextFile> {
	if path.exists() && !force && mtime(path) != expected_modified {
		return msg("conflict");
	}
	let mut text = content.replace("\r\n", "\n");
	if crlf {
		text = text.replace('\n', "\r\n");
	}
	let mut bytes = Vec::with_capacity(text.len() + 3);
	if bom {
		bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
	}
	bytes.extend_from_slice(text.as_bytes());
	write_atomic(path, &bytes)?;
	read_text(path)
}

/* ---------- 새로 만들기 · 지우기 ---------- */

fn yaml_value(s: &str) -> String {
	let s = s.trim().replace('\n', " ");
	if s.is_empty() || s.contains(": ") || s.contains(" #") || s.starts_with(['"', '\'', '[', '{', '>', '|', '*', '&', '!', '%', '@', '`']) {
		format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
	} else {
		s
	}
}

/// 새 자원을 만든다. base 는 전역이면 ~/.claude, 프로젝트면 <프로젝트>/.claude 다.
pub fn create(kind: &str, base: &Path, name: &str, description: &str) -> Result<PathBuf> {
	let name = name.trim();
	if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
		return msg("이름은 영문 · 숫자 · - · _ 로만 짓습니다");
	}
	let desc = yaml_value(description);
	let (path, body) = match kind {
		"skill" => (
			base.join("skills").join(name).join("SKILL.md"),
			format!("---\nname: {name}\ndescription: {desc}\n---\n\n# {name}\n\n"),
		),
		"agent" => (base.join("agents").join(format!("{name}.md")), format!("---\nname: {name}\ndescription: {desc}\n---\n\n")),
		"command" => (base.join("commands").join(format!("{name}.md")), format!("---\ndescription: {desc}\n---\n\n")),
		"rule" => (base.join("rules").join(format!("{name}.md")), format!("# {name}\n\n")),
		_ => return msg("만들 수 없는 종류입니다"),
	};
	if path.exists() || (kind == "skill" && path.parent().map(|d| d.exists()).unwrap_or(false)) {
		return msg("같은 이름이 이미 있습니다");
	}
	write_atomic(&path, body.as_bytes())?;
	Ok(path)
}

/// 지울 대상(스킬은 폴더째)을 정한다. 지침 파일은 지우지 않는다.
pub fn delete_target(path: &Path, bases: &[PathBuf]) -> Result<PathBuf> {
	for base in bases {
		let skills = base.join("skills");
		if under(path, &skills) && !under(&skills, path) {
			// skills/<이름>/… 의 <이름> 폴더
			let rel = path.strip_prefix(&skills).map_err(|_| Error::Msg("경로를 읽지 못했습니다".into()))?;
			if let Some(first) = rel.components().next() {
				return Ok(skills.join(first.as_os_str()));
			}
		}
		for sub in ["agents", "commands", "rules"] {
			if under(path, &base.join(sub)) && path.is_file() {
				return Ok(path.to_path_buf());
			}
		}
	}
	msg("지울 수 없는 파일입니다")
}

/* ---------- 권한 규칙 ---------- */

/// settings.json 한 곳의 권한 규칙. 앱이 띄운 claude 도 이 파일들을 읽어 앱의 규칙과 합친다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSet {
	/// global · project · local
	pub scope: String,
	pub path: String,
	pub exists: bool,
	pub default_mode: String,
	pub allow: Vec<String>,
	pub deny: Vec<String>,
	pub ask: Vec<String>,
}

fn rule_set(scope: &str, path: PathBuf) -> RuleSet {
	let v: serde_json::Value = fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
	let list = |k: &str| -> Vec<String> {
		v.pointer(&format!("/permissions/{k}")).and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
	};
	RuleSet {
		scope: scope.into(),
		exists: path.is_file(),
		default_mode: v.pointer("/permissions/defaultMode").and_then(|x| x.as_str()).unwrap_or("").into(),
		allow: list("allow"),
		deny: list("deny"),
		ask: list("ask"),
		path: path.to_string_lossy().into(),
	}
}

/// 전역 · 저장소 공유 · 저장소 개인 설정. 관리자 정책 파일은 이 PC 에 두지 않으므로 보지 않는다.
pub fn rule_sets(root: &Path) -> Vec<RuleSet> {
	vec![
		rule_set("global", claude_home().join("settings.json")),
		rule_set("project", root.join(".claude").join("settings.json")),
		rule_set("local", root.join(".claude").join("settings.local.json")),
	]
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
	pub rule: String,
	pub why: String,
}

/// 저장소에 있는 빌드 · 시험 도구를 보고 구현 때 열어 둘 만한 명령을 고른다. 고르기만 하고 넣는 것은 사용자가 한다.
/// 임의 코드를 돌리는 명령(python -c · node -e · npx 아무거나)은 내지 않는다. 그것은 「모두 허용」과 다르지 않다.
pub fn suggest_commands(root: &Path) -> Vec<Suggestion> {
	let mut out: Vec<Suggestion> = Vec::new();
	let mut add = |rule: &str, why: &str| {
		if !out.iter().any(|s| s.rule == rule) {
			out.push(Suggestion { rule: rule.into(), why: why.into() });
		}
	};
	let has = |name: &str| root.join(name).exists();
	let any_ext = |ext: &str| fs::read_dir(root).map(|rd| rd.filter_map(|e| e.ok()).any(|e| e.path().extension().map(|x| x.eq_ignore_ascii_case(ext)).unwrap_or(false))).unwrap_or(false);

	if let Ok(text) = fs::read_to_string(root.join("package.json")) {
		let pm = if has("pnpm-lock.yaml") { "pnpm" } else if has("yarn.lock") { "yarn" } else { "npm" };
		let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
		if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
			for name in scripts.keys() {
				let rule = if name == "test" { format!("Bash({pm} test:*)") } else { format!("Bash({pm} run {name}:*)") };
				add(&rule, &format!("package.json 의 {name} 스크립트"));
			}
		}
		if has("tsconfig.json") {
			add("Bash(npx tsc:*)", "타입 검사");
		}
	}
	if has("Cargo.toml") || root.join("src-tauri").join("Cargo.toml").exists() {
		add("Bash(cargo check:*)", "Rust 컴파일 확인");
		add("Bash(cargo test:*)", "Rust 시험");
		add("Bash(cargo clippy:*)", "Rust 점검");
	}
	if has("pyproject.toml") || has("pytest.ini") || has("setup.py") || has("requirements.txt") || any_ext("py") {
		add("Bash(python -m pytest:*)", "Python 시험");
		add("Bash(pytest:*)", "Python 시험");
		add("Bash(python -m py_compile:*)", "Python 문법 확인");
	}
	if has("pom.xml") {
		add("Bash(mvn compile:*)", "Maven 컴파일");
		add("Bash(mvn test:*)", "Maven 시험");
	}
	if has("build.gradle") || has("build.gradle.kts") {
		add("Bash(./gradlew build:*)", "Gradle 빌드");
		add("Bash(./gradlew test:*)", "Gradle 시험");
	}
	if has("go.mod") {
		add("Bash(go build:*)", "Go 빌드");
		add("Bash(go test:*)", "Go 시험");
		add("Bash(go vet:*)", "Go 점검");
	}
	if any_ext("sln") || any_ext("csproj") {
		add("Bash(dotnet build:*)", ".NET 빌드");
		add("Bash(dotnet test:*)", ".NET 시험");
	}
	out
}
