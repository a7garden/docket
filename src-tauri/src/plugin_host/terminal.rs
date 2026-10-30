//! 터미널 기여: 「터미널에서 잇기」를 Windows 터미널 대신 바깥 프로그램으로 연다.
//!
//! 매니페스트의 `contributes.terminal`, 또는 옛 정의(`plugins/<id>.json`)의 본문이다.
//!
//! ```json
//! { "exe": "herdr", "probe": ["workspace", "list"], "focus": [], "attach": [["tab", "create"], ["…", "{out.result.root_pane.pane_id}"]],
//!   "launch": [], "hostWt": true, "attachAfterLaunch": true }
//! ```
//!
//! - 자리표시: {cwd} 프로젝트 폴더 · {claude} claude 실행 파일 · {session} 세션 ID · {session_short} 세션 ID 앞 8자 · {title} `#번호 제목`
//!   attach 의 둘째 단계부터는 {out.경로} 로 앞 단계가 낸 JSON 의 값을 받는다 (예: {out.result.root_pane.pane_id}).
//! - probe 가 0 으로 끝나면(이미 켜 둔 것이 있으면) focus 를 먼저 돌려 0 이면 거기서 끝내고, 아니면 attach 의 단계를 차례로 돌려 붙인다.
//!   켜 둔 것이 없거나 attach 첫 단계가 실패하면 launch 로 새로 띄운다. probe · attach 를 비우면 늘 launch 로 연다.
//! - attachAfterLaunch 를 켜면 launch 로 띄운 뒤 probe 가 0 이 될 때까지 기다렸다가 attach 를 돌린다.
//!   herdr 처럼 명령을 주어 띄우는 인자가 없는 프로그램도 띄운 다음 붙여 세션을 잇는다.
//! - attach 는 단계 하나를 `["a", "b"]` 로, 여럿을 `[["a"], ["b"]]` 로 적는다.
//! - 인자는 셸을 거치지 않고 배열 그대로 넘긴다. cmd.exe 를 거치면 경로 속 빈칸 · 기호가 깨진다.
//!
//! 구획: 정의 · 검사 · 자리표시 · 틀(herdr) · 열기 · 시험

use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result, msg};

const KNOWN: &[&str] = &["cwd", "claude", "session", "session_short", "title"];
/// 앞 단계 출력의 JSON 값을 받는 자리표시의 머리. attach 의 둘째 단계부터 쓴다.
const OUT: &str = "out.";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Terminal {
	/// 실행 파일. 이름만 적으면 PATH 에서 찾는다.
	pub exe: String,
	/// 이미 켜 둔 것이 있는지 묻는 인자. 0 으로 끝나면 있다고 본다.
	pub probe: Vec<String>,
	/// 켜 둔 것에 이 세션이 이미 떠 있으면 0 으로 끝나며 그리로 옮기는 인자. 같은 세션을 두 곳에서 이으면 대화가 갈라진다.
	pub focus: Vec<String>,
	/// 켜 둔 것에 새 창으로 붙이는 단계들. 하나면 `["a", "b"]` 로 적어도 된다.
	#[serde(deserialize_with = "steps")]
	pub attach: Vec<Vec<String>>,
	/// 새로 띄우는 인자
	pub launch: Vec<String>,
	/// launch 를 Windows 터미널 새 탭 안에서 띄운다. 화면이 있어야 도는 프로그램(TUI)은 창이 따로 없으면 바로 끝난다.
	pub host_wt: bool,
	/// launch 로 띄운 뒤 켜질 때까지 기다렸다가 attach 를 돌린다. 띄우는 인자로 명령을 줄 수 없는 프로그램에 쓴다.
	pub attach_after_launch: bool,
}

