//! Claude Code 설정 파일을 찾고 읽고 쓴다. 지침(CLAUDE.md) · 스킬 · 에이전트 · 명령 · 규칙.
//!
//! 전역은 ~/.claude (CLAUDE_CONFIG_DIR 을 따른다), 프로젝트는 그 폴더의 CLAUDE.md · .claude/ 다.
//! 프로젝트를 고르면 그 프로젝트에 실제로 실리는 것을 층으로 낸다: 전역 → 상위 폴더 지침 → 프로젝트 → 함께 여는 폴더 → settings.json.
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

/// docket 실행이 빼는 전역 자리(~/.claude 기준 glob). runner::run_settings 가 claudeMdExcludes 로 넘기고
/// 설정 화면이 「docket 실행에서 빠짐」 표시에 쓴다. 한 곳에만 적는다 — 두 곳에 적으면 화면 표시가 실제 실행과 어긋난다.
pub const RUN_EXCLUDES: &[&str] = &["CLAUDE.md", "rules/**"];

/// docket 실행에서 빠지는 전역 파일인지. RUN_EXCLUDES 의 `x/**` 는 그 폴더 아래 전부, 나머지는 그 파일 하나다.
pub fn run_excluded(path: &Path) -> bool {
	let home = claude_home();
	RUN_EXCLUDES.iter().any(|e| match e.strip_suffix("/**") {
		Some(dir) => under(path, &home.join(dir)) && norm(path) != norm(&home.join(dir)),
		None => norm(path) == norm(&home.join(e)),
	})
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
	/// instructions · skill · agent · command · rule · settings · folder
	pub kind: String,
	/// global · parent(상위 폴더) · project · local(settings.local.json) · extra(함께 여는 폴더)
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
	/// docket 실행에서는 실리지 않는다(RUN_EXCLUDES)
	pub excluded: bool,
	/// settings 일 때 그 파일의 권한 규칙 · 훅
	pub rules: Option<RuleSet>,
}

impl Resource {
	fn file(kind: &str, scope: &str, name: String, description: String, path: &Path) -> Self {
		Self {
			kind: kind.into(),
			scope: scope.into(),
			name,
			description,
			path: path.to_string_lossy().to_string(),
			dir: String::new(),
			exists: path.exists(),
			files: Vec::new(),
			modified: mtime(path),
			excluded: run_excluded(path),
			rules: None,
		}
	}
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
		out.push(Resource::file(kind, scope, name, meta.get("description").cloned().unwrap_or_default(), &path));
	}
}

fn scan(out: &mut Vec<Resource>, scope: &str, base: &Path, is_home: bool) {
	let instructions: Vec<PathBuf> = if is_home {
		vec![base.join("CLAUDE.md")]
	} else {
		// 2026.10.30 : AGENTS.md 를 뺐다. Claude 는 이 파일을 읽지 않는데 지침 목록에 있어 실리는 것처럼 읽혔다.
		vec![base.join("CLAUDE.md"), base.join("CLAUDE.local.md"), base.join(".claude").join("CLAUDE.md")]
	};
	for (i, p) in instructions.iter().enumerate() {
		// 첫 자리(CLAUDE.md)는 없어도 보여 준다. 저장하면 만들어진다.
		if p.is_file() || i == 0 {
			out.push(Resource::file("instructions", scope, rel_name(p.strip_prefix(base).unwrap_or(p)), String::new(), p));
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
			let name = meta.get("name").cloned().filter(|n| !n.is_empty()).unwrap_or_else(|| e.file_name().to_string_lossy().to_string());
			out.push(Resource {
				dir: dir.to_string_lossy().to_string(),
				files: files.iter().map(|f| rel_name(f)).collect(),
				..Resource::file("skill", scope, name, meta.get("description").cloned().unwrap_or_default(), &main)
			});
		}
	}
	push_md_dir(out, "agent", scope, &cdir.join("agents"), false);
	push_md_dir(out, "command", scope, &cdir.join("commands"), true);
	push_md_dir(out, "rule", scope, &cdir.join("rules"), false);
}

/// 프로젝트 폴더의 부모부터 드라이브 루트까지 있는 CLAUDE.md · CLAUDE.local.md, 가까운 것부터.
/// Claude Code 는 작업 폴더에서 위로 올라가며 이것들을 모두 싣는다. 전역 홈(~/.claude 의 부모)은 건너뛴다.
pub fn parent_instructions(root: &Path) -> Vec<PathBuf> {
	let skip = claude_home().parent().map(norm).unwrap_or_default();
	root.ancestors()
		.skip(1)
		.filter(|d| norm(d) != skip)
		.flat_map(|d| [d.join("CLAUDE.md"), d.join("CLAUDE.local.md")])
		.filter(|p| p.is_file())
		.collect()
}

