//! 플러그인: 앱 데이터의 plugins/*.json 에 둔 정의로 바깥 프로그램과 잇는다.
//!
//! 지금 종류는 terminal 하나다. 켜 두면 「터미널에서 잇기」가 Windows 터미널 대신 그 정의대로 연다.
//!
//! ```json
//! { "id": "herdr", "name": "herdr", "kind": "terminal", "exe": "herdr",
//!   "probe": [], "attach": [], "launch": [], "hostWt": true, "note": "" }
//! ```
//!
//! - 자리표시: {cwd} 프로젝트 폴더 · {claude} claude 실행 파일 · {session} 세션 ID · {title} `#번호 제목`
//! - probe 가 0 으로 끝나면(이미 켜 둔 것이 있으면) attach 로 붙이고, 아니면 launch 로 새로 띄운다.
//!   probe · attach 를 비우면 늘 launch 로 연다.
//! - 켜고 끄는 것은 settings.json 의 enabledPlugins 에 둔다. 정의 파일은 사용자가 쓴 것이라 앱이 고쳐 쓰지 않는다.
//! - 인자는 셸을 거치지 않고 배열 그대로 넘긴다. cmd.exe 를 거치면 경로 속 빈칸 · 기호가 깨진다.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result, msg};
use crate::store::safe_id;

pub const TERMINAL: &str = "terminal";
const KNOWN: &[&str] = &["cwd", "claude", "session", "title"];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Plugin {
	/// 비우면 파일 이름
	pub id: String,
	pub name: String,
	pub kind: String,
	/// 실행 파일. 이름만 적으면 PATH 에서 찾는다.
	pub exe: String,
	/// 이미 켜 둔 것이 있는지 묻는 인자. 0 으로 끝나면 있다고 본다.
	pub probe: Vec<String>,
	/// 켜 둔 것에 새 창으로 붙이는 인자
	pub attach: Vec<String>,
	/// 새로 띄우는 인자
	pub launch: Vec<String>,
	/// launch 를 Windows 터미널 새 탭 안에서 띄운다. 화면이 있어야 도는 프로그램(TUI)은 창이 따로 없으면 바로 끝난다.
	pub host_wt: bool,
	/// 설정 화면에 보이는 설명
	pub note: String,
}

/// 화면에 보내는 플러그인 한 건. 읽지 못한 정의도 문제와 함께 싣는다. 하나가 깨졌다고 목록 전체가 사라지면 안 된다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginView {
	#[serde(flatten)]
	pub def: Plugin,
	pub file: String,
	pub enabled: bool,
	/// 찾은 실행 파일. 못 찾았으면 비어 있다.
	pub exe_path: String,
	/// 이것이 있으면 쓰지 않는다
	pub problem: String,
	/// 쓸 수는 있으나 알아 둘 것
	pub warning: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginList {
	pub dir: String,
	pub plugins: Vec<PluginView>,
}

pub struct Vars {
	pub cwd: String,
	pub claude: String,
	pub session: String,
	pub title: String,
}

impl Vars {
	fn get(&self, name: &str) -> Option<&str> {
		match name {
			"cwd" => Some(&self.cwd),
			"claude" => Some(&self.claude),
			"session" => Some(&self.session),
			"title" => Some(&self.title),
			_ => None,
		}
	}
}

pub fn dir(root: &Path) -> PathBuf {
	root.join("plugins")
}

/* ---------- 읽기 · 검사 ---------- */

/// 파일 이름 순으로 읽는다. 켜진 터미널 플러그인이 둘이면 앞의 것을 쓰므로 순서가 정해져 있어야 한다.
pub fn load(root: &Path, enabled: &[String]) -> Vec<PluginView> {
	let Ok(rd) = fs::read_dir(dir(root)) else { return Vec::new() };
	let mut files: Vec<PathBuf> = rd
		.flatten()
		.map(|e| e.path())
		.filter(|p| p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("json")))
		.collect();
	files.sort();
	let mut seen = HashSet::new();
	files.iter().map(|f| view(f, enabled, &mut seen)).collect()
}