/// attach 를 `["a", "b"]`(한 단계) 로도 `[["a"], ["b"]]`(여러 단계) 로도 받는다. 단계가 하나뿐이던 옛 정의를 그대로 읽으려는 것이다.
fn steps<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Vec<Vec<String>>, D::Error> {
	#[derive(Deserialize)]
	#[serde(untagged)]
	enum Steps {
		Many(Vec<Vec<String>>),
		One(Vec<String>),
	}
	Ok(match Steps::deserialize(d)? {
		Steps::Many(v) => v,
		Steps::One(v) if v.is_empty() => Vec::new(),
		Steps::One(v) => vec![v],
	})
}

pub struct Vars {
	pub cwd: String,
	pub claude: String,
	pub session: String,
	pub title: String,
}

/// 앞 단계의 출력. 검사할 때는 무엇이 올지 모르므로 Any 로 두고 {out.…} 를 빈 값으로 채운다.
enum Out<'a> {
	None,
	Any,
	Json(&'a serde_json::Value),
}

impl Vars {
	fn get(&self, name: &str, out: &Out) -> Option<String> {
		if let Some(path) = name.strip_prefix(OUT) {
			return match out {
				Out::None => None,
				Out::Any => Some(String::new()),
				Out::Json(v) => match path.split('.').try_fold(*v, |v, k| v.get(k))? {
					serde_json::Value::String(s) => Some(s.clone()),
					serde_json::Value::Null | serde_json::Value::Object(_) | serde_json::Value::Array(_) => None,
					other => Some(other.to_string()),
				},
			};
		}
		match name {
			"cwd" => Some(self.cwd.clone()),
			"claude" => Some(self.claude.clone()),
			"session" => Some(self.session.clone()),
			// herdr 의 에이전트 이름처럼 짧은 영문 소문자 · 숫자만 받는 곳에 쓴다. 세션 ID 는 UUID 라 앞 8자로도 겹치지 않는다.
			"session_short" => Some(self.session.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect::<String>().to_ascii_lowercase()),
			"title" => Some(self.title.clone()),
			_ => None,
		}
	}
}

/* ---------- 검사 ---------- */

/// 쓸 수 없게 하는 문제. 비면 쓸 수 있다.
pub fn check(t: &Terminal, exe_found: bool) -> String {
	if t.exe.trim().is_empty() {
		return "exe 가 비어 있습니다".into();
	}
	if t.probe.is_empty() != t.attach.is_empty() {
		return "probe 와 attach 는 함께 적거나 함께 비웁니다".into();
	}
	if !t.focus.is_empty() && t.probe.is_empty() {
		return "focus 는 probe · attach 와 함께 씁니다".into();
	}
	if t.attach_after_launch && t.attach.is_empty() {
		return "attachAfterLaunch 는 probe · attach 와 함께 씁니다".into();
	}
	if t.attach.iter().any(|s| s.is_empty()) {
		return "attach 에 빈 단계가 있습니다".into();
	}
	let dummy = Vars { cwd: String::new(), claude: String::new(), session: String::new(), title: String::new() };
	// {out.…} 은 앞 단계가 있는 attach 의 둘째 단계부터만 쓴다.
	let plain = t.probe.iter().chain(&t.focus).chain(&t.launch).chain(t.attach.iter().take(1).flatten()).map(|a| (a, Out::None));
	let chained = t.attach.iter().skip(1).flatten().map(|a| (a, Out::Any));
	for (arg, out) in plain.chain(chained) {
		if let Err(name) = expand(arg, &dummy, &out) {
			return if name.starts_with(OUT) {
				format!("{{{name}}} 은 attach 의 둘째 단계부터 씁니다")
			} else {
				format!("모르는 자리표시입니다: {{{name}}} (쓸 수 있는 것: {} · attach 둘째 단계부터 {{out.경로}})", KNOWN.iter().map(|k| format!("{{{k}}}")).collect::<Vec<_>>().join(" "))
			};
		}
	}
	if !exe_found {
		return format!("실행 파일을 찾지 못했습니다: {} · 전체 경로를 적거나 PATH 에 넣으세요", t.exe);
	}
	String::new()
}