/// settings.json 은 있는 것만 보인다. 처음에는 읽기 전용이다 — JSON 을 손으로 고치다 깨뜨리면 모든 세션의 권한이 흔들린다.
fn push_settings(out: &mut Vec<Resource>, r: RuleSet) {
	if !r.exists {
		return;
	}
	let name = match r.scope.as_str() {
		"global" => "~/.claude/settings.json",
		"local" => ".claude/settings.local.json",
		_ => ".claude/settings.json",
	};
	let description = format!("거부 {} · 허용 {} · 훅 {}", r.deny.len(), r.allow.len(), r.hooks.len());
	let path = PathBuf::from(&r.path);
	let scope = r.scope.clone();
	out.push(Resource { rules: Some(r), ..Resource::file("settings", &scope, name.into(), description, &path) });
}

/// 전역 · 상위 폴더 · 프로젝트 · 함께 여는 폴더 · settings.json 을 이 차례로 낸다.
pub fn list(project_root: Option<&Path>, extra_dirs: &[String]) -> Vec<Resource> {
	let mut out = Vec::new();
	scan(&mut out, "global", &claude_home(), true);
	let Some(p) = project_root else {
		push_settings(&mut out, rule_set("global", claude_home().join("settings.json")));
		return out;
	};
	for f in parent_instructions(p) {
		out.push(Resource::file("instructions", "parent", f.to_string_lossy().to_string(), String::new(), &f));
	}
	scan(&mut out, "project", p, false);
	for d in extra_dirs {
		out.push(Resource::file("folder", "extra", d.clone(), "읽기 · 편집은 열림 · 이 폴더의 CLAUDE.md 는 실리지 않음".into(), Path::new(d)));
	}
	for r in rule_sets(p) {
		push_settings(&mut out, r);
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
	/// 훅 사건마다 「사건 이름 · 명령 수」 (예: PreToolUse · 2)
	pub hooks: Vec<String>,
}

/// settings.json 의 hooks: { 사건: [{ matcher, hooks: [명령 …] }, …] }
fn hook_summary(v: &serde_json::Value) -> Vec<String> {
	let Some(events) = v.get("hooks").and_then(|h| h.as_object()) else { return Vec::new() };
	events
		.iter()
		.map(|(event, groups)| {
			let n: usize = groups.as_array().map(|a| a.iter().map(|g| g.get("hooks").and_then(|x| x.as_array()).map_or(0, |x| x.len())).sum()).unwrap_or(0);
			format!("{event} · {n}")
		})
		.collect()
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
		hooks: hook_summary(&v),
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

#[cfg(test)]
mod tests {
	use super::*;

	/// 상위 폴더 지침은 가까운 것부터 나오고, 프로젝트 폴더 자신의 CLAUDE.md 는 상위 층에 넣지 않는다. AGENTS.md 는 지침이 아니다.
	#[test]
	fn parent_layer_nearest_first() {
		let a = std::env::temp_dir().join(format!("docket-parent-{}", crate::model::short_id()));
		let proj = a.join("b").join("proj");
		fs::create_dir_all(&proj).unwrap();
		fs::write(a.join("CLAUDE.md"), "a").unwrap();
		fs::write(a.join("b").join("CLAUDE.md"), "b").unwrap();
		fs::write(proj.join("CLAUDE.md"), "p").unwrap();
		fs::write(proj.join("AGENTS.md"), "x").unwrap();
		let mine: Vec<PathBuf> = parent_instructions(&proj).into_iter().filter(|p| p.starts_with(&a)).collect();
		assert_eq!(mine, vec![a.join("b").join("CLAUDE.md"), a.join("CLAUDE.md")]);

		let list = list(Some(&proj), &[a.to_string_lossy().to_string()]);
		let parents: Vec<&str> = list.iter().filter(|r| r.scope == "parent" && r.path.starts_with(&*a.to_string_lossy())).map(|r| r.path.as_str()).collect();
		assert_eq!(parents.len(), 2);
		assert!(!list.iter().any(|r| r.name.ends_with("AGENTS.md")), "AGENTS.md 를 지침으로 보였다");
		assert!(list.iter().any(|r| r.kind == "folder" && r.scope == "extra"), "함께 여는 폴더가 보이지 않는다");
		assert!(run_excluded(&claude_home().join("CLAUDE.md")) && run_excluded(&claude_home().join("rules").join("x.md")) && !run_excluded(&claude_home().join("skills").join("x").join("SKILL.md")));
		let _ = fs::remove_dir_all(&a);
	}
}