fn view(file: &Path, enabled: &[String], seen: &mut HashSet<String>) -> PluginView {
	let stem = file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
	let parsed = fs::read(file).map_err(|e| e.to_string()).and_then(|b| serde_json::from_slice::<Plugin>(&b).map_err(|e| e.to_string()));
	let (mut def, read_error) = match parsed {
		Ok(d) => (d, None),
		Err(e) => (Plugin::default(), Some(format!("정의를 읽지 못했습니다: {e}"))),
	};
	if def.id.trim().is_empty() {
		def.id = stem;
	}
	if def.name.trim().is_empty() {
		def.name = def.id.clone();
	}
	let exe_path = resolve_exe(&def.exe);
	let problem = read_error.unwrap_or_else(|| check(&def, exe_path.is_some(), seen));
	let resumes = [&def.launch, &def.attach].iter().any(|a| a.iter().any(|s| s.contains("{session}")));
	let warning = if problem.is_empty() && def.kind == TERMINAL && !resumes {
		"인자에 {session} 이 없어 claude 세션을 잇지 않고 프로그램만 엽니다. 프로그램 도움말에서 명령을 실행하는 인자를 찾아 launch 에 적으세요.".to_string()
	} else {
		String::new()
	};
	PluginView {
		enabled: enabled.contains(&def.id),
		file: file.to_string_lossy().to_string(),
		exe_path: exe_path.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
		def,
		problem,
		warning,
	}
}

fn check(def: &Plugin, exe_found: bool, seen: &mut HashSet<String>) -> String {
	if safe_id(&def.id).is_err() {
		return format!("id 는 영문 · 숫자 · - · _ 로 씁니다: {}", def.id);
	}
	if !seen.insert(def.id.clone()) {
		return format!("같은 id({}) 의 정의가 앞 파일에 있습니다", def.id);
	}
	if def.kind != TERMINAL {
		return format!("모르는 종류입니다: {} (지금은 terminal 만 씁니다)", def.kind);
	}
	if def.exe.trim().is_empty() {
		return "exe 가 비어 있습니다".into();
	}
	if def.probe.is_empty() != def.attach.is_empty() {
		return "probe 와 attach 는 함께 적거나 함께 비웁니다".into();
	}
	let dummy = Vars { cwd: String::new(), claude: String::new(), session: String::new(), title: String::new() };
	for arg in def.probe.iter().chain(&def.attach).chain(&def.launch) {
		if let Err(name) = expand(arg, &dummy) {
			return format!("모르는 자리표시입니다: {{{name}}} (쓸 수 있는 것: {})", KNOWN.iter().map(|k| format!("{{{k}}}")).collect::<Vec<_>>().join(" "));
		}
	}
	if !exe_found {
		return format!("실행 파일을 찾지 못했습니다: {} · 전체 경로를 적거나 PATH 에 넣으세요", def.exe);
	}
	String::new()
}

/// 이름만 적었으면 PATH 에서, 경로를 적었으면 그 자리에서 찾는다. 확장자를 빼먹었으면 .exe 를 붙여 본다.
pub fn resolve_exe(exe: &str) -> Option<PathBuf> {
	let exe = exe.trim();
	if exe.is_empty() {
		return None;
	}
	let p = PathBuf::from(exe);
	let names: Vec<PathBuf> = if p.extension().is_some() { vec![p.clone()] } else { vec![p.with_extension("exe"), p.clone()] };
	if p.is_absolute() || p.components().count() > 1 {
		return names.into_iter().find(|n| n.is_file());
	}
	let path = std::env::var_os("PATH")?;
	let names = &names;
	std::env::split_paths(&path).flat_map(move |d| names.iter().map(move |n| d.join(n))).find(|c| c.is_file())
}

/// 자리표시를 한 번에 채운다. 차례로 replace 하면 채운 값(경로) 안의 `{session}` 같은 글자까지 다시 바뀐다.
/// 이름 꼴(영문 · 숫자 · _)이 아닌 중괄호는 글자 그대로 둔다. 모르는 이름이면 그 이름을 돌려준다.
fn expand(arg: &str, v: &Vars) -> std::result::Result<String, String> {
	let mut out = String::new();
	let mut rest = arg;
	while let Some(i) = rest.find('{') {
		out.push_str(&rest[..i]);
		let tail = &rest[i..];
		match tail.find('}') {
			Some(j) if j > 1 && tail[1..j].chars().all(|c| c.is_ascii_alphanumeric() || c == '_') => {
				let name = &tail[1..j];
				out.push_str(v.get(name).ok_or_else(|| name.to_string())?);
				rest = &tail[j + 1..];
			}
			_ => {
				out.push('{');
				rest = &tail[1..];
			}
		}
	}
	out.push_str(rest);
	Ok(out)
}