/// 쓸 수는 있으나 알아 둘 것
pub fn warning(t: &Terminal) -> String {
	let resumes = t.attach.iter().chain([&t.launch]).any(|a| a.iter().any(|s| s.contains("{session}")));
	if resumes {
		String::new()
	} else {
		"인자에 {session} 이 없어 claude 세션을 잇지 않고 프로그램만 엽니다. 프로그램 도움말에서 명령을 실행하는 인자를 찾아 launch 에 적으세요.".to_string()
	}
}

/// 이름만 적었으면 PATH 에서, 경로를 적었으면 그 자리에서 찾는다.
/// 확장자를 빼먹었으면 .exe · .cmd · .bat 를 붙여 본다. VS Code 의 `code` 처럼 PATH 에 .cmd 만 두는 프로그램이 있다.
pub fn resolve_exe(exe: &str) -> Option<PathBuf> {
	let exe = exe.trim();
	if exe.is_empty() {
		return None;
	}
	let p = PathBuf::from(exe);
	let names: Vec<PathBuf> =
		if p.extension().is_some() { vec![p.clone()] } else { vec![p.with_extension("exe"), p.with_extension("cmd"), p.with_extension("bat"), p.clone()] };
	if p.is_absolute() || p.components().count() > 1 {
		return names.into_iter().find(|n| n.is_file());
	}
	let path = std::env::var_os("PATH")?;
	let names = &names;
	std::env::split_paths(&path).flat_map(move |d| names.iter().map(move |n| d.join(n))).find(|c| c.is_file())
}

/* ---------- 자리표시 ---------- */