pub fn fill(args: &[String], v: &Vars) -> Result<Vec<String>> {
	args.iter().map(|a| expand(a, v).map_err(|name| Error::Msg(format!("모르는 자리표시입니다: {{{name}}}")))).collect()
}

/// 「터미널에서 잇기」에 쓸 플러그인. 켜진 것 중 파일 이름 순으로 첫 터미널 플러그인이다.
/// 켜 둔 것에 문제가 있으면 오류를 낸다. 조용히 Windows 터미널로 넘어가면 사용자가 켜 둔 연동이 빠진 것을 알아채지 못한다.
pub fn terminal(root: &Path, enabled: &[String]) -> Result<Option<(Plugin, PathBuf)>> {
	// 읽지 못한 정의는 종류를 모른다. 켜 두었다면 터미널로 쓰려던 것으로 보고 문제를 알린다.
	let Some(v) = load(root, enabled).into_iter().find(|v| v.enabled && (v.def.kind == TERMINAL || v.def.kind.is_empty())) else {
		return Ok(None);
	};
	if !v.problem.is_empty() {
		return msg(format!("「{}」 플러그인을 쓸 수 없습니다: {} · 설정 › 플러그인에서 확인하세요", v.def.name, v.problem));
	}
	Ok(Some((v.def, PathBuf::from(v.exe_path))))
}

/* ---------- 틀 ---------- */

/// herdr 틀. 2026-10-28 : 이 PC 에서 herdr 0.9.5 가 PATH 에 있는 것만 확인했다.
/// 켜 둔 herdr 에 창을 붙이는 명령 · 명령을 주어 띄우는 인자는 확인하지 못해 비워 둔다. 사용자가 도움말을 보고 채운다.
fn herdr() -> Plugin {
	Plugin {
		id: "herdr".into(),
		name: "herdr".into(),
		kind: TERMINAL.into(),
		exe: "herdr".into(),
		probe: Vec::new(),
		attach: Vec::new(),
		launch: Vec::new(),
		host_wt: true,
		note: "herdr --help 로 인자를 확인해 채웁니다. launch: 프로젝트 폴더에서 {claude} --resume {session} 을 돌리며 띄우는 인자 · probe: 켜 둔 herdr 가 있으면 0 으로 끝나는 인자 · attach: 켜 둔 herdr 에 그 명령을 새 창으로 붙이는 인자.".into(),
	}
}

/// 틀을 plugins/<id>.json 으로 쓴다. 이미 있으면 덮지 않는다. 사용자가 고쳐 둔 인자를 지우지 않으려는 것이다.
pub fn create_preset(root: &Path, id: &str) -> Result<PathBuf> {
	let def = match id {
		"herdr" => herdr(),
		_ => return msg(format!("모르는 틀입니다: {id}")),
	};
	let d = dir(root);
	fs::create_dir_all(&d)?;
	let path = d.join(format!("{id}.json"));
	if path.exists() {
		return msg(format!("이미 있습니다: {}", path.display()));
	}
	fs::write(&path, serde_json::to_vec_pretty(&def)?)?;
	Ok(path)
}

/* ---------- 열기 ---------- */

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
/// probe 가 이보다 오래 걸리면 켜 둔 것이 없다고 본다. 화면 명령이 오래 묶이지 않게 짧게 둔다.
#[cfg(windows)]
const PROBE_LIMIT: Duration = Duration::from_secs(3);
#[cfg(windows)]
const ATTACH_LIMIT: Duration = Duration::from_secs(3);

/// 창 없이 돌려 끝나기를 잠깐 기다린다. 끝났으면 성공 여부, 아직 돌면 None.
#[cfg(windows)]
fn run_hidden(exe: &Path, args: &[String], cwd: &Path, limit: Duration, kill_late: bool) -> std::io::Result<Option<bool>> {
	use std::os::windows::process::CommandExt;
	use std::process::Stdio;
	let mut child = std::process::Command::new(exe)
		.args(args)
		.current_dir(cwd)
		.stdin(Stdio::null())
		.stdout(Stdio::null())
		.stderr(Stdio::null())
		.creation_flags(CREATE_NO_WINDOW)
		.spawn()?;
	let until = Instant::now() + limit;
	loop {
		if let Some(s) = child.try_wait()? {
			return Ok(Some(s.success()));
		}
		if Instant::now() >= until {
			if kill_late {
				let _ = child.kill();
			}
			return Ok(None);
		}
		std::thread::sleep(Duration::from_millis(50));
	}
}

/// 켜 둔 것이 있으면 붙이고, 없거나 붙이지 못하면 새로 띄운다. probe · attach 를 기다리므로 화면 스레드에서 부르지 않는다.
pub fn open(p: &Plugin, exe: &Path, v: &Vars) -> Result<()> {
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		let cwd = Path::new(&v.cwd);
		if !p.probe.is_empty() && !p.attach.is_empty() {
			let running = matches!(run_hidden(exe, &fill(&p.probe, v)?, cwd, PROBE_LIMIT, true), Ok(Some(true)));
			if running {
				// 아직 돌고 있으면 붙는 중으로 본다. 0 이 아닌 값으로 끝났으면 새로 띄운다.
				if let Ok(Some(true) | None) = run_hidden(exe, &fill(&p.attach, v)?, cwd, ATTACH_LIMIT, false) {
					return Ok(());
				}
			}
		}
		let args = fill(&p.launch, v)?;
		if p.host_wt && std::process::Command::new("wt.exe").arg("-d").arg(cwd).arg(exe).args(&args).spawn().is_ok() {
			return Ok(());
		}
		std::process::Command::new(exe)
			.args(&args)
			.current_dir(cwd)
			.creation_flags(CREATE_NEW_CONSOLE)
			.spawn()
			.map_err(|e| Error::Msg(format!("「{}」 을 띄우지 못했습니다: {e}", p.name)))?;
		Ok(())
	}
	#[cfg(not(windows))]
	{
		let _ = (p, exe, v);
		msg("이 운영체제에서는 플러그인으로 열지 못합니다. 명령을 복사해 쓰세요.")
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn vars() -> Vars {
		Vars { cwd: r"D:\my work\calc".into(), claude: r"C:\Program Files\claude.exe".into(), session: "abc-123".into(), title: "#4 더하기".into() }
	}

	#[test]
	fn fill_keeps_spaced_paths_as_one_arg() {
		let args: Vec<String> = ["--cwd", "{cwd}", "--", "{claude}", "--resume", "{session}", "name={title}"].iter().map(|s| s.to_string()).collect();
		let out = fill(&args, &vars()).unwrap();
		assert_eq!(out, vec!["--cwd", r"D:\my work\calc", "--", r"C:\Program Files\claude.exe", "--resume", "abc-123", "name=#4 더하기"]);
	}

	#[test]
	fn fill_rejects_unknown_and_leaves_other_braces() {
		assert!(fill(&["{sesion}".to_string()], &vars()).is_err());
		assert_eq!(fill(&[r#"{"a": 1} {}"#.to_string()], &vars()).unwrap(), vec![r#"{"a": 1} {}"#]);
		// 채운 값 안의 자리표시 꼴 글자는 다시 바꾸지 않는다.
		let v = Vars { cwd: "{session}".into(), ..vars() };
		assert_eq!(fill(&["{cwd}".to_string()], &v).unwrap(), vec!["{session}"]);
	}

	#[test]
	fn load_reports_problems_per_file() {
		let root = std::env::temp_dir().join(format!("docket-plugins-{}", crate::model::short_id()));
		let d = dir(&root);
		fs::create_dir_all(&d).unwrap();
		fs::write(d.join("a-broken.json"), "{ not json").unwrap();
		create_preset(&root, "herdr").unwrap();
		assert!(create_preset(&root, "herdr").is_err(), "있으면 덮지 않는다");
		let list = load(&root, &["herdr".to_string()]);
		assert_eq!(list.len(), 2);
		assert!(list[0].problem.starts_with("정의를 읽지 못했습니다"));
		assert_eq!(list[1].def.id, "herdr");
		assert!(list[1].enabled);
		fs::remove_dir_all(&root).unwrap();
	}
}