/// 자리표시를 한 번에 채운다. 차례로 replace 하면 채운 값(경로) 안의 `{session}` 같은 글자까지 다시 바뀐다.
/// 이름 꼴(영문 · 숫자 · _ · .)이 아닌 중괄호는 글자 그대로 둔다. 모르는 이름이면 그 이름을 돌려준다.
fn expand(arg: &str, v: &Vars, prev: &Out) -> std::result::Result<String, String> {
	let mut out = String::new();
	let mut rest = arg;
	while let Some(i) = rest.find('{') {
		out.push_str(&rest[..i]);
		let tail = &rest[i..];
		match tail.find('}') {
			Some(j) if j > 1 && tail[1..j].chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.') => {
				let name = &tail[1..j];
				out.push_str(&v.get(name, prev).ok_or_else(|| name.to_string())?);
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

fn fill_with(args: &[String], v: &Vars, prev: &Out) -> Result<Vec<String>> {
	args.iter()
		.map(|a| {
			expand(a, v, prev).map_err(|name| {
				Error::Msg(if name.starts_with(OUT) { format!("앞 단계의 출력에서 {{{name}}} 을 찾지 못했습니다") } else { format!("모르는 자리표시입니다: {{{name}}}") })
			})
		})
		.collect()
}

pub fn fill(args: &[String], v: &Vars) -> Result<Vec<String>> {
	fill_with(args, v, &Out::None)
}

/* ---------- 틀 ---------- */

fn args(a: &[&str]) -> Vec<String> {
	a.iter().map(|s| s.to_string()).collect()
}

/// herdr 틀. 2026-10-29 : herdr 0.9.5 의 `herdr --skill` · 묶음별 도움말을 보고, 따로 띄운 시험 세션에서 아래 명령을 돌려 확인했다.
/// - probe `workspace list` : 서버가 없으면 server_not_running 으로 1, 있으면 0.
/// - focus `agent focus docket-<세션 앞 8자>` : 이 세션의 claude 가 이미 떠 있으면 그 탭으로 옮기고 0. 없으면 agent_not_found 로 1.
///   먼저 보지 않으면 같은 이름의 agent start 가 agent_name_taken 으로 실패해 빈 탭만 남는다.
/// - attach ① `tab create --focus` 는 새 탭을 만들고 `.result.root_pane.pane_id` 를 돌려준다. 작업공간이 하나도 없으면 1 이다.
///   ② `agent start … --kind claude -- --resume` 은 그 패인의 셸에서 claude 를 띄운다. 패인 셸이 cmd · PowerShell 어느 것이든
///   따옴표를 herdr 가 다루고, herdr 가 claude 로 알아보아 상태를 보여 준다. 다만 claude 는 herdr 가 PATH 에서 찾는다 ({claude} 를 쓰지 않는다).
///   탭을 만들자마자 불러도 셸이 뜨기를 기다려 5초 남짓에 끝났다.
/// - launch 는 비운다. herdr 는 띄우는 인자로 명령을 받지 않는다 — 맨 `herdr` 로 화면을 띄우고 attachAfterLaunch 로 붙인다.
pub fn herdr() -> Terminal {
	Terminal {
		exe: "herdr".into(),
		probe: args(&["workspace", "list"]),
		focus: args(&["agent", "focus", "docket-{session_short}"]),
		attach: vec![
			args(&["tab", "create", "--cwd", "{cwd}", "--label", "{title}", "--focus"]),
			args(&["agent", "start", "docket-{session_short}", "--kind", "claude", "--pane", "{out.result.root_pane.pane_id}", "--", "--resume", "{session}"]),
		],
		launch: Vec::new(),
		host_wt: true,
		attach_after_launch: true,
	}
}

/* ---------- 열기 ---------- */

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
/// probe 가 이보다 오래 걸리면 켜 둔 것이 없다고 본다. 화면 명령이 오래 묶이지 않게 짧게 둔다.
#[cfg(windows)]
const PROBE_LIMIT: Duration = Duration::from_secs(3);
/// attach 의 마지막 단계가 이보다 오래 돌면 붙는 중으로 보고 기다리지 않는다.
#[cfg(windows)]
const ATTACH_LIMIT: Duration = Duration::from_secs(3);
/// attach 의 앞 단계는 끝나야 다음 단계에 출력을 넘긴다. 이보다 오래 걸리면 실패로 본다.
#[cfg(windows)]
const STEP_LIMIT: Duration = Duration::from_secs(10);
/// attachAfterLaunch 일 때 띄운 프로그램이 켜지기를 기다리는 시간. Windows 터미널 · herdr 서버가 처음 뜨는 데 몇 초 걸린다.
#[cfg(windows)]
const LAUNCH_WAIT: Duration = Duration::from_secs(20);

#[cfg(windows)]
pub struct Ran {
	pub ok: bool,
	pub code: Option<i32>,
	pub stdout: String,
	pub stderr: String,
}

/// 창 없이 돌려 끝나기를 잠깐 기다린다. 끝났으면 성공 여부와 출력, 아직 돌면 None.
/// 출력은 따로 읽어 둔다. 기다리기만 하면 출력이 파이프를 채운 프로그램이 멈춰 끝나지 않는다.
#[cfg(windows)]
pub fn run_hidden(exe: &Path, args: &[String], cwd: &Path, limit: Duration, kill_late: bool) -> std::io::Result<Option<Ran>> {
	use std::io::Read;
	use std::os::windows::process::CommandExt;
	use std::process::Stdio;
	let mut child = std::process::Command::new(exe)
		.args(args)
		.current_dir(cwd)
		.stdin(Stdio::null())
		.stdout(Stdio::piped())
		.stderr(Stdio::piped())
		.creation_flags(CREATE_NO_WINDOW)
		.spawn()?;
	fn drain(r: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
		std::thread::spawn(move || {
			let mut b = Vec::new();
			if let Some(mut r) = r {
				let _ = r.read_to_end(&mut b);
			}
			String::from_utf8_lossy(&b).into_owned()
		})
	}
	let (out, err) = (drain(child.stdout.take()), drain(child.stderr.take()));
	let until = Instant::now() + limit;
	loop {
		if let Some(s) = child.try_wait()? {
			return Ok(Some(Ran { ok: s.success(), code: s.code(), stdout: out.join().unwrap_or_default(), stderr: err.join().unwrap_or_default() }));
		}
		if Instant::now() >= until {
			if kill_late {
				let _ = child.kill();
			}
			// 두고 가는 프로그램의 출력은 읽는 스레드가 끝까지 받아 버린다.
			return Ok(None);
		}
		std::thread::sleep(Duration::from_millis(50));
	}
}

/// 실패한 명령이 남긴 말. herdr 처럼 `{"error":{"message":…}}` 를 내면 그 말만, 아니면 앞부분을 쓴다.
#[cfg(windows)]
fn reason(r: &Ran) -> String {
	let text = if r.stderr.trim().is_empty() { r.stdout.trim() } else { r.stderr.trim() };
	if let Some(m) = serde_json::from_str::<serde_json::Value>(text).ok().and_then(|j| j.pointer("/error/message").and_then(|m| m.as_str()).map(str::to_string)) {
		return m;
	}
	if text.is_empty() { "0 이 아닌 값으로 끝났습니다".into() } else { text.chars().take(300).collect() }
}

#[cfg(windows)]
fn succeeds(exe: &Path, args: &[String], cwd: &Path) -> bool {
	matches!(run_hidden(exe, args, cwd, PROBE_LIMIT, true), Ok(Some(r)) if r.ok)
}

#[cfg(windows)]
enum Attach {
	Done,
	/// 첫 단계가 실패했다. 아직 아무것도 만들지 않았으므로 새로 띄워 다시 해 볼 수 있다.
	NotStarted(String),
	/// 둘째 단계부터 실패했다. 앞 단계가 만든 것(빈 탭 등)이 남아 있으니 새로 띄우지 않고 알린다.
	Broken(String),
}

/// attach 의 단계를 차례로 돌린다. 앞 단계가 낸 JSON 을 다음 단계의 {out.…} 로 넘긴다.
#[cfg(windows)]
fn attach(t: &Terminal, exe: &Path, v: &Vars, cwd: &Path) -> Result<Attach> {
	let mut prev: Option<serde_json::Value> = None;
	for (i, step) in t.attach.iter().enumerate() {
		let last = i + 1 == t.attach.len();
		let out = prev.as_ref().map_or(Out::None, Out::Json);
		let args = fill_with(step, v, &out)?;
		let fail = |why: String| -> Result<Attach> { Ok(if i == 0 { Attach::NotStarted(why) } else { Attach::Broken(format!("{} 단계({}): {why}", i + 1, step.first().map_or("", |s| s.as_str()))) }) };
		// 마지막 단계는 붙는 동안 오래 돌 수 있다(herdr 의 agent start 는 claude 가 뜰 때까지 5초 남짓). 아직 돌면 붙는 중으로 본다.
		match run_hidden(exe, &args, cwd, if last { ATTACH_LIMIT } else { STEP_LIMIT }, !last) {
			Ok(None) if last => return Ok(Attach::Done),
			Ok(None) => return fail("응답이 없습니다".into()),
			Ok(Some(r)) if !r.ok => return fail(reason(&r)),
			Ok(Some(r)) => prev = serde_json::from_str(r.stdout.trim()).ok(),
			Err(e) => return fail(e.to_string()),
		}
	}
	Ok(Attach::Done)
}

/// 켜 둔 것이 있으면 붙이고, 없거나 붙이지 못하면 새로 띄운다. probe · attach 를 기다리므로 화면 스레드에서 부르지 않는다.
/// `name` 은 알림에 쓰는 플러그인 이름이다.
pub fn open(name: &str, t: &Terminal, exe: &Path, v: &Vars) -> Result<()> {
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		let cwd = Path::new(&v.cwd);
		let broken = |why: String| msg(format!("「{name}」 에 붙이다가 멈췄습니다 · {why}"));
		let probe = fill(&t.probe, v)?;
		if !t.probe.is_empty() && !t.attach.is_empty() && succeeds(exe, &probe, cwd) {
			if !t.focus.is_empty() && succeeds(exe, &fill(&t.focus, v)?, cwd) {
				return Ok(());
			}
			match attach(t, exe, v, cwd)? {
				Attach::Done => return Ok(()),
				Attach::Broken(why) => return broken(why),
				Attach::NotStarted(_) => {} // 켜 둔 것이 붙일 상태가 아니다(herdr 는 작업공간이 하나도 없을 때). 새로 띄운다.
			}
		}
		let args = fill(&t.launch, v)?;
		let in_wt = t.host_wt && std::process::Command::new("wt.exe").arg("-d").arg(cwd).arg(exe).args(&args).spawn().is_ok();
		if !in_wt {
			std::process::Command::new(exe)
				.args(&args)
				.current_dir(cwd)
				.creation_flags(CREATE_NEW_CONSOLE)
				.spawn()
				.map_err(|e| Error::Msg(format!("「{name}」 을 띄우지 못했습니다: {e}")))?;
		}
		if !t.attach_after_launch || t.attach.is_empty() {
			return Ok(());
		}
		// 띄운 것이 켜지고 붙일 자리(herdr 는 첫 작업공간)를 만들 때까지 첫 단계를 다시 해 본다.
		let until = Instant::now() + LAUNCH_WAIT;
		let mut why = "켜지지 않았습니다".to_string();
		while Instant::now() < until {
			std::thread::sleep(Duration::from_millis(500));
			if !succeeds(exe, &probe, cwd) {
				continue;
			}
			match attach(t, exe, v, cwd)? {
				Attach::Done => return Ok(()),
				Attach::Broken(w) => return broken(w),
				Attach::NotStarted(w) => why = w,
			}
		}
		msg(format!("「{name}」 을 띄웠지만 {}초 안에 세션을 붙이지 못했습니다 · {why} · 띄운 창에서 직접 이으세요", LAUNCH_WAIT.as_secs()))
	}
	#[cfg(not(windows))]
	{
		let _ = (name, t, exe, v);
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
	fn out_reads_previous_step_json() {
		let j: serde_json::Value = serde_json::from_str(r#"{"result":{"root_pane":{"pane_id":"w1:p2","n":3}}}"#).unwrap();
		let v = Vars { session: "AB-12cd-34ef-5678".into(), ..vars() };
		let args = vec!["--pane".to_string(), "{out.result.root_pane.pane_id}".into(), "{out.result.root_pane.n}".into(), "docket-{session_short}".into()];
		assert_eq!(fill_with(&args, &v, &Out::Json(&j)).unwrap(), vec!["--pane", "w1:p2", "3", "docket-ab12cd34"]);
		assert!(fill_with(&["{out.result.nope}".to_string()], &v, &Out::Json(&j)).is_err());
		assert!(fill(&["{out.result}".to_string()], &v).is_err(), "첫 단계에는 앞 출력이 없다");
	}

	#[test]
	fn herdr_preset_passes_check_and_resumes() {
		let t = herdr();
		assert_eq!(check(&t, true), "");
		assert_eq!(warning(&t), "");
		// {out.…} 을 첫 단계에 쓰면 잡는다.
		let bad = Terminal { attach: vec![vec!["{out.x}".into()]], ..herdr() };
		assert!(check(&bad, true).contains("둘째 단계"));
	}

	#[test]
	fn attach_reads_one_or_many_steps() {
		let one: Terminal = serde_json::from_str(r#"{"attach":["a","b"]}"#).unwrap();
		assert_eq!(one.attach, vec![vec!["a".to_string(), "b".into()]]);
		let many: Terminal = serde_json::from_str(r#"{"attach":[["a"],["b"]]}"#).unwrap();
		assert_eq!(many.attach.len(), 2);
		let none: Terminal = serde_json::from_str(r#"{"attach":[]}"#).unwrap();
		assert!(none.attach.is_empty());
	}
}
