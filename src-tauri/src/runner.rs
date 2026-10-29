//! Claude Code CLI 를 헤드리스(-p)로 돌려 계획 · 구현 · 문서 작성을 맡긴다.
//!
//! - 프롬프트는 표준 입력으로 넣는다. 인자로 넘기면 Windows 셸을 거칠 때 여러 줄 · 기호가 깨진다.
//! - 계획과 문서 작성은 읽기 도구(Read · Grep · Glob)만 열어 저장소를 고칠 수 없게 한다.
//! - 결과는 --json-schema 로 받는다. 화면이 계획 · 결과를 칸별로 보여 주려면 구조가 필요하다.
//! - 한 프로젝트 안의 구현 · 되돌리기 · 파일로 만드는 산출물은 줄에 선다. 두 구현이 같은 파일을 동시에 고치지 않게 한다.
//!   구현은 계획에 적힌 파일을 잡고, 겹치지 않으면 IMPL_SLOTS 개까지 함께 돈다. 근거가 애매하면 프로젝트 전체를 잡는다(Claims).
//!   계획 · 대화 · 마크다운 산출물은 줄을 기다리지 않고 프로젝트마다 READ_SLOTS 개까지 함께 돈다.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Notify;

use crate::error::{Error, Result, msg};
use crate::model::*;
use crate::store::{Store, settle};

/* ---------- 결과 형식 ---------- */

const PLAN_SCHEMA: &str = r#"{"type":"object","properties":{"title":{"type":"string"},"summary":{"type":"string"},"plan":{"type":"string"},"steps":{"type":"array","items":{"type":"object","properties":{"title":{"type":"string"},"detail":{"type":"string"},"files":{"type":"array","items":{"type":"string"}}},"required":["title","detail","files"]}},"files":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"change":{"type":"string"}},"required":["path","change"]}},"risks":{"type":"array","items":{"type":"string"}},"questions":{"type":"array","items":{"type":"object","properties":{"header":{"type":"string"},"question":{"type":"string"},"options":{"type":"array","items":{"type":"object","properties":{"label":{"type":"string"},"description":{"type":"string"},"recommended":{"type":"boolean"}},"required":["label","description"]}},"multi":{"type":"boolean"}},"required":["header","question","options"]}}},"required":["title","summary","plan","steps","files","risks","questions"]}"#;

const IMPL_SCHEMA: &str = r#"{"type":"object","properties":{"summary":{"type":"string"},"changed":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"what":{"type":"string"}},"required":["path","what"]}},"verification":{"type":"string"},"followups":{"type":"array","items":{"type":"string"}},"screenshots":{"type":"array","items":{"type":"object","properties":{"path":{"type":"string"},"caption":{"type":"string"}},"required":["path","caption"]}}},"required":["summary","changed","verification"]}"#;

/// skip · reason 은 자동 갱신이 「반영할 것이 없다」고 답하는 칸이다. 요청이 그렇게 시킬 때만 쓴다.
const DOC_SCHEMA: &str = r#"{"type":"object","properties":{"title":{"type":"string"},"document":{"type":"string"},"skip":{"type":"boolean"},"reason":{"type":"string"}},"required":["title","document"]}"#;

const FILE_SCHEMA: &str = r#"{"type":"object","properties":{"title":{"type":"string"},"summary":{"type":"string"},"files":{"type":"array","items":{"type":"string"}},"skip":{"type":"boolean"},"reason":{"type":"string"}},"required":["title","summary","files"]}"#;

/// 파일로 만들 때 저장소 안 편집을 막는다. cwd 가 저장소라 ./** 가 저장소 전체다. 산출물 폴더(--add-dir)는 걸리지 않는다.
/// 2026-10-28 실측: Edit 가 「denied by your permission settings」로 거부되고 --add-dir 폴더의 Write 는 통과했다.
const DENY_REPO_EDITS: &[&str] = &["Edit(./**)", "Write(./**)"];

const READ_ONLY_TOOLS: &str = "Read,Grep,Glob";

/// 계획 · 읽기 대화에 여는 버전 관리 조회 명령. 상태를 바꾸는 하위 명령은 넣지 않는다 (전역 지침의 SVN 읽기 전용 목록과 같다).
const VCS_READ: &[&str] = &[
	"Bash(git status:*)",
	"Bash(git log:*)",
	"Bash(git diff:*)",
	"Bash(git show:*)",
	"Bash(git blame:*)",
	"Bash(svn status:*)",
	"Bash(svn info:*)",
	"Bash(svn log:*)",
	"Bash(svn diff:*)",
	"Bash(svn cat:*)",
	"Bash(svn list:*)",
];

/// 「모두 허용」에서 묻지 않고 여는 도구. --dangerously-skip-permissions 를 쓰지 않는 까닭은 그 모드에서 거부 규칙이 지켜지는지
/// 확인할 수 없어서다. 이 목록으로 열면 일반 권한 판정 안에서 돌아 거부 규칙이 늘 앞선다 (2026-10-28 실측: Bash 를 열고
/// Bash(whoami) 를 거부하자 whoami 가 「rule」로 막혔다).
const ALL_TOOLS: &[&str] = &["Bash", "PowerShell", "WebFetch", "WebSearch", "Skill"];

/* ---------- 화면으로 보내는 실행 사건 ---------- */

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RunEvent {
	Init { model: String, session_id: String },
	Text { text: String },
	Tool { id: String, name: String, summary: String },
	ToolDone { id: String, ok: bool },
	Change { rel: String, kind: String, added: u32, removed: u32 },
	Denied { id: String, tool: String, target: String, reason: String, suggest: Vec<String> },
	Done { ok: bool, cost_usd: f64, duration_ms: u64, num_turns: u32, error: String },
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Envelope<'a> {
	project_id: &'a str,
	target: &'a str,
	target_id: &'a str,
	run_id: &'a str,
	event: &'a RunEvent,
}

pub fn emit_issue(app: &AppHandle, v: &IssueView) {
	let _ = app.emit("docket://issue", v);
}

pub fn emit_deliverable(app: &AppHandle, v: &DeliverableView) {
	let _ = app.emit("docket://deliverable", v);
}

/// 결정할 일이 생겼는데 창이 뒤에 있으면 작업 표시줄에서 깜빡인다.
fn attention(app: &AppHandle) {
	if let Some(w) = app.get_webview_window("main")
		&& !w.is_focused().unwrap_or(true) {
			let _ = w.request_user_attention(Some(tauri::UserAttentionType::Informational));
		}
}

/* ---------- stream-json 해석 ---------- */

fn rel_path(path: &str, root: &str) -> String {
	let p = path.replace('/', "\\");
	let r = root.replace('/', "\\");
	let r = r.trim_end_matches('\\');
	if p.len() > r.len() && p[..r.len()].eq_ignore_ascii_case(r) {
		p[r.len()..].trim_start_matches('\\').replace('\\', "/")
	} else {
		path.to_string()
	}
}

fn clip(s: &str, n: usize) -> String {
	let one: String = s.split_whitespace().collect::<Vec<_>>().join(" ");
	if one.chars().count() > n { format!("{}…", one.chars().take(n).collect::<String>()) } else { one }
}

fn summarize(name: &str, input: &Value, root: &str) -> String {
	let s = |k: &str| input.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
	let out = match name {
		"Read" | "Edit" | "Write" | "MultiEdit" => rel_path(&s("file_path"), root),
		"NotebookEdit" => rel_path(&s("notebook_path"), root),
		"Grep" => {
			let path = s("path");
			if path.is_empty() { s("pattern") } else { format!("{}  {}", s("pattern"), rel_path(&path, root)) }
		}
		"Glob" => s("pattern"),
		"Bash" | "PowerShell" => {
			let d = s("description");
			if d.is_empty() { s("command") } else { d }
		}
		"WebFetch" => s("url"),
		"WebSearch" => s("query"),
		"Task" | "Agent" => s("description"),
		"Skill" => {
			let k = s("skill");
			if k.is_empty() { s("command") } else { k }
		}
		_ => String::new(),
	};
	clip(&out, 160)
}

fn change_from(name: &str, r: &Value, root: &str, run_id: &str) -> Option<FileChange> {
	if !matches!(name, "Edit" | "Write" | "MultiEdit") {
		return None;
	}
	let path = r.get("filePath")?.as_str()?.to_string();
	let kind = if name == "Write" { r.get("type").and_then(|v| v.as_str()).unwrap_or("update").to_string() } else { "edit".into() };
	let mut hunks: Vec<Hunk> = r.get("structuredPatch").and_then(|p| serde_json::from_value(p.clone()).ok()).unwrap_or_default();
	// 새 파일은 패치가 비어 온다. 내용 전체를 더한 줄로 보여 준다.
	if hunks.is_empty()
		&& let Some(content) = r.get("content").and_then(|v| v.as_str()) {
			let lines: Vec<String> = content.lines().map(|l| format!("+{l}")).collect();
			hunks.push(Hunk { old_start: 0, old_lines: 0, new_start: 1, new_lines: lines.len() as u32, lines });
		}
	Some(FileChange { rel: rel_path(&path, root), path, kind, hunks, run_id: run_id.to_string(), at: now_ms() })
}

pub fn count_lines(c: &FileChange) -> (u32, u32) {
	let mut add = 0;
	let mut del = 0;
	for l in c.hunks.iter().flat_map(|h| h.lines.iter()) {
		if l.starts_with('+') {
			add += 1;
		} else if l.starts_with('-') {
			del += 1;
		}
	}
	(add, del)
}

/* ---------- 권한 ---------- */

fn denial_target(tool: &str, input: &Value, root: &str) -> String {
	let s = |k: &str| input.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
	match tool {
		"Bash" | "PowerShell" => s("command"),
		"Read" | "Edit" | "Write" | "MultiEdit" => rel_path(&s("file_path"), root),
		"NotebookEdit" => rel_path(&s("notebook_path"), root),
		"WebFetch" => s("url"),
		"WebSearch" => s("query"),
		_ => summarize(tool, input, root),
	}
}

/// 하위 명령까지 하나로 묶어야 뜻이 서는 명령. `git log` 를 허용하면서 `git push` 까지 열리지 않게 두 낱말로 끊는다.
const TWO_WORD: &[&str] = &["git", "svn", "npm", "pnpm", "yarn", "npx", "cargo", "go", "dotnet", "mvn", "gradle", "python", "py", "pip", "uv", "docker", "kubectl"];

/// 막힌 호출을 다음부터 통과시킬 허용 규칙 후보. 명령은 && · ; · | 로 이은 것을 나눠 앞머리마다 하나씩 낸다.
/// cd 는 뺀다 — 작업 폴더를 옮길 뿐이고, 허용하면 뒤에 붙은 명령과 섞여 뜻이 흐려진다.
pub fn suggest_rules(tool: &str, input: &Value, root: &str) -> Vec<String> {
	let mut out: Vec<String> = Vec::new();
	match tool {
		"Bash" | "PowerShell" => {
			let cmd = input.get("command").and_then(|v| v.as_str()).unwrap_or("");
			for seg in cmd.split(['&', ';', '|']).map(str::trim).filter(|s| !s.is_empty()) {
				let words: Vec<&str> = seg.split_whitespace().filter(|w| !w.contains('=') || w.starts_with('-')).collect();
				let Some(first) = words.first() else { continue };
				if *first == "cd" || *first == "Set-Location" {
					continue;
				}
				let head = match words.get(1) {
					Some(second) if TWO_WORD.contains(first) && !second.starts_with('-') && !second.starts_with('"') => format!("{first} {second}"),
					_ => first.to_string(),
				};
				let rule = format!("{tool}({head}:*)");
				if !out.contains(&rule) {
					out.push(rule);
				}
			}
		}
		"WebFetch" => {
			let url = input.get("url").and_then(|v| v.as_str()).unwrap_or("");
			if let Some(host) = url.split("://").nth(1).and_then(|r| r.split('/').next()).filter(|h| !h.is_empty()) {
				out.push(format!("WebFetch(domain:{host})"));
			}
		}
		"Read" | "Edit" | "Write" | "MultiEdit" => {
			let rel = rel_path(input.get("file_path").and_then(|v| v.as_str()).unwrap_or(""), root);
			if !rel.is_empty() {
				out.push(format!("{tool}({rel})"));
			}
		}
		_ if !tool.is_empty() => out.push(tool.to_string()),
		_ => {}
	}
	out
}

/// 한 실행의 권한. 인자를 짜는 곳과 실행 기록을 남기는 곳이 같은 값을 쓰도록 여기서만 정한다.
struct Perms {
	/// 쓸 수 있는 도구를 이것으로 묶는다. None 이면 CLI 기본 도구 전부
	tools: Option<String>,
	/// 늘 적는다. 적지 않으면 사용자 전역 설정의 기본 모드(auto 등)를 따라 열어 두지 않은 명령까지 통과할 수 있다.
	mode: &'static str,
	allow: Vec<String>,
	deny: Vec<String>,
	label: String,
}

fn read_perms(p: &Project) -> Perms {
	let (tools, allow, label) = if p.plan_vcs_read {
		(format!("{READ_ONLY_TOOLS},Bash"), VCS_READ.iter().map(|s| s.to_string()).collect(), "읽기 · 이력 조회")
	} else {
		(READ_ONLY_TOOLS.to_string(), Vec::new(), "읽기 전용")
	};
	Perms { tools: Some(tools), mode: "default", allow, deny: p.denied_tools.clone(), label: label.into() }
}

fn edit_perms(p: &Project, all: bool, once: bool) -> Perms {
	let mut allow: Vec<String> = if all { ALL_TOOLS.iter().map(|s| s.to_string()).collect() } else { Vec::new() };
	allow.extend(p.allowed_tools.iter().cloned());
	let label = match (all, once) {
		(true, true) => "모두 허용 · 이번만",
		(true, false) => "모두 허용",
		_ => "편집 · 허용 목록",
	};
	Perms { tools: None, mode: "acceptEdits", allow, deny: p.denied_tools.clone(), label: label.into() }
}

fn job_perms(job: &Job, p: &Project) -> Perms {
	let all = p.impl_mode == "bypassPermissions";
	match job {
		Job::Plan { .. } | Job::Chat { edit: false, .. } => read_perms(p),
		Job::Implement { allow_all, .. } | Job::Rework { allow_all, .. } => edit_perms(p, all || *allow_all, !all && *allow_all),
		_ => edit_perms(p, all, false),
	}
}

/// --allowedTools 는 값을 여럿 받으므로 뒤에 곧바로 다른 플래그가 와야 한다. 거부 목록은 --settings 로 건다.
/// 사용자 전역 · 저장소 설정의 규칙도 CLI 가 함께 읽어 합친다.
fn perm_args(a: &mut Vec<String>, perms: &Perms, extra_deny: &[&str]) {
	if let Some(t) = &perms.tools {
		a.extend(["--tools".into(), t.clone()]);
	}
	a.extend(["--permission-mode".into(), perms.mode.into()]);
	if !perms.allow.is_empty() {
		a.push("--allowedTools".into());
		a.extend(perms.allow.iter().cloned());
	}
	let deny: Vec<&str> = perms.deny.iter().map(String::as_str).chain(extra_deny.iter().copied()).collect();
	if !deny.is_empty() {
		a.extend(["--settings".into(), serde_json::json!({ "permissions": { "deny": deny } }).to_string()]);
	}
}

pub struct Parser {
	root: String,
	run_id: String,
	tools: HashMap<String, String>,
	inputs: HashMap<String, Value>,
	pub session_id: String,
	pub model: String,
	pub changes: Vec<FileChange>,
	pub result: Option<Value>,
	pub commands: Vec<String>,
	pub denials: Vec<Denial>,
}

impl Parser {
	pub fn new(root: &str, run_id: &str) -> Self {
		Self {
			root: root.to_string(),
			run_id: run_id.to_string(),
			tools: HashMap::new(),
			inputs: HashMap::new(),
			session_id: String::new(),
			model: String::new(),
			changes: Vec::new(),
			result: None,
			commands: Vec::new(),
			denials: Vec::new(),
		}
	}

	pub fn feed(&mut self, v: &Value) -> Vec<RunEvent> {
		let mut out = Vec::new();
		let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
		// 하위 에이전트의 내부 대화는 접어 둔다. 바깥 도구 호출 하나로 보인다.
		let nested = v.get("parent_tool_use_id").map(|x| !x.is_null()).unwrap_or(false);
		match t {
			"system" if v.get("subtype").and_then(|x| x.as_str()) == Some("init") => {
				self.session_id = v.get("session_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
				self.model = v.get("model").and_then(|x| x.as_str()).unwrap_or("").to_string();
				out.push(RunEvent::Init { model: self.model.clone(), session_id: self.session_id.clone() });
			}
			// 권한으로 막힌 호출. 도구 결과에는 「거부됨」 한 줄만 오므로 무엇을 왜 막았는지는 이 사건에서 읽는다.
			"system" if v.get("subtype").and_then(|x| x.as_str()) == Some("permission_denied") && !nested => {
				let id = v.get("tool_use_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
				let tool = v.get("tool_name").and_then(|x| x.as_str()).map(String::from).or_else(|| self.tools.get(&id).cloned()).unwrap_or_default();
				let input = self.inputs.get(&id).cloned().unwrap_or(Value::Null);
				let reason = if v.get("decision_reason_type").and_then(|x| x.as_str()) == Some("rule") { "rule" } else { "ask" };
				let d = Denial { target: denial_target(&tool, &input, &self.root), suggest: suggest_rules(&tool, &input, &self.root), tool, reason: reason.into() };
				out.push(RunEvent::Denied { id, tool: d.tool.clone(), target: d.target.clone(), reason: d.reason.clone(), suggest: d.suggest.clone() });
				self.denials.push(d);
			}
			"assistant" if !nested => {
				let content = v.pointer("/message/content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
				for c in content {
					match c.get("type").and_then(|x| x.as_str()) {
						Some("text") => {
							// 대화 답 끝의 단계 · 메모 표지는 앱이 읽는 신호다. 화면에는 걷어 내고 보인다. 메모 본문은 무엇을 등록했는지 보이게 남긴다.
							let text = memo_blocks(&stage_mark(c.get("text").and_then(|x| x.as_str()).unwrap_or("")).0).0;
							if !text.is_empty() {
								out.push(RunEvent::Text { text });
							}
						}
						Some("tool_use") => {
							let id = c.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
							let name = c.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
							let input = c.get("input").cloned().unwrap_or(Value::Null);
							let summary = summarize(&name, &input, &self.root);
							self.tools.insert(id.clone(), name.clone());
							if matches!(name.as_str(), "Bash" | "PowerShell")
								&& let Some(cmd) = input.get("command").and_then(|x| x.as_str()) {
									self.commands.push(cmd.to_string());
								}
							self.inputs.insert(id.clone(), input);
							out.push(RunEvent::Tool { id, name, summary });
						}
						_ => {}
					}
				}
			}
			"user" if !nested => {
				let content = v.pointer("/message/content").and_then(|c| c.as_array()).cloned().unwrap_or_default();
				for c in content.iter().filter(|c| c.get("type").and_then(|x| x.as_str()) == Some("tool_result")) {
					let id = c.get("tool_use_id").and_then(|x| x.as_str()).unwrap_or("").to_string();
					let ok = !c.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false);
					if ok {
						let name = self.tools.get(&id).cloned().unwrap_or_default();
						if let Some(r) = v.get("tool_use_result")
							&& let Some(ch) = change_from(&name, r, &self.root, &self.run_id) {
								let (added, removed) = count_lines(&ch);
								out.push(RunEvent::Change { rel: ch.rel.clone(), kind: ch.kind.clone(), added, removed });
								self.changes.push(ch);
							}
					}
					out.push(RunEvent::ToolDone { id, ok });
				}
			}
			"result" => {
				let ok = !v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false)
					&& v.get("subtype").and_then(|x| x.as_str()) == Some("success");
				let error = if ok {
					String::new()
				} else {
					v.get("result")
						.and_then(|x| x.as_str())
						.filter(|s| !s.is_empty())
						.or_else(|| v.get("subtype").and_then(|x| x.as_str()))
						.unwrap_or("실패")
						.to_string()
				};
				out.push(RunEvent::Done {
					ok,
					cost_usd: v.get("total_cost_usd").and_then(|x| x.as_f64()).unwrap_or(0.0),
					duration_ms: v.get("duration_ms").and_then(|x| x.as_u64()).unwrap_or(0),
					num_turns: v.get("num_turns").and_then(|x| x.as_u64()).unwrap_or(0) as u32,
					error,
				});
				self.result = Some(v.clone());
			}
			_ => {}
		}
		out
	}

	fn structured(&self) -> Option<Value> {
		let r = self.result.as_ref()?;
		if let Some(s) = r.get("structured_output").filter(|s| s.is_object()) {
			return Some(s.clone());
		}
		// 구조화 결과가 빠졌을 때는 result 글이 JSON 인지 본다.
		r.get("result").and_then(|x| x.as_str()).and_then(|s| serde_json::from_str::<Value>(s).ok()).filter(|v| v.is_object())
	}

	fn result_text(&self) -> String {
		self.result.as_ref().and_then(|r| r.get("result")).and_then(|x| x.as_str()).unwrap_or("").to_string()
	}
}

/// 대화로 설계가 정해졌을 때 Claude 가 답 맨 끝에 다는 줄. 뒤에 제목을 붙일 수 있다.
const STAGE_MARK: &str = "[단계:설계]";

/// 답에서 단계 표지 줄을 걷어 낸다. 표지가 있었으면 그 뒤에 붙은 제목(없으면 빈 글)을 함께 돌려준다.
fn stage_mark(text: &str) -> (String, Option<String>) {
	let mut title = None;
	let kept: Vec<&str> = text
		.lines()
		.filter(|l| {
			let t = l.trim().trim_matches('`').trim();
			match t.strip_prefix(STAGE_MARK) {
				Some(rest) => {
					title = Some(rest.trim().to_string());
					false
				}
				None => true,
			}
		})
		.collect();
	(kept.join("\n").trim().to_string(), title)
}

/// 프로젝트 대화에서 사용자가 작업 메모로 남기라고 했을 때 Claude 가 답에 내는 블록의 여는 줄과 닫는 줄. 여는 줄 뒤에 제목이 온다.
const MEMO_MARK: &str = "[메모:등록]";
const MEMO_END: &str = "[/메모]";

/// 답에서 메모 블록을 꺼내고 표지 줄을 걷어 낸다. 본문 줄은 답에 그대로 남긴다.
/// 닫는 줄이 없는 블록은 등록하지 않는다. 중간에 끊긴 답으로 반쪽 메모가 생기지 않게 하려는 것이다.
fn memo_blocks(text: &str) -> (String, Vec<(String, String)>) {
	let mut blocks = Vec::new();
	let mut open: Option<(String, Vec<&str>)> = None;
	let mut kept: Vec<&str> = Vec::new();
	for l in text.lines() {
		let t = l.trim().trim_matches('`').trim();
		if let Some(rest) = t.strip_prefix(MEMO_MARK) {
			open = Some((rest.trim().to_string(), Vec::new()));
			continue;
		}
		if t == MEMO_END {
			if let Some((title, body)) = open.take() {
				let body = body.join("\n").trim().to_string();
				let title = if title.is_empty() { crate::store::title_of(&body) } else { title };
				if !title.is_empty() || !body.is_empty() {
					blocks.push((title, body));
				}
			}
			continue;
		}
		if let Some((_, body)) = open.as_mut() {
			body.push(l);
		}
		kept.push(l);
	}
	(kept.join("\n").trim().to_string(), blocks)
}

/// 저장된 실행 기록을 화면에서 다시 펼칠 때 쓴다. 실시간과 같은 해석기를 거친다.
pub fn replay(path: &Path, root: &str) -> Result<Vec<RunEvent>> {
	let text = std::fs::read_to_string(path)?;
	let mut p = Parser::new(root, "");
	let mut out = Vec::new();
	for line in text.lines() {
		if let Ok(v) = serde_json::from_str::<Value>(line) {
			out.extend(p.feed(&v));
		}
	}
	Ok(out)
}

/* ---------- 세션 기록 (터미널에서 이은 대화) ---------- */

/// Claude Code 가 남기는 세션 기록(~/.claude/projects/<폴더>/<세션>.jsonl) 의 한 차례. 사용자 글 하나와 그 뒤의 답이다.
/// 앱의 실행 기록에는 앱이 돌린 차례만 있다. 터미널에서 이어 간 말은 이 기록에서만 보인다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
	pub at: i64,
	pub prompt: String,
	pub events: Vec<RunEvent>,
	/// 이 차례에 Claude 가 고친 파일. 화면에는 change 사건으로 이미 보이고, 이슈의 변경에 옮겨 담을 때만 쓴다.
	#[serde(skip)]
	pub changes: Vec<FileChange>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
	pub id: String,
	pub modified: i64,
	pub turns: u32,
	pub last_prompt: String,
}

/// 세션 기록 폴더 이름은 작업 폴더 경로의 영숫자 밖 글자를 - 로 바꾼 것이다 (D:\a\_b → D--a--b).
fn transcripts_dir(cwd: &str) -> PathBuf {
	let name: String = cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
	crate::claude_files::claude_home().join("projects").join(name)
}

fn valid_session_id(sid: &str) -> bool {
	!sid.is_empty() && sid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// 폴더 이름 규칙은 CLI 판마다 바뀔 수 있다. 정한 자리에 없으면 모든 프로젝트 폴더에서 찾는다.
pub fn transcript_path(cwd: &str, sid: &str) -> Option<PathBuf> {
	if !valid_session_id(sid) {
		return None;
	}
	let file = format!("{sid}.jsonl");
	let p = transcripts_dir(cwd).join(&file);
	if p.is_file() {
		return Some(p);
	}
	std::fs::read_dir(crate::claude_files::claude_home().join("projects"))
		.ok()?
		.filter_map(|e| e.ok())
		.map(|e| e.path().join(&file))
		.find(|p| p.is_file())
}

fn stamp(v: &Value) -> i64 {
	v.get("timestamp")
		.and_then(|x| x.as_str())
		.and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
		.map(|d| d.timestamp_millis())
		.unwrap_or(0)
}

/// 사람이 친 글만 꺼낸다. 도구 결과 · 슬래시 명령 · 명령 출력 · 시스템 알림(< 로 시작한다)은 대화가 아니다.
fn user_text(v: &Value) -> Option<String> {
	let text = match v.pointer("/message/content")? {
		Value::String(s) => s.clone(),
		Value::Array(a) => {
			if a.iter().any(|c| c.get("type").and_then(|x| x.as_str()) == Some("tool_result")) {
				return None;
			}
			a.iter()
				.filter(|c| c.get("type").and_then(|x| x.as_str()) == Some("text"))
				.filter_map(|c| c.get("text").and_then(|x| x.as_str()))
				.collect::<Vec<_>>()
				.join("\n")
		}
		_ => return None,
	};
	let t = text.trim();
	(!t.is_empty() && !t.starts_with('<') && !t.starts_with("Caveat:")).then(|| t.to_string())
}

pub fn read_turns(path: &Path, root: &str) -> Result<Vec<Turn>> {
	let text = std::fs::read_to_string(path)?;
	let mut p = Parser::new(root, "");
	let mut turns: Vec<Turn> = Vec::new();
	for line in text.lines() {
		let Ok(mut v) = serde_json::from_str::<Value>(line) else { continue };
		let flag = |k: &str| v.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
		// 하위 에이전트의 대화와 CLI 가 끼워 넣은 글은 접는다. 실시간 해석기도 하위 에이전트를 접는다.
		if flag("isSidechain") || flag("isMeta") {
			continue;
		}
		match v.get("type").and_then(|x| x.as_str()) {
			Some("user") => {
				if let Some(prompt) = user_text(&v) {
					turns.push(Turn { at: stamp(&v), prompt, events: Vec::new(), changes: Vec::new() });
					continue;
				}
			}
			Some("assistant") => {}
			_ => continue,
		}
		// 세션 기록은 도구 결과를 toolUseResult 로 적는다. 실시간 해석기가 읽는 이름으로 옮긴다.
		if let Some(r) = v.get("toolUseResult").cloned() {
			v["tool_use_result"] = r;
		}
		let before = p.changes.len();
		let evs = p.feed(&v);
		// 다시 읽어도 같은 변경이 같은 이름을 갖도록 기록 줄의 uuid 로 이름을 붙인다. 이슈에 두 번 담기지 않게 하는 열쇠다.
		let line_id = v.get("uuid").and_then(|x| x.as_str()).unwrap_or("").to_string();
		let at = stamp(&v);
		for (n, c) in p.changes[before..].iter_mut().enumerate() {
			c.run_id = format!("{TERMINAL_RUN}{line_id}-{n}");
			c.at = at;
		}
		if let Some(t) = turns.last_mut() {
			t.events.extend(evs);
			t.changes.extend(p.changes[before..].iter().cloned());
		}
	}
	Ok(turns)
}

/// 터미널에서 고친 변경의 run_id 머리. 화면은 이것으로 「터미널」에서 온 변경을 가린다.
pub const TERMINAL_RUN: &str = "terminal-";

/// 터미널에서 이어 간 차례가 고친 파일을 이슈의 변경에 담는다. 담은 것이 있으면 true.
/// 앱이 돌린 실행은 이미 그때그때 담았으니, 호출하는 쪽이 그 시간대의 차례를 걸러서 넘긴다.
/// 이슈를 만들기 전 · 마지막으로 되돌린 뒤보다 앞선 변경은 담지 않는다. 담으면 고른 세션의 옛 작업이나 되돌린 변경이 다시 살아난다.
/// 단계는 앱 대화와 같이 옮긴다 — 고친 것이 있으면 결과 확인으로. 실행 중이면 단계는 그 실행이 정한다.
pub fn absorb_terminal(i: &mut Issue, turns: &[Turn]) -> bool {
	let cutoff = i.history.iter().filter(|h| h.kind == "reverted").map(|h| h.at).fold(i.created_at, i64::max);
	let mut last: Option<&Turn> = None;
	for t in turns {
		for c in &t.changes {
			if c.at <= cutoff || i.changes.iter().any(|x| x.run_id == c.run_id) {
				continue;
			}
			i.changes.push(c.clone());
			last = Some(t);
		}
	}
	let Some(t) = last else { return false };
	i.changes.sort_by_key(|c| c.at);
	if i.run.is_none() && i.status != Status::Review {
		let summary = t
			.events
			.iter()
			.rev()
			.find_map(|e| if let RunEvent::Text { text } = e { Some(text.clone()) } else { None })
			.unwrap_or_default();
		i.result = Some(ImplResult { summary, created_at: now_ms(), run_id: String::new(), ..Default::default() });
		i.status = Status::Review;
		i.log("implemented", "터미널에서 고침");
	}
	true
}

/// 같은 프로젝트 폴더에서 최근에 쓴 세션들. 터미널에서 이으며 세션 ID 가 바뀌었을 때 사용자가 골라 다시 잡는다.
pub fn recent_sessions(cwd: &str, limit: usize) -> Vec<SessionInfo> {
	let Ok(rd) = std::fs::read_dir(transcripts_dir(cwd)) else { return Vec::new() };
	let mut files: Vec<(PathBuf, i64)> = rd
		.filter_map(|e| e.ok())
		.map(|e| e.path())
		.filter(|p| p.extension().map(|x| x == "jsonl").unwrap_or(false))
		.filter_map(|p| {
			let t = p.metadata().ok()?.modified().ok()?;
			let ms = t.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64;
			Some((p, ms))
		})
		.collect();
	files.sort_by_key(|(_, t)| std::cmp::Reverse(*t));
	files
		.into_iter()
		.take(limit)
		.filter_map(|(p, modified)| {
			let text = std::fs::read_to_string(&p).ok()?;
			let prompts: Vec<String> = text
				.lines()
				.filter_map(|l| serde_json::from_str::<Value>(l).ok())
				.filter(|v| v.get("type").and_then(|x| x.as_str()) == Some("user") && !v.get("isSidechain").and_then(|x| x.as_bool()).unwrap_or(false))
				.filter_map(|v| user_text(&v))
				.collect();
			Some(SessionInfo {
				id: p.file_stem()?.to_string_lossy().to_string(),
				modified,
				turns: prompts.len() as u32,
				last_prompt: prompts.last().map(|s| clip(s, 120)).unwrap_or_default(),
			})
		})
		.filter(|s| s.turns > 0)
		.collect()
}

/* ---------- claude 실행 파일 ---------- */

/// npm 으로 깔면 PATH 에는 claude.cmd 만 보인다. .cmd 는 cmd.exe 를 거쳐 인자가 깨지므로 그 옆의 실제 exe 를 찾는다.
pub fn resolve_claude(setting: &str) -> Option<PathBuf> {
	let from_shim = |dir: &Path| {
		let exe = dir.join("node_modules").join("@anthropic-ai").join("claude-code").join("bin").join("claude.exe");
		exe.is_file().then_some(exe)
	};
	let setting = setting.trim();
	if !setting.is_empty() {
		let p = PathBuf::from(setting);
		if p.extension().map(|e| e.eq_ignore_ascii_case("cmd")).unwrap_or(false) {
			return p.parent().and_then(from_shim);
		}
		return p.is_file().then_some(p);
	}
	let exe_name = if cfg!(windows) { "claude.exe" } else { "claude" };
	if let Some(path) = std::env::var_os("PATH") {
		for dir in std::env::split_paths(&path) {
			let exe = dir.join(exe_name);
			if exe.is_file() {
				return Some(exe);
			}
			if dir.join("claude.cmd").is_file()
				&& let Some(exe) = from_shim(&dir) {
					return Some(exe);
				}
		}
	}
	let mut known = Vec::new();
	if let Some(h) = dirs::home_dir() {
		known.push(h.join(".local").join("bin").join(exe_name));
		known.push(h.join(".claude").join("local").join(exe_name));
	}
	if let Some(d) = dirs::data_dir()
		&& let Some(exe) = from_shim(&d.join("npm")) {
			known.push(exe);
		}
	known.into_iter().find(|p| p.is_file())
}

fn command(exe: &Path) -> tokio::process::Command {
	let mut cmd = tokio::process::Command::new(exe);
	#[cfg(windows)]
	cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW · 실행할 때마다 콘솔 창이 뜨지 않게
	cmd
}

pub async fn claude_version(exe: &Path) -> String {
	let out = command(exe).arg("--version").output().await;
	match out {
		Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
		Err(_) => String::new(),
	}
}

/// 이슈 세션을 터미널에서 잇는다. 세션 기록은 폴더별로 저장되므로 프로젝트 폴더에서 띄워야 찾는다.
/// 켠 터미널 플러그인이 있으면 그 정의대로 연다(켜 둔 것에 붙이거나 새로 띄운다 · plugins::open).
/// 없으면 Windows 터미널이 있을 때 새 탭으로, 없을 때 새 콘솔 창으로 띄운다.
pub fn open_terminal(exe: &Path, cwd: &Path, session_id: &str, plugin: Option<(&crate::plugins::Plugin, &Path)>, title: &str) -> Result<()> {
	if !cwd.is_dir() {
		return msg(format!("프로젝트 폴더를 찾을 수 없습니다: {}", cwd.display()));
	}
	if let Some((p, plugin_exe)) = plugin {
		let vars = crate::plugins::Vars {
			cwd: cwd.to_string_lossy().to_string(),
			claude: exe.to_string_lossy().to_string(),
			session: session_id.to_string(),
			title: title.to_string(),
		};
		return crate::plugins::open(p, plugin_exe, &vars);
	}
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		let wt = std::process::Command::new("wt.exe").arg("-d").arg(cwd).arg(exe).args(["--resume", session_id]).spawn();
		if wt.is_err() {
			std::process::Command::new(exe)
				.args(["--resume", session_id])
				.current_dir(cwd)
				.creation_flags(0x0000_0010) // CREATE_NEW_CONSOLE
				.spawn()?;
		}
		Ok(())
	}
	#[cfg(not(windows))]
	{
		let _ = (exe, session_id);
		msg("이 운영체제에서는 터미널을 띄우지 못합니다. 명령을 복사해 쓰세요.")
	}
}

/// 앱이 어떻게 끝나든 claude 를 함께 끈다. 창을 닫으면 앱이 소멸자를 거치지 않고 끝나 kill_on_drop 이 돌 틈이 없고,
/// Windows 는 부모가 끝나도 자식을 끄지 않는다. 그러면 claude 가 혼자 남아 앱이 모르는 수정을 저장소에 남긴다.
/// 닫히면 안의 프로세스를 모두 끄는 작업 개체에 claude 만 넣는다. claude 가 띄우는 셸 · 하위 프로세스도 따라 들어간다.
/// 앱 자신은 넣지 않는다. 넣으면 앱이 띄운 터미널 · 탐색기 · 문서 프로그램까지 앱과 함께 꺼진다.
/// 작업 개체 핸들은 닫지 않는다. 앱 프로세스가 끝날 때 운영체제가 닫고, 그때 안의 프로세스가 끝난다.
#[cfg(windows)]
fn bind_to_app(child: &tokio::process::Child) {
	use std::sync::OnceLock;
	use windows_sys::Win32::Foundation::HANDLE;
	use windows_sys::Win32::System::JobObjects::{
		AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
		JobObjectExtendedLimitInformation, SetInformationJobObject,
	};
	static JOB: OnceLock<usize> = OnceLock::new();
	let job = *JOB.get_or_init(|| unsafe {
		let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
		if h.is_null() {
			return 0;
		}
		let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
		info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
		let ok = SetInformationJobObject(h, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of_val(&info) as u32);
		if ok == 0 { 0 } else { h as usize }
	});
	if job == 0 {
		eprintln!("작업 개체를 만들지 못해 앱이 닫혀도 claude 가 남을 수 있음");
		return;
	}
	if let Some(p) = child.raw_handle()
		&& unsafe { AssignProcessToJobObject(job as HANDLE, p as HANDLE) } == 0
	{
		eprintln!("claude 를 작업 개체에 넣지 못함");
	}
}

#[cfg(not(windows))]
fn bind_to_app(_child: &tokio::process::Child) {}

/* ---------- 실행 제어 ---------- */

pub struct RunCtl {
	cancel: AtomicBool,
	notify: Notify,
}

impl RunCtl {
	fn new() -> Self {
		Self { cancel: AtomicBool::new(false), notify: Notify::new() }
	}

	fn cancelled(&self) -> bool {
		self.cancel.load(Ordering::SeqCst)
	}

	async fn wait_cancel(&self) {
		while !self.cancelled() {
			self.notify.notified().await;
		}
	}
}

/// 줄 밖에서 한 프로젝트가 함께 돌리는 실행 수.
/// 2026.10.28 : 3. 자동 계획이 메모를 한꺼번에 띄워도 사용량이 예측되게 묶는다.
const READ_SLOTS: usize = 3;

/// 파일이 겹치지 않아 함께 도는 구현의 상한.
/// 2026.10.29 : 2. 한 저장소에서 빌드 · 테스트 명령이 겹치는 부담을 줄이려고 낮게 잡았다.
const IMPL_SLOTS: usize = 2;

/// 실행이 잡고 도는 차례. 실행이 끝나 놓아야 다음 실행이 들어온다.
enum Seat {
	Claim(#[allow(dead_code)] ClaimGuard),
	Slot(#[allow(dead_code)] tokio::sync::OwnedSemaphorePermit),
}

/// 줄에 서는 실행이 잡는 범위. 구현끼리 같은 파일을 함께 고치지 않게 하려는 것이다.
#[derive(Clone)]
struct Claim {
	key: String,
	/// 기다리는 쪽에 보일 이름 (#12 · 산출물 제목)
	label: String,
	/// 저장소 기준 파일 경로. None 이면 프로젝트 전체 — 지금 도는 모든 실행과 겹친다.
	files: Option<Vec<String>>,
	/// 함께 돌 수 있는 프로젝트인데 전체를 잡은 까닭. 기다리는 문구에 붙인다.
	solo: String,
}

#[derive(Default)]
struct Book {
	seq: u64,
	held: Vec<Claim>,
	/// 먼저 선 차례대로. 겹치는 것끼리는 앞선 것이 먼저 들어간다 — 뒤에 온 작은 구현이 큰 것을 계속 앞지르지 않게 한다.
	waiting: Vec<(u64, Claim)>,
}

/// 프로젝트마다 잡힌 범위와 기다리는 줄.
#[derive(Default)]
struct Claims {
	books: Mutex<HashMap<String, Book>>,
	/// 잡은 것이 풀리거나 줄에서 빠지면 기다리는 쪽을 모두 깨운다. 저마다 다시 따져 보고 안 되면 또 기다린다.
	freed: Notify,
}

fn norm_path(p: &str) -> String {
	p.trim().replace('\\', "/").trim_start_matches("./").trim_end_matches('/').to_lowercase()
}

/// 같은 파일이거나 한쪽이 다른 쪽 폴더 아래다. Windows 라 대소문자는 가리지 않는다.
fn path_overlap(a: &str, b: &str) -> bool {
	let (a, b) = (norm_path(a), norm_path(b));
	a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

/// 두 범위가 겹치는 경로. 한쪽이 전체를 잡았으면 빈 글, 겹치지 않으면 None.
fn shared(a: &Claim, b: &Claim) -> Option<String> {
	let (Some(x), Some(y)) = (&a.files, &b.files) else { return Some(String::new()) };
	x.iter().find_map(|f| y.iter().any(|g| path_overlap(f, g)).then(|| f.clone()))
}

fn wait_text(me: &Claim, label: &str, path: &str) -> String {
	let mut s = if path.is_empty() { format!("앞선 작업을 기다림 · {label}") } else { format!("파일이 겹쳐 기다림 · {label} · {path}") };
	if !me.solo.is_empty() {
		s.push_str(&format!(" · {}", me.solo));
	}
	s
}

impl Claims {
	fn enqueue(&self, pid: &str, claim: Claim) -> u64 {
		let mut books = self.books.lock().unwrap();
		let book = books.entry(pid.to_string()).or_default();
		book.seq += 1;
		let seq = book.seq;
		book.waiting.push((seq, claim));
		seq
	}

	fn leave(&self, pid: &str, seq: u64) {
		if let Some(book) = self.books.lock().unwrap().get_mut(pid) {
			book.waiting.retain(|(s, _)| *s != seq);
		}
		self.freed.notify_waiters();
	}

	/// 들어갈 수 있으면 잡는다. 아니면 무엇을 기다리는지 돌려준다.
	fn try_take(&self, pid: &str, seq: u64) -> std::result::Result<(), String> {
		let mut books = self.books.lock().unwrap();
		let book = books.entry(pid.to_string()).or_default();
		let Some(at) = book.waiting.iter().position(|(s, _)| *s == seq) else { return Ok(()) };
		let me = &book.waiting[at].1;
		if let Some(c) = book.held.iter().find_map(|c| shared(c, me).map(|p| (c, p))) {
			return Err(wait_text(me, &c.0.label, &c.1));
		}
		if me.files.is_some() && book.held.len() >= IMPL_SLOTS {
			return Err(format!("함께 도는 구현이 {IMPL_SLOTS}개라 기다림"));
		}
		if let Some(c) = book.waiting[..at].iter().find(|(_, c)| shared(c, me).is_some()) {
			return Err(wait_text(me, &c.1.label, ""));
		}
		let (_, me) = book.waiting.remove(at);
		book.held.push(me);
		Ok(())
	}

	fn free(&self, pid: &str, key: &str) {
		if let Some(book) = self.books.lock().unwrap().get_mut(pid) {
			book.held.retain(|c| c.key != key);
		}
		self.freed.notify_waiters();
	}

	/// 다른 실행이 잡고 있는 파일. 이번 실행이 고치지 못하게 거부 규칙으로 건다.
	fn others(&self, pid: &str, key: &str) -> Vec<String> {
		let books = self.books.lock().unwrap();
		let Some(book) = books.get(pid) else { return Vec::new() };
		book.held.iter().filter(|c| c.key != key).filter_map(|c| c.files.clone()).flatten().collect()
	}

	/// 이 실행이 고친 파일. 다른 실행이 잡고 있으면 그 이름을 돌려주고, 아니면 이 실행이 잡은 범위에 더한다.
	/// 계획에 없던 파일도 잡아야 뒤에 오는 구현이 그 파일을 피해 간다.
	fn touch(&self, pid: &str, key: &str, rel: &str) -> Option<String> {
		let mut books = self.books.lock().unwrap();
		let book = books.get_mut(pid)?;
		if let Some(c) = book.held.iter().find(|c| c.key != key && c.files.as_ref().is_some_and(|f| f.iter().any(|f| path_overlap(f, rel)))) {
			return Some(c.label.clone());
		}
		if !Path::new(rel).is_absolute()
			&& let Some(files) = book.held.iter_mut().find(|c| c.key == key).and_then(|c| c.files.as_mut())
			&& !files.iter().any(|f| norm_path(f) == norm_path(rel))
		{
			files.push(rel.to_string());
		}
		None
	}
}

/// 잡은 범위를 놓는다. 실행이 끝나든 · 멈추든 · 오류로 빠지든 놓아야 그 프로젝트의 줄이 멈추지 않는다.
struct ClaimGuard {
	claims: Arc<Claims>,
	pid: String,
	key: String,
}

impl Drop for ClaimGuard {
	fn drop(&mut self) {
		self.claims.free(&self.pid, &self.key);
	}
}

#[derive(Default)]
pub struct Runner {
	/// 구현 · 되돌리기 · 파일로 만드는 산출물이 잡는 범위
	claims: Arc<Claims>,
	/// 줄 밖 실행의 자리. 프로젝트마다 READ_SLOTS 개.
	slots: Mutex<HashMap<String, Arc<tokio::sync::Semaphore>>>,
	active: Mutex<HashMap<String, Arc<RunCtl>>>,
	/// 제목을 짓고 있는 이슈. 실행 줄 · 「실행 중」 목록과는 따로 센다. 도구 없이 글 한 줄만 받는 짧은 호출이다.
	titling: Mutex<HashSet<String>>,
}

impl Runner {
	fn project_slots(&self, pid: &str) -> Arc<tokio::sync::Semaphore> {
		self.slots.lock().unwrap().entry(pid.to_string()).or_insert_with(|| Arc::new(tokio::sync::Semaphore::new(READ_SLOTS))).clone()
	}
	fn register(&self, key: &str) -> Arc<RunCtl> {
		let ctl = Arc::new(RunCtl::new());
		self.active.lock().unwrap().insert(key.to_string(), ctl.clone());
		ctl
	}

	fn release(&self, key: &str) {
		self.active.lock().unwrap().remove(key);
	}

	/// 앱을 닫기 전에 부른다. 실행 중인 것과 줄 서 있는 것을 모두 멈춘다. 멈춘 수를 돌려준다.
	pub fn stop_all(&self) -> usize {
		let active = self.active.lock().unwrap();
		for ctl in active.values() {
			ctl.cancel.store(true, Ordering::SeqCst);
			ctl.notify.notify_one();
		}
		active.len()
	}

	/// notify_one 은 기다리는 쪽이 아직 없어도 허가를 남긴다. 줄 서 있던 작업도 바로 깨어난다.
	pub fn stop(&self, key: &str) -> bool {
		match self.active.lock().unwrap().get(key) {
			Some(ctl) => {
				ctl.cancel.store(true, Ordering::SeqCst);
				ctl.notify.notify_one();
				true
			}
			None => false,
		}
	}
}

/// 차례를 기다린다. claim 이 있으면 그 범위를 잡고, 없으면 READ_SLOTS 자리 하나를 받는다.
/// 기다리는 까닭이 바뀔 때마다 on_wait 로 알린다. 기다리는 동안 중지되면 None. 그래야 「줄에서 빼기」가 바로 먹는다.
async fn wait_turn(claims: Arc<Claims>, slots: Arc<tokio::sync::Semaphore>, pid: &str, claim: Option<Claim>, ctl: &RunCtl, on_wait: impl Fn(&str)) -> Option<Seat> {
	let Some(claim) = claim else {
		return tokio::select! {
			p = slots.acquire_owned() => p.ok().map(Seat::Slot),
			_ = ctl.wait_cancel() => None,
		};
	};
	let key = claim.key.clone();
	let seq = claims.enqueue(pid, claim);
	let mut last = String::new();
	loop {
		// 따져 보기 전에 깨울 허가를 먼저 걸어 둔다. 따지는 사이에 풀린 것을 놓치면 다음 풀림까지 멈춘다.
		let freed = claims.freed.notified();
		tokio::pin!(freed);
		freed.as_mut().enable();
		match claims.try_take(pid, seq) {
			Ok(()) => return Some(Seat::Claim(ClaimGuard { claims: claims.clone(), pid: pid.to_string(), key })),
			Err(why) if why != last => {
				on_wait(&why);
				last = why;
			}
			Err(_) => {}
		}
		tokio::select! {
			_ = &mut freed => {}
			_ = ctl.wait_cancel() => {
				claims.leave(pid, seq);
				return None;
			}
		}
	}
}

/// 구현이 잡을 범위. 함께 돌 근거가 없으면 프로젝트 전체를 잡고 그 까닭을 solo 에 둔다.
fn issue_claim(job: &Job, i: &Issue, p: &Project, key: &str) -> Claim {
	let (files, solo) = match claim_files(job, i, p) {
		Ok(f) => (Some(f), ""),
		Err(why) => (None, why),
	};
	Claim { key: key.to_string(), label: format!("#{}", i.number), files, solo: solo.to_string() }
}

/// 함께 돌 수 있으면 잡을 파일(저장소 기준)을, 아니면 한 줄로 서는 까닭을 돌려준다. 끈 프로젝트는 까닭을 비운다.
/// 근거는 계획에 적힌 파일과 이미 고친 파일이다. 애매하면 한 줄로 세운다 — 판정이 틀리면 두 구현이 한 파일을 함께 고친다.
fn claim_files(job: &Job, i: &Issue, p: &Project) -> std::result::Result<Vec<String>, &'static str> {
	if !p.parallel_impl {
		return Err("");
	}
	// 「모두 허용」은 명령으로도 파일을 쓸 수 있어 거부 규칙이 닿지 않는다.
	if p.impl_mode == "bypassPermissions" || matches!(job, Job::Implement { allow_all: true, .. } | Job::Rework { allow_all: true, .. }) {
		return Err("모두 허용이라 한 줄로 섬");
	}
	let mut raw: Vec<&str> = Vec::new();
	if !matches!(job, Job::Revert)
		&& let Some(plan) = &i.plan
	{
		raw.extend(plan.files.iter().map(|f| f.path.as_str()));
		raw.extend(plan.steps.iter().flat_map(|s| s.files.iter().map(String::as_str)));
	}
	raw.extend(i.changes.iter().map(|c| c.rel.as_str()));
	let root = p.path.replace('\\', "/");
	let root = root.trim_end_matches('/');
	let mut out: Vec<String> = Vec::new();
	for r in raw {
		let f = r.trim().replace('\\', "/");
		if f.is_empty() {
			continue;
		}
		// 저장소 안 전체 경로는 저장소 기준으로 바꾼다. get 으로 잘라 한글 경로의 글자 가운데를 자르지 않는다.
		let f = if Path::new(&f).is_absolute() {
			match f.get(..root.len()) {
				Some(head) if head.eq_ignore_ascii_case(root) && f[root.len()..].starts_with('/') => f[root.len() + 1..].to_string(),
				_ => return Err("저장소 밖 파일이 있어 한 줄로 섬"),
			}
		} else {
			f.trim_start_matches("./").to_string()
		};
		if f.split('/').any(|s| s == "..") {
			return Err("저장소 밖 파일이 있어 한 줄로 섬");
		}
		if f.ends_with('/') || f.contains(['*', '?', '[']) || Path::new(&p.path).join(&f).is_dir() {
			return Err("계획에 폴더가 있어 한 줄로 섬");
		}
		if !out.iter().any(|o| norm_path(o) == norm_path(&f)) {
			out.push(f);
		}
	}
	if out.is_empty() {
		return Err("계획에 바꿀 파일이 없어 한 줄로 섬");
	}
	Ok(out)
}

pub fn issue_key(pid: &str, iid: &str) -> String {
	format!("issue:{pid}/{iid}")
}

pub fn doc_key(pid: &str, did: &str) -> String {
	format!("doc:{pid}/{did}")
}

struct Spec {
	exe: PathBuf,
	cwd: PathBuf,
	args: Vec<String>,
	prompt: String,
	log: PathBuf,
	root: String,
	run_id: String,
}

struct Outcome {
	ok: bool,
	stopped: bool,
	error: String,
	parser: Parser,
}

async fn exec(spec: Spec, ctl: &RunCtl, mut emit: impl FnMut(&RunEvent, &Parser)) -> Outcome {
	let mut parser = Parser::new(&spec.root, &spec.run_id);
	let fail = |parser: Parser, error: String| Outcome { ok: false, stopped: false, error, parser };

	if !spec.cwd.is_dir() {
		return fail(parser, format!("프로젝트 폴더를 찾을 수 없습니다: {}", spec.cwd.display()));
	}
	let mut cmd = command(&spec.exe);
	cmd.args(&spec.args)
		.current_dir(&spec.cwd)
		.stdin(std::process::Stdio::piped())
		.stdout(std::process::Stdio::piped())
		.stderr(std::process::Stdio::piped())
		.kill_on_drop(true);
	let mut child = match cmd.spawn() {
		Ok(c) => c,
		Err(e) => return fail(parser, format!("claude 를 실행하지 못했습니다: {e}")),
	};
	bind_to_app(&child);

	if let Some(mut stdin) = child.stdin.take() {
		let _ = stdin.write_all(spec.prompt.as_bytes()).await;
		let _ = stdin.shutdown().await;
	}
	let stdout = child.stdout.take().unwrap();
	let mut stderr = child.stderr.take().unwrap();
	let stderr_task = tokio::spawn(async move {
		let mut buf = Vec::new();
		let _ = stderr.read_to_end(&mut buf).await;
		String::from_utf8_lossy(&buf).to_string()
	});

	if let Some(d) = spec.log.parent() {
		let _ = tokio::fs::create_dir_all(d).await;
	}
	let mut log = tokio::fs::File::create(&spec.log).await.ok();
	let mut lines = BufReader::new(stdout).lines();
	let mut stopped = ctl.cancelled();

	while !stopped {
		tokio::select! {
			line = lines.next_line() => match line {
				Ok(Some(l)) => {
					if let Some(f) = log.as_mut() {
						let _ = f.write_all(l.as_bytes()).await;
						let _ = f.write_all(b"\n").await;
					}
					if let Ok(v) = serde_json::from_str::<Value>(&l) {
						// 구독 사용률은 실행 하나가 아니라 앱 전체의 것이라 Parser 를 거치지 않고 따로 넘긴다.
						if v.get("type").and_then(|x| x.as_str()) == Some("rate_limit_event") {
							crate::usage::record(&v);
						}
						for ev in parser.feed(&v) {
							emit(&ev, &parser);
						}
					}
				}
				_ => break,
			},
			_ = ctl.wait_cancel() => {
				stopped = true;
			}
		}
	}
	if stopped {
		let _ = child.start_kill();
	}
	let code = tokio::time::timeout(Duration::from_secs(10), child.wait()).await.ok().and_then(|r| r.ok());
	let stderr_text = tokio::time::timeout(Duration::from_secs(2), stderr_task).await.ok().and_then(|r| r.ok()).unwrap_or_default();
	if let Some(mut f) = log {
		let _ = f.flush().await;
	}

	if stopped {
		return Outcome { ok: false, stopped: true, error: String::new(), parser };
	}
	let tail = |s: &str| {
		let s = s.trim();
		let n = s.chars().count();
		s.chars().skip(n.saturating_sub(1200)).collect::<String>()
	};
	let verdict = parser.result.as_ref().map(|r| {
		!r.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false) && r.get("subtype").and_then(|x| x.as_str()) == Some("success")
	});
	match verdict {
		Some(true) => Outcome { ok: true, stopped: false, error: String::new(), parser },
		Some(false) => {
			// 결과 형식을 끝내 못 맞춘 경우처럼 result 글 없이 errors 배열에만 까닭을 싣고 끝날 때가 있다. 빈 오류로 띄우지 않는다.
			let t = parser.result_text();
			let errors = parser.result.as_ref().and_then(|r| r.get("errors")).and_then(|e| e.as_array()).map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join("\n")).unwrap_or_default();
			let error = [t, errors, tail(&stderr_text)].into_iter().find(|s| !s.trim().is_empty()).unwrap_or_else(|| {
				parser.result.as_ref().and_then(|r| r.get("subtype")).and_then(|x| x.as_str()).unwrap_or("실패").to_string()
			});
			fail(parser, error)
		}
		None => {
			let code = code.and_then(|c| c.code()).map(|c| c.to_string()).unwrap_or_else(|| "?".into());
			let err = tail(&stderr_text);
			fail(parser, if err.is_empty() { format!("Claude 가 결과 없이 끝났습니다 (종료 코드 {code})") } else { err })
		}
	}
}

/* ---------- 프롬프트 ---------- */

const RULES: &str = "\
## 지킬 것
- 저장소의 CLAUDE.md · AGENTS.md 와 그 안에서 가리키는 규칙을 따른다.
- 이 메모나 메모를 관리하는 도구를 저장소 안 파일 · 주석 · 문서에 언급하지 않는다. 계획서나 메모 파일을 저장소에 만들지 않는다.
- 커밋 · push · SVN 쓰기 같은 버전 관리 명령을 실행하지 않는다. 커밋은 사용자가 한다.";

fn note_block(v: &IssueView) -> String {
	let mut s = format!("## 메모 #{}\n\n{}\n", v.issue.number, v.note.trim());
	if !v.attachments.is_empty() {
		s.push_str("\n## 첨부\n메모의 `attachments/…` 는 아래 파일이다. 이미지는 Read 도구로 열어 본다.\n");
		for a in &v.attachments {
			s.push_str(&format!("- {}\n", Path::new(&v.dir).join("attachments").join(a).display()));
		}
	}
	s
}

fn plan_block(p: &Plan) -> String {
	let mut s = format!("## 승인된 계획: {}\n\n{}\n\n{}\n", p.title, p.summary, p.plan);
	if !p.steps.is_empty() {
		s.push_str("\n순서\n");
		for (n, st) in p.steps.iter().enumerate() {
			s.push_str(&format!("{}. {}\n", n + 1, st.title));
			if !st.detail.trim().is_empty() {
				s.push_str(&format!("   {}\n", st.detail.trim().replace('\n', "\n   ")));
			}
		}
	}
	if !p.files.is_empty() {
		s.push_str("\n바꿀 파일\n");
		for f in &p.files {
			s.push_str(&format!("- {} : {}\n", f.path, f.change));
		}
	}
	s
}

const PLAN_FORMAT: &str = "\
## 계획에 담을 것
- title: 이슈를 한 줄로 (40자 안팎)
- summary: 무엇을 왜 바꾸는지 두세 문장
- steps: 구현 순서. 단계마다 title(무엇을 하는지 한 줄) · detail(어떻게 · 왜. 마크다운 두세 줄, 확인한 코드 위치는 `경로:행`) · files(그 단계에서 손대는 파일)
- plan: 마크다운. 단계에 담기지 않는 배경 · 가정 · 고른 접근과 그 까닭을 짧게. 단계를 다시 늘어놓지 않는다.
- files: 바꾸거나 만들 파일(저장소 기준 상대 경로)과 바꿀 내용 한 줄
- risks: 깨질 수 있는 것과 구현 뒤 확인할 것
- questions: 사용자가 정해야 진행할 수 있는 것. 없으면 빈 배열. 질문마다
  header(12자 안팎의 꼬리표) · question(물음표로 끝나는 한 문장) · options(고를 답 2~4개. label 은 짧게, description 은 고르면 무엇이 달라지는지) · multi(여럿을 함께 고를 수 있으면 true).
  권하는 답이 있으면 그 하나에만 recommended 를 true 로 단다. 사용자가 선택지 밖의 답을 직접 적을 수 있으니 「기타」 선택지는 넣지 않는다.

메모가 모호하면 코드에서 가장 그럴듯한 해석을 고르고 그 가정을 plan 에 적는다.";

/// 화면은 마크다운의 ```html · ```svg 블록을 미리 보기로 그린다. 사용자가 글만 읽고 화면 설계를 판단하기 어려워서다.
/// 백엔드만 고치는 계획에까지 넣으면 계획이 길어지고 비용만 는다. 그래서 화면이 바뀔 때로 좁힌다.
const VISUAL_RULE: &str = "\
## 그림 · 목업
- 화면 · 배치 · 흐름이 바뀌는 설계일 때만 그림을 함께 낸다. 백엔드 · 내부 로직만 바뀌면 넣지 않는다.
- 화면 목업은 마크다운 ```html 코드 블록 하나로 낸다. 화면이 블록을 그대로 미리 보기로 그린다. 한 덩어리 HTML 에 style 을 안에 두고, 외부 파일 · 글꼴 · 네트워크 요청은 쓰지 않는다. 스크립트는 돌아가니 탭 전환 · 펼치기 같은 동작도 보일 수 있다. 바뀌기 전과 뒤를 나란히 두면 판단하기 쉽다. 짧게 유지한다.
- 미리 보기는 앱의 밝은 · 어두운 테마를 따른다. HTML 은 바탕색과 글자색을 둘 다 정하거나 둘 다 비워 둔다. 하나만 정하면 다른 테마에서 글자가 묻힌다.
- 흐름도 · 구조도는 ```svg 코드 블록으로 낸다. 선 · 글자는 `currentColor` 로 칠하거나 바탕 사각형을 함께 그린다. 검정을 박아 두면 어두운 테마에서 보이지 않는다.
- 저장소에 있는 그림을 보여 줄 때는 `![설명](절대 경로)` 로 건다.";

/// 프로젝트 대화에서 묻다가 바로 일감을 남기게 한다. 앱은 블록만 보고 보드에 메모를 만든다.
/// 시키지 않았는데 블록을 내면 원치 않는 메모가 생기므로 「남기라고 할 때만」을 앞에 둔다.
const MEMO_RULE: &str = "\
## 작업 메모로 남기기
- 사용자가 작업 메모(이슈)로 남기라고 할 때만, 마지막 답의 맨 끝에 아래 꼴의 블록을 낸다. 앱이 블록마다 보드에 새 메모를 만든다. 묻고 답하는 중이면 내지 않는다.

    [메모:등록] <한 줄 제목>
    <메모 본문>
    [/메모]

- 여는 줄과 닫는 줄은 들여쓰지 않고 코드 블록으로 감싸지 않는다. 여럿을 남기라고 하면 블록을 여럿 낸다.
- 메모는 이 대화를 이어받지 않고 새로 계획된다. 본문에는 이 대화를 모르는 사람이 읽고 계획할 수 있게 무엇을 왜 바꾸려는지, 대화에서 정한 것, 확인한 코드 위치(`경로:행`)를 담는다.
- 대화에 첨부한 그림이 필요하면 본문에 그 전체 경로를 적는다.";

/// 구현 결과에 결과 화면을 남긴다. 찍기 방법은 저장소마다 달라 Claude 가 고른다. 저장소를 어지르지 않는 선만 정해 준다.
fn shot_rule(v: &IssueView) -> String {
	let dir = Path::new(&v.dir).join("shots");
	format!(
		"## 결과 화면
- 화면 · 배치 · 흐름이 바뀐 구현일 때만 찍는다. 백엔드 · 내부 로직만 바꿨으면 찍지 않는다.
- 찍은 그림은 {} 폴더에 png 로 둔다. 무엇을 찍었는지 알 수 있는 이름을 붙인다.
- 방법은 고른다. 저장소에 이미 있는 E2E 도구(playwright 등) · `npx playwright screenshot <주소> <파일>` · 설치가 필요 없는 `msedge --headless --screenshot=<파일> --window-size=1280,800 <주소>` · 정적 화면이면 HTML 을 `file:///` 로 연다. 로그인 · 클릭이 필요하면 임시 스크립트를 시스템 임시 폴더에 쓰고 끝나면 지운다.
- 찍으려고 저장소에 의존성 · 설정 · 시험 파일을 더하지 않는다. 직접 띄운 서버는 끝날 때 끈다. 계정이 필요한 화면은 계정을 추측하거나 설정 파일에서 꺼내 쓰지 않는다.
- 결과에는 screenshots 에 그림마다 path(전체 경로)와 caption(무엇을 보여 주는지 한 줄)을 넣는다. 대화로 답할 때는 답에 `![설명](전체 경로)` 로 건다.
- 찍지 못했으면 까닭을 verification 에 적는다. 권한이 없어 막힌 명령이 있으면 무엇이 왜 필요했는지도 적는다.",
		dir.display()
	)
}

enum Job {
	Plan { feedback: Option<String> },
	/// allow_all: 프로젝트 설정과 상관없이 이번 실행만 「모두 허용」으로 돈다.
	Implement { instruction: Option<String>, allow_all: bool },
	Rework { feedback: String, allow_all: bool },
	/// edit 를 켜면 구현과 같은 권한으로 돈다. 끄면 읽기 도구만 연다. images 는 이슈 첨부 폴더 안의 이름이다.
	Chat { text: String, edit: bool, images: Vec<String> },
	/// 구현과 같은 권한 · 결과 형식으로 돈다. 되돌린 결과도 구현 결과처럼 받아 흐름에 남긴다.
	Revert,
}

impl Job {
	fn kind(&self) -> RunKind {
		match self {
			Job::Plan { .. } => RunKind::Plan,
			Job::Chat { .. } => RunKind::Chat,
			Job::Revert => RunKind::Revert,
			_ => RunKind::Implement,
		}
	}

	/// 프로젝트 줄에 서는가. 줄은 구현끼리 같은 파일을 함께 고치지 않게 하려는 것이다.
	/// 2026.10.28 : 대화는 편집 권한이어도 줄 밖에서 돈다. 구현 중에도 바로 답하게 하려고, 함께 고칠 위험을 받아들였다.
	/// 2026.10.29 : 줄은 프로젝트 전체가 아니라 계획에 적힌 파일을 잡는다(issue_claim). 겹치지 않으면 IMPL_SLOTS 개까지 함께 돈다.
	fn exclusive(&self) -> bool {
		matches!(self, Job::Implement { .. } | Job::Rework { .. } | Job::Revert)
	}

	/// 실행 기록에 남길 사용자 글. 대화만 남긴다. 나머지는 흐름(history)에 이미 있다.
	fn prompt(&self) -> &str {
		match self {
			Job::Chat { text, .. } => text,
			_ => "",
		}
	}
}

fn issue_prompt(job: &Job, v: &IssueView, resumed: bool) -> String {
	match job {
		Job::Plan { feedback: None } => format!(
			"아래 메모는 사용자가 포스트잇처럼 적어 둔 개발 이슈다. 이 저장소의 코드를 읽고 구현 계획을 세워라. \
			이번 단계에서는 파일을 고치지 않는다 (읽기 도구만 열려 있다).\n\n{}\n{PLAN_FORMAT}\n\n{VISUAL_RULE}\n\n{RULES}\n",
			note_block(v)
		),
		Job::Plan { feedback: Some(f) } if resumed => format!(
			"사용자가 계획을 보고 의견을 남겼다. 의견을 반영해 계획을 다시 세워 같은 형식으로 낸다. 파일은 고치지 않는다.\n\n## 의견\n{f}\n"
		),
		Job::Plan { feedback: Some(f) } => {
			let prev = v.issue.plan.as_ref().map(plan_block).unwrap_or_default().replacen("승인된 계획", "지난 계획", 1);
			format!(
				"아래 메모로 세운 계획에 사용자가 의견을 남겼다. 코드를 다시 확인하고 의견을 반영해 계획을 새로 세워라. 파일은 고치지 않는다.\n\n{}\n{prev}\n## 의견\n{f}\n\n{PLAN_FORMAT}\n\n{VISUAL_RULE}\n\n{RULES}\n",
				note_block(v)
			)
		}
		Job::Implement { instruction, .. } => {
			let extra = instruction.as_deref().filter(|s| !s.trim().is_empty()).map(|s| format!("\n## 덧붙인 지시\n{s}\n")).unwrap_or_default();
			let head = if resumed {
				"사용자가 위 계획을 승인했다. 계획대로 구현하라.".to_string()
			} else {
				format!(
					"사용자가 아래 메모와 계획을 승인했다. 코드를 확인하고 계획대로 구현하라.\n\n{}\n{}",
					note_block(v),
					v.issue.plan.as_ref().map(plan_block).unwrap_or_default()
				)
			};
			format!("{head}\n{extra}\n{IMPL_FORMAT}\n\n{}\n\n{RULES}\n", shot_rule(v))
		}
		Job::Rework { feedback, .. } => {
			let head = if resumed {
				"사용자가 구현 결과를 보고 고칠 것을 남겼다. 반영하라.".to_string()
			} else {
				let mut s = format!(
					"아래 메모와 계획으로 구현한 결과를 사용자가 보고 고칠 것을 남겼다. 지금 코드를 확인하고 반영하라.\n\n{}\n{}",
					note_block(v),
					v.issue.plan.as_ref().map(plan_block).unwrap_or_default()
				);
				if !v.issue.changes.is_empty() {
					s.push_str("\n## 지난 구현에서 바꾼 파일\n");
					for c in &v.issue.changes {
						s.push_str(&format!("- {}\n", c.rel));
					}
				}
				s
			};
			format!("{head}\n\n## 고칠 것\n{feedback}\n\n{IMPL_FORMAT}\n\n{}\n\n{RULES}\n", shot_rule(v))
		}
		Job::Revert => {
			let head = if resumed {
				"사용자가 이 이슈에서 네가 바꾼 것을 모두 되돌리기로 했다.".to_string()
			} else {
				format!("아래 메모로 구현한 변경을 사용자가 모두 되돌리기로 했다.\n\n{}", note_block(v))
			};
			format!("{head}\n\n{}\n{IMPL_FORMAT}\n\n{RULES}\n", revert_block(&v.issue.changes))
		}
		Job::Chat { text, edit, images } => {
			let mut mode = String::new();
			if !images.is_empty() {
				mode.push_str("\n\n(첨부한 파일 — Read 도구로 열어 본다)\n");
				for a in images {
					mode.push_str(&format!("- {}\n", Path::new(&v.dir).join("attachments").join(a).display()));
				}
			}
			// 대화는 기본으로 고칠 수 있다. 묻기만 한 말에 코드가 바뀌면 사용자가 모르는 변경이 생기므로, 고치라고 한 때만 고치게 한다.
			if *edit {
				mode.push_str("\n\n(묻는 말에는 답만 한다. 고치라고 하거나 고치는 데 동의했을 때만 파일을 고친다.)");
			} else {
				mode.push_str("\n\n(이번에는 파일을 고치지 않는다. 읽기 도구만 열려 있다.)");
			}
			// 이어 붙인 차례에는 규칙 전체를 다시 싣지 않는다. 세션 첫 프롬프트에 있다. 계획 · 구현에서 이어진 세션이라도 같은 말을 한 줄로 일깨운다.
			mode.push_str("\n\n(화면 설계를 보일 때는 ```html · ```svg 코드 블록으로 낸다. 화면을 고쳤으면 결과 화면을 찍어 답에 `![설명](전체 경로)` 로 건다. 화면이 바뀌지 않으면 둘 다 하지 않는다.)");
			// 계획 전 · 승인 전 이슈만 대화에서 설계를 받는다. 구현 뒤에 표지가 오면 승인 대기로 되돌아가 버린다.
			// 프로젝트 대화는 보드의 단계 밖에 있다. 설계 대신 메모를 남긴다 — 첫 차례에는 MEMO_RULE 전체를, 이어 붙일 때는 한 줄로 일깨운다.
			if v.issue.talk {
				if resumed {
					mode.push_str(&format!("\n\n(작업 메모로 남기라고 했을 때만 답 맨 끝에 `{MEMO_MARK} <제목>` · 본문 · `{MEMO_END}` 블록을 낸다.)"));
				}
			} else if matches!(v.issue.status, Status::Inbox | Status::Planned | Status::Dropped) {
				mode.push_str(&format!(
					"\n\n(이 대화로 무엇을 어떻게 바꿀지 사용자와 정해졌으면, 답에 정해진 설계를 정리해 적고 맨 끝 줄에 `{STAGE_MARK} <한 줄 제목>` 을 따로 적는다. 아직 묻고 답하는 중이면 달지 않는다.)"
				));
			}
			// 이어 붙일 때는 사용자가 쓴 글 그대로 보낸다. 터미널에서 이어 쓴 대화와 같은 모양이 되게 한다.
			if resumed {
				return format!("{text}{mode}\n");
			}
			if v.issue.talk {
				return format!(
					"사용자가 이 저장소에 대해 묻는다. 이 저장소의 코드를 확인하고 답하라.\n\n## 사용자\n{text}{mode}\n\n{MEMO_RULE}\n\n{VISUAL_RULE}\n{}\n\n{RULES}\n",
					if *edit { format!("\n{}", shot_rule(v)) } else { String::new() }
				);
			}
			format!(
				"아래 메모로 진행 중인 개발 이슈에 대해 사용자가 묻는다. 이 저장소의 코드를 확인하고 답하라.\n\n{}\n{}\n## 사용자\n{text}{mode}\n\n{VISUAL_RULE}\n{}\n\n{RULES}\n",
				note_block(v),
				v.issue.plan.as_ref().map(plan_block).unwrap_or_default().replacen("승인된 계획", "지금 계획", 1),
				if *edit { format!("\n{}", shot_rule(v)) } else { String::new() }
			)
		}
	}
}

/// 새로 만든 파일은 Claude 가 지울 수 없다(명령 권한이 없다). 앱이 끝나고 휴지통으로 옮기므로 Claude 에게는 손대지 말라고만 한다.
pub fn created_files(changes: &[FileChange]) -> Vec<String> {
	let mut out: Vec<String> = Vec::new();
	for c in changes.iter().filter(|c| c.kind == "create") {
		if !out.contains(&c.path) {
			out.push(c.path.clone());
		}
	}
	out
}

/// 기록한 변경분을 diff 로 넘긴다. 되돌릴 근거가 Claude 의 기억이 아니라 앱이 남긴 기록이어야 빠뜨리지 않는다.
fn revert_block(changes: &[FileChange]) -> String {
	const LIMIT: usize = 80_000;
	let created = created_files(changes);
	let mut s = String::from(
		"## 되돌릴 변경\n\
		아래는 이 이슈에서 기록한 변경분이다. 일어난 순서대로 적었으니 뒤에서부터 거꾸로 되돌려 고치기 전으로 돌린다.\n\
		- 먼저 지금 파일을 읽는다. 그 뒤에 사용자가 고친 줄이 있으면 그 줄은 지키고 이 변경분만 되돌린다.\n\
		- 깔끔히 되돌릴 수 없는 곳은 억지로 맞추지 말고 verification 에 무엇이 남았는지 적는다.\n\
		- 되돌리는 김에 다른 것을 새로 고치지 않는다.\n",
	);
	if !created.is_empty() {
		s.push_str("\n### 새로 만든 파일\n앱이 휴지통으로 옮긴다. 손대지 않는다.\n");
		for p in &created {
			s.push_str(&format!("- {p}\n"));
		}
	}
	let mut skipped: Vec<&str> = Vec::new();
	for c in changes.iter().filter(|c| !created.contains(&c.path)) {
		let mut d = format!("\n### {} ({})\n```diff\n", c.rel, c.kind);
		for h in &c.hunks {
			d.push_str(&format!("@@ -{},{} +{},{} @@\n", h.old_start, h.old_lines, h.new_start, h.new_lines));
			for l in &h.lines {
				d.push_str(l);
				d.push('\n');
			}
		}
		d.push_str("```\n");
		if s.len() + d.len() > LIMIT {
			skipped.push(&c.rel);
		} else {
			s.push_str(&d);
		}
	}
	if !skipped.is_empty() {
		s.push_str("\n### 너무 길어 변경분을 싣지 못한 것\n세션에서 고친 기억과 지금 코드를 견주어 되돌린다.\n");
		for r in skipped {
			s.push_str(&format!("- {r}\n"));
		}
	}
	s
}

const IMPL_FORMAT: &str = "\
## 끝나면 정리할 것
- summary: 무엇을 바꿨는지 두세 문장
- changed: 바꾼 파일(저장소 기준 상대 경로)과 바꾼 내용 한 줄
- verification: 무엇으로 확인했는지. 돌리지 못한 확인은 못 했다고 적는다. 권한이 없어 막힌 명령은 무엇이 왜 필요했는지 적는다.
- followups: 사용자가 이어서 할 일. 없으면 빈 배열.
- screenshots: 찍은 결과 화면. 화면이 바뀌지 않았거나 찍지 못했으면 빈 배열.";

/// 산출물 정보 · 작성 지침 · 템플릿 · 요청 · 지금 판을 묶는다. 마크다운으로 받든 파일로 받든 같은 재료를 넘긴다.
fn doc_material(v: &DeliverableView, request: &str, current: Option<&str>) -> String {
	let d = &v.deliverable;
	let mut s = format!("## 산출물\n{}", if d.title.trim().is_empty() { "(제목 없음)" } else { d.title.trim() });
	if !d.note.trim().is_empty() {
		s.push_str(&format!(" · {}", d.note.trim()));
	}
	s.push('\n');
	if !d.guide.trim().is_empty() {
		s.push_str(&format!("\n## 작성 지침\n{}\n", d.guide.trim()));
	}
	if !d.skill.trim().is_empty() {
		s.push_str(&format!("\n## 작성법\n템플릿 · 지난 판에서 정리한 구성 · 문체 · 표기 규칙이다. 작성 지침과 어긋나면 작성 지침을 따른다.\n\n{}\n", d.skill.trim()));
	}
	let vocab: Vec<&Term> = d.vocab.iter().filter(|t| !t.term.trim().is_empty()).collect();
	if !vocab.is_empty() {
		// 프로젝트 어휘 사전이 뒤에 붙을 수 있다. 같은 말이면 이 산출물의 것을 따르게 한다.
		s.push_str("\n## 이 산출물의 어휘\n이 문서에서는 아래 말을 쓴다. 「피할 말」은 같은 뜻이지만 쓰지 않는다. 프로젝트 용어와 다르면 이쪽을 따른다.\n");
		for t in vocab {
			s.push_str(&format!("- **{}**", t.term.trim()));
			if !t.note.trim().is_empty() {
				s.push_str(&format!(" — {}", t.note.trim()));
			}
			let avoid: Vec<&str> = t.avoid.iter().map(|a| a.trim()).filter(|a| !a.is_empty()).collect();
			if !avoid.is_empty() {
				s.push_str(&format!(" (피할 말: {})", avoid.join(" · ")));
			}
			s.push('\n');
		}
	}
	if !v.refs.is_empty() {
		let dir = Path::new(&v.dir).join("refs");
		s.push_str("\n## 템플릿 · 참고 자료\n먼저 아래 파일을 모두 읽는다. 템플릿이 있으면 그 목차 · 표 구성 · 문구 형식을 그대로 따르고, 참고 자료는 내용의 근거로 쓴다.\n");
		for r in &v.refs {
			let path = dir.join(&r.name);
			// 앱이 빈 양식을 따로 만들지 않는다(오피스 파일 구조가 깨질 수 있다). 견본의 글자는 Claude 가 갈아 넣게 한다.
			let mark = if r.template { "[템플릿 — 목차 · 표 · 서식은 그대로 두고 내용만 바꾼다] " } else { "" };
			match (r.kind.as_str(), r.text_path.is_empty()) {
				("extract", false) => s.push_str(&format!("- {mark}{} (뽑아 둔 글자: {})\n", path.display(), r.text_path)),
				("direct", _) => s.push_str(&format!("- {mark}{}\n", path.display())),
				_ => s.push_str(&format!("- {mark}{} (글자를 읽을 수 없는 형식이다. 이름과 형식만 참고한다)\n", path.display())),
			}
		}
	}
	let request = if request.trim().is_empty() { "작성 지침과 템플릿대로 새 판을 쓴다." } else { request.trim() };
	s.push_str(&format!("\n## 이번 요청\n{request}\n"));
	if let Some(c) = current {
		s.push_str(&format!("\n## 지금 판 본문\n요청에 맞게 고친 새 판을 낸다.\n\n{c}\n"));
	}
	s
}

fn doc_prompt(material: &str) -> String {
	format!(
		"이 저장소를 읽고 아래 산출물을 마크다운으로 작성하라. 파일을 만들거나 고치지 않는다 (읽기 도구만 열려 있다). \
		문서 제목은 title, 본문 전체는 document 에 넣는다. 근거가 된 코드 위치는 `경로:행` 으로 적고, 확인하지 못한 것은 확인하지 못했다고 적는다.\n\n\
		{material}\n{RULES}\n"
	)
}

/// format 이 있으면 확장자를 그것으로 못 박는다. 비우면 템플릿을 따르고, 템플릿도 없으면 md 다.
fn doc_file_prompt(material: &str, dir: &Path, base: &str, format: &str) -> String {
	let ext = format.trim().trim_start_matches('.').to_lowercase();
	let name_line = if ext.is_empty() { format!("{base}.<확장자>  확장자는 템플릿 형식을 따르고, 템플릿이 없으면 md 로 한다.") } else { format!("{base}.{ext}") };
	format!(
		"이 저장소를 읽고 아래 산출물을 파일로 만들어라.\n\n\
		## 결과 파일\n\
		- 폴더: {}\n\
		- 이름: {name_line}\n\
		- 한글(hwpx) · 워드(docx) · 엑셀(xlsx) · 파워포인트(pptx)는 그 형식을 다루는 스킬로 만든다. 템플릿 파일이 있으면 복사해 내용을 채우는 쪽을 먼저 고른다.\n\
		- 그 폴더에는 결과 파일만 남긴다. 중간 파일은 시스템 임시 폴더에 두고 끝나면 지운다.\n\
		- 저장소 안의 파일은 고치지 않는다. 편집 도구는 저장소 안에서 막혀 있고, 명령으로도 저장소에 쓰지 않는다.\n\
		- 끝나면 만든 파일의 전체 경로를 files 에, 무엇을 담았는지 한두 문장을 summary 에, 문서 제목을 title 에 넣는다.\n\n\
		{material}\n{RULES}\n",
		dir.display()
	)
}

/* ---------- 인자 ---------- */

/// 메모에서 고른 모델이 앞서고, 없으면 설정의 실행별 모델이다. 둘 다 비면 빈 값이라 CLI 기본 모델로 돈다.
/// 되돌리기는 구현과 같은 권한 · 결과 형식으로 돌고, 산출물 작성은 결과물을 만들어 쓰는 일이라 둘 다 구현 모델을 쓴다.
pub(crate) fn pick_model<'a>(s: &'a Settings, issue_model: &'a str, kind: RunKind) -> &'a str {
	if !issue_model.trim().is_empty() {
		return issue_model.trim();
	}
	match kind {
		RunKind::Plan => s.plan_model.trim(),
		RunKind::Chat => s.chat_model.trim(),
		RunKind::Implement | RunKind::Revert | RunKind::Document => s.impl_model.trim(),
	}
}

/// effort 도 모델과 같은 순서다: 메모 → 설정의 실행별 값 → 빈 값(--effort 를 넘기지 않아 CLI 기본값).
/// 메모에서 모델만 골랐으면 effort 는 설정을 따른다. 둘을 따로 고를 수 있게 하려는 것이다.
pub(crate) fn pick_effort<'a>(s: &'a Settings, issue_effort: &'a str, kind: RunKind) -> &'a str {
	if !issue_effort.trim().is_empty() {
		return issue_effort.trim();
	}
	match kind {
		RunKind::Plan => s.plan_effort.trim(),
		RunKind::Chat => s.chat_effort.trim(),
		RunKind::Implement | RunKind::Revert | RunKind::Document => s.impl_effort.trim(),
	}
}

fn base_args(s: &Settings, model: &str, effort: &str, add_dirs: &[&Path]) -> Vec<String> {
	let mut a: Vec<String> = ["-p", "--output-format", "stream-json", "--verbose", "--permission-prompts", "none"].map(String::from).to_vec();
	if !model.is_empty() {
		a.extend(["--model".into(), model.to_string()]);
	}
	if !effort.is_empty() {
		a.extend(["--effort".into(), effort.to_string()]);
	}
	if !s.use_mcp {
		a.push("--strict-mcp-config".into());
	}
	a.push("--add-dir".into());
	a.extend(add_dirs.iter().map(|d| d.to_string_lossy().to_string()));
	a
}

fn job_args(job: &Job, s: &Settings, p: &Project, issue: &Issue, add_dir: &Path, resume: Option<&str>) -> Vec<String> {
	let mut a = base_args(s, pick_model(s, &issue.model, job.kind()), pick_effort(s, &issue.effort, job.kind()), &[add_dir]);
	perm_args(&mut a, &job_perms(job, p), &[]);
	match job {
		Job::Plan { .. } => a.extend(["--json-schema".into(), PLAN_SCHEMA.into()]),
		// 대화는 결과 형식을 정하지 않는다. 답은 글로 받는다.
		Job::Chat { .. } => {}
		_ => a.extend(["--json-schema".into(), IMPL_SCHEMA.into()]),
	}
	if let Some(sid) = resume {
		a.extend(["--resume".into(), sid.to_string()]);
	}
	a
}

/// 지식베이스의 글자 사본 · 끌어 놓은 자료를 Read 로 열 수 있게 한다. 이미 있는 --add-dir 목록 맨 앞에 끼운다 —
/// 같은 인자를 한 번 더 주면 앞의 목록을 덮는지 확인하지 못해서다.
fn kb_add_dir(args: &mut Vec<String>, store: &Store, pid: &str) {
	let dir = store.kb_dir(pid);
	let _ = std::fs::create_dir_all(&dir);
	let dir = dir.to_string_lossy().to_string();
	match args.iter().position(|a| a == "--add-dir") {
		Some(i) => args.insert(i + 1, dir),
		None => args.extend(["--add-dir".into(), dir]),
	}
}

/* ---------- 이슈 작업 ---------- */

fn record(run_id: &str, kind: RunKind, prompt: &str) -> RunRecord {
	let kind = match kind {
		RunKind::Plan => "plan",
		RunKind::Implement => "implement",
		RunKind::Document => "document",
		RunKind::Chat => "chat",
		RunKind::Revert => "revert",
	};
	RunRecord { id: run_id.into(), kind: kind.into(), started_at: now_ms(), status: "running".into(), prompt: prompt.into(), ..Default::default() }
}

fn finish(rec: &mut RunRecord, o: &Outcome) {
	rec.ended_at = now_ms();
	rec.status = if o.stopped { "stopped" } else if o.ok { "ok" } else { "error" }.into();
	rec.model = o.parser.model.clone();
	rec.error = o.error.chars().take(2000).collect();
	rec.commands = o.parser.commands.clone();
	rec.denials = o.parser.denials.clone();
	if let Some(r) = o.parser.result.as_ref() {
		rec.cost_usd = r.get("total_cost_usd").and_then(|x| x.as_f64()).unwrap_or(0.0);
		rec.duration_ms = r.get("duration_ms").and_then(|x| x.as_u64()).unwrap_or(0);
		rec.num_turns = r.get("num_turns").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
	}
}

pub fn plan(app: &AppHandle, pid: &str, iid: &str, feedback: Option<String>) -> Result<IssueView> {
	let feedback = feedback.filter(|f| !f.trim().is_empty());
	start_issue(app, pid, iid, Job::Plan { feedback })
}

pub fn approve(app: &AppHandle, pid: &str, iid: &str, instruction: Option<String>, allow_all: bool) -> Result<IssueView> {
	start_issue(app, pid, iid, Job::Implement { instruction, allow_all })
}

pub fn rework(app: &AppHandle, pid: &str, iid: &str, feedback: String, allow_all: bool) -> Result<IssueView> {
	if feedback.trim().is_empty() {
		return msg("고칠 것을 적어 주세요");
	}
	start_issue(app, pid, iid, Job::Rework { feedback, allow_all })
}

/// 이 이슈에서 Claude 가 바꾼 것을 되돌린다. 기록한 변경분을 넘겨 Claude 가 거꾸로 고치게 하고, 새로 만든 파일은 앱이 치운다.
pub fn revert(app: &AppHandle, pid: &str, iid: &str) -> Result<IssueView> {
	start_issue(app, pid, iid, Job::Revert)
}

/// 진행 중인 이슈에 질문을 보낸다. 계획 · 구현과 같은 세션을 이으므로 Claude 가 지금까지 읽고 고친 것을 기억한다.
/// 설계가 정해지면 승인 대기로, 파일을 고쳤으면 결과 확인으로 단계를 옮긴다.
/// 실행 중이면 대기열에 넣고, 대기열이 남아 있으면 그 뒤에 붙여 함께 보낸다.
pub fn chat(app: &AppHandle, pid: &str, iid: &str, text: String, edit: bool, images: Vec<String>) -> Result<IssueView> {
	// 첨부 폴더 밖을 가리키지 못하게 이름만 받고, 지금 있는 파일만 넘긴다.
	let have = app.state::<Store>().attachments(pid, iid);
	let images: Vec<String> = images.into_iter().filter(|n| have.contains(n)).collect();
	if text.trim().is_empty() && images.is_empty() {
		return msg("물을 것을 적어 주세요");
	}
	let item = QueuedChat { id: short_id(), text, edit, images, at: now_ms() };
	match send_queued(app, pid, iid, Some(item))? {
		Some(v) => Ok(v),
		None => app.state::<Store>().get_issue(pid, iid),
	}
}

/// 대기열을 꺼내는 일과 실행을 여는 일 사이에 다른 보내기가 끼면 질문의 차례가 뒤집힌다. 둘을 한 줄로 세운다.
static DISPATCH: Mutex<()> = Mutex::new(());

/// 대기열을 한 차례로 묶는다. 글은 넣은 차례대로 빈 줄을 두고 잇고, 첨부는 겹치는 이름을 한 번만 넣는다.
/// 하나라도 고칠 수 있게 넣었으면 고칠 수 있는 쪽을 따른다. 읽기 전용으로 묶으면 그 질문이 바라던 고침을 못 한다.
fn batch_job(items: &[QueuedChat], have: &[String]) -> Option<Job> {
	let text = items.iter().map(|q| q.text.trim()).filter(|t| !t.is_empty()).collect::<Vec<_>>().join("\n\n");
	let mut images: Vec<String> = Vec::new();
	for n in items.iter().flat_map(|q| &q.images) {
		if have.contains(n) && !images.contains(n) {
			images.push(n.clone());
		}
	}
	if text.is_empty() && images.is_empty() {
		return None;
	}
	Some(Job::Chat { text, edit: items.iter().any(|q| q.edit), images })
}

/// 실행 중이 아니면 대기열(과 extra)을 한 차례로 묶어 보낸다. 실행 중이면 extra 를 대기열 뒤에 넣는다.
/// 보낸 차례가 없으면 None 이다. 열지 못했으면 꺼낸 대기열을 앞에 되돌려 놓는다 — 적어 둔 질문이 사라지지 않게 한다.
pub fn send_queued(app: &AppHandle, pid: &str, iid: &str, extra: Option<QueuedChat>) -> Result<Option<IssueView>> {
	let _line = DISPATCH.lock().unwrap_or_else(|e| e.into_inner());
	let store = app.state::<Store>();
	let mut taken: Vec<QueuedChat> = Vec::new();
	let mut queued = false;
	let view = store.update_issue(pid, iid, |i| {
		if i.run.is_some() {
			if let Some(q) = extra.clone() {
				i.queue.push(q);
				queued = true;
			}
			return Ok(());
		}
		taken = std::mem::take(&mut i.queue);
		Ok(())
	})?;
	if queued {
		emit_issue(app, &view);
		return Ok(Some(view));
	}
	let had = taken.len();
	let mut items = taken.clone();
	items.extend(extra);
	let Some(job) = batch_job(&items, &store.attachments(pid, iid)) else {
		if had > 0 {
			emit_issue(app, &store.get_issue(pid, iid)?);
		}
		return Ok(None);
	};
	match start_issue(app, pid, iid, job) {
		Ok(v) => Ok(Some(v)),
		Err(e) => {
			if had > 0 {
				let v = store.update_issue(pid, iid, |i| {
					let rest = std::mem::take(&mut i.queue);
					i.queue = taken;
					i.queue.extend(rest);
					Ok(())
				})?;
				emit_issue(app, &v);
			}
			Err(e)
		}
	}
}

fn start_issue(app: &AppHandle, pid: &str, iid: &str, job: Job) -> Result<IssueView> {
	let store = app.state::<Store>();
	// 이슈를 실행 중으로 바꾸기 전에 읽는다. 바꾼 뒤에 실패하면 이슈가 실행 중인 채로 남는다.
	let project = store.project(pid)?;
	let run_id = short_id();
	let kind = job.kind();
	let view = store.update_issue(pid, iid, |i| {
		if i.run.is_some() {
			return msg("이미 실행 중입니다");
		}
		match &job {
			Job::Plan { feedback } => {
				if !matches!(i.status, Status::Inbox | Status::Planned | Status::Dropped) {
					return msg("지금 단계에서는 계획을 세울 수 없습니다");
				}
				match feedback {
					Some(f) => i.log("replan", f.clone()),
					None => i.log("plan", ""),
				}
				i.status = Status::Planning;
			}
			Job::Implement { instruction, .. } => {
				if i.status != Status::Planned || i.plan.is_none() {
					return msg("승인할 계획이 없습니다");
				}
				i.log("approve", instruction.clone().unwrap_or_default());
				i.status = Status::Implementing;
			}
			Job::Rework { feedback, .. } => {
				if i.status != Status::Review {
					return msg("결과를 확인하는 단계에서만 수정을 요청할 수 있습니다");
				}
				i.log("rework", feedback.clone());
				i.status = Status::Implementing;
			}
			Job::Revert => {
				if i.changes.is_empty() {
					return msg("되돌릴 변경이 없습니다");
				}
				i.log("revert", "");
				i.status = Status::Implementing;
				i.auto_plan = false;
			}
			// 단계는 그대로 둔다. 사용자가 직접 묻고 있으니 자동 계획이 끼어들어 세션을 새로 열지 않게 끈다.
			Job::Chat { text, .. } => {
				i.log("chat", text.chars().take(300).collect::<String>());
				i.auto_plan = false;
				// 프로젝트 대화에는 메모가 없다. 첫 질문을 목록에 보일 제목으로 쓴다.
				if i.talk && i.title.is_empty() {
					i.title = crate::store::title_of(text);
				}
			}
		}
		i.run = Some(RunState { kind, phase: Phase::Queued, run_id: run_id.clone(), queued_at: now_ms(), wait_for: String::new() });
		i.error.clear();
		Ok(())
	})?;
	emit_issue(app, &view);

	let runner = app.state::<Runner>();
	let key = issue_key(pid, iid);
	let claim = job.exclusive().then(|| issue_claim(&job, &view.issue, &project, &key));
	let ctl = runner.register(&key);
	let (claims, slots) = (runner.claims.clone(), runner.project_slots(pid));
	let (app, pid, iid) = (app.clone(), pid.to_string(), iid.to_string());
	tauri::async_runtime::spawn(async move {
		// 무엇을 기다리는지 이슈에 적어 화면이 보이게 한다. 그 사이 실행이 바뀌었으면 건드리지 않는다.
		let on_wait = |why: &str| {
			if let Ok(v) = app.state::<Store>().update_issue(&pid, &iid, |i| {
				if let Some(r) = i.run.as_mut().filter(|r| r.run_id == run_id) {
					r.wait_for = why.to_string();
				}
				Ok(())
			}) {
				emit_issue(&app, &v);
			}
		};
		let turn = wait_turn(claims, slots, &pid, claim, &ctl, on_wait).await;
		let res = match turn {
			Some(_g) => run_issue_job(&app, &pid, &iid, &job, &run_id, &ctl).await,
			None => Ok(()),
		};
		app.state::<Runner>().release(&key);
		let store = app.state::<Store>();
		// 줄 서 있다 중지됐거나 예상 밖 오류로 빠져나왔으면 여기서 정리한다.
		let still = store.raw_issue(&pid, &iid).ok().and_then(|i| i.run).map(|r| r.run_id == run_id).unwrap_or(false);
		if still {
			let err = res.err().map(|e| e.to_string());
			if let Ok(v) = store.update_issue(&pid, &iid, |i| {
				settle(i, kind);
				match &err {
					Some(e) => {
						i.error = e.clone();
						i.log("error", e.clone());
					}
					None => {
						i.auto_plan = false;
						i.log("stop", "");
					}
				}
				Ok(())
			}) {
				emit_issue(&app, &v);
			}
		}
		// 기다리던 질문을 이어 보낸다. 사용자가 중지했으면 멈춘 뜻을 따라 보내지 않고 남겨 둔다. 실패한 차례 뒤에는 이어 보낸다.
		if !ctl.cancelled() {
			if let Err(e) = send_queued(&app, &pid, &iid, None) {
				eprintln!("대기열을 보내지 못했습니다: {e}");
			}
		}
	});
	Ok(view)
}

fn parse_plan(o: &Outcome, fallback_title: &str, run_id: &str) -> Plan {
	let mut plan: Plan = o.parser.structured().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_else(|| Plan {
		title: fallback_title.to_string(),
		plan: o.parser.result_text(),
		..Default::default()
	});
	if plan.title.trim().is_empty() {
		plan.title = fallback_title.to_string();
	}
	plan.created_at = now_ms();
	plan.run_id = run_id.to_string();
	plan
}

/// 대화 한 차례가 끝난 뒤 이슈의 단계를 맞춘다.
/// 고친 파일은 표지보다 앞선다. 말로는 설계 중이라 해도 코드가 바뀌었으면 사용자가 결과를 봐야 한다.
fn chat_advance(i: &mut Issue, o: &Outcome, run_id: &str, fallback_title: &str) {
	// 프로젝트 대화는 보드의 단계 밖에 있다. 고친 파일은 이미 변경에 쌓였고, 결과 확인으로 옮길 곳이 없다.
	if i.talk {
		return;
	}
	let (answer, mark) = stage_mark(&o.parser.result_text());
	let edited = i.changes.iter().any(|c| c.run_id == run_id);
	if edited {
		// 이미 결과 확인 중이면 그 결과를 덮지 않는다. 바뀐 파일은 변경 탭에 이미 쌓였다.
		if i.status != Status::Review {
			i.result = Some(ImplResult { summary: answer, created_at: now_ms(), run_id: run_id.to_string(), ..Default::default() });
			i.status = Status::Review;
			i.log("implemented", "대화에서 고침");
		}
		return;
	}
	let Some(title) = mark else { return };
	if !matches!(i.status, Status::Inbox | Status::Planned | Status::Dropped) {
		return;
	}
	let title = if title.is_empty() { fallback_title.to_string() } else { title };
	i.log("planned", format!("대화에서 정함 · {title}"));
	i.plan = Some(Plan { title, summary: "대화에서 정한 설계".into(), plan: answer, created_at: now_ms(), run_id: run_id.to_string(), ..Default::default() });
	i.status = Status::Planned;
}

/// 화면이 그림으로 띄우는 확장자. 화면 쪽 `isImage` 와 같은 목록이다.
pub const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

/// 찍기에 쓴 임시 스크립트 · 그림은 바꾼 파일이 아니다. 남기면 변경 탭에 뜨고, 되돌리기 때 새 파일로 여겨 휴지통으로 옮긴다.
/// rel_path 처럼 바이트로 자르지 않는다. 한글 경로에서 글자 가운데를 자르면 실행이 통째로 죽는다.
fn scratch_path(path: &str, issue_dir: &str) -> bool {
	let n = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_lowercase();
	let p = n(path);
	let tmp = std::env::temp_dir();
	[n(issue_dir), n(&tmp.to_string_lossy())].iter().any(|d| !d.is_empty() && p.starts_with(&format!("{d}\\")))
}

/// 결과에 적힌 화면 그림을 이슈 폴더의 `shots/<실행>/` 로 모으고 path 를 이슈 폴더 기준으로 바꾼다.
/// 이슈 폴더는 앱 데이터 안이라 화면이 따로 열지 않고 띄운다. 저장소나 임시 폴더에 둔 것도 복사해 오므로 그쪽을 치워도 남는다.
/// 없는 파일 · 그림이 아닌 파일은 버린다. Claude 가 찍었다고 적고 실제로는 못 찍은 경우가 있다.
fn collect_shots(r: &mut ImplResult, issue_dir: &Path, run_id: &str) {
	let shots = issue_dir.join("shots");
	let dest = shots.join(run_id);
	let mut out = Vec::new();
	for s in std::mem::take(&mut r.screenshots) {
		let src = PathBuf::from(s.path.trim());
		let src = if src.is_absolute() { src } else { issue_dir.join(src) };
		let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
		let Some(name) = src.file_name().map(|n| n.to_string_lossy().to_string()) else { continue };
		if !src.is_file() || !IMAGE_EXT.contains(&ext.as_str()) || std::fs::create_dir_all(&dest).is_err() {
			continue;
		}
		// 이름이 겹쳐도 덮지 않게 순번을 앞에 붙인다. 순번은 결과에 적힌 차례다.
		let name = format!("{:02}-{name}", out.len() + 1);
		let to = dest.join(&name);
		// shots 바로 아래 것은 이 앱 것이라 옮긴다. 그 밖은 복사만 한다. 저장소 파일을 앱이 지우면 안 된다.
		let moved = src.parent() == Some(shots.as_path()) && std::fs::rename(&src, &to).is_ok();
		if !moved && std::fs::copy(&src, &to).is_err() {
			continue;
		}
		out.push(Shot { path: format!("shots/{run_id}/{name}"), caption: s.caption.trim().to_string() });
	}
	r.screenshots = out;
}

fn parse_result(o: &Outcome, run_id: &str) -> ImplResult {
	let mut r: ImplResult = o
		.parser
		.structured()
		.and_then(|v| serde_json::from_value(v).ok())
		.unwrap_or_else(|| ImplResult { summary: o.parser.result_text(), ..Default::default() });
	r.created_at = now_ms();
	r.run_id = run_id.to_string();
	r
}

async fn run_issue_job(app: &AppHandle, pid: &str, iid: &str, job: &Job, run_id: &str, ctl: &RunCtl) -> Result<()> {
	let store = app.state::<Store>();
	if ctl.cancelled() {
		return Ok(());
	}
	let settings = store.settings()?;
	let mut project = store.project(pid)?;
	let exe = resolve_claude(&settings.claude_path)
		.ok_or_else(|| Error::Msg("claude 실행 파일을 찾지 못했습니다. 설정에서 경로를 지정하세요.".into()))?;
	let kind = job.kind();
	let key = issue_key(pid, iid);
	let claims = app.state::<Runner>().claims.clone();
	// 함께 도는 구현이 잡은 파일은 이번 실행이 고치지 못하게 막는다. 막을 목록에 더해 인자 · 실행 기록이 같은 값을 쓰게 한다.
	// Edit · Write 도구만 막는다. 명령으로 쓰는 것은 막지 못해 「모두 허용」은 함께 돌리지 않는다(claim_files).
	if job.exclusive() {
		for f in claims.others(pid, &key) {
			project.denied_tools.extend([format!("Edit(./{f})"), format!("Write(./{f})")]);
		}
	}

	let view = store.update_issue(pid, iid, |i| {
		if let Some(r) = i.run.as_mut() {
			r.phase = Phase::Running;
			r.wait_for.clear();
		}
		let perms = job_perms(job, &project);
		let mut rec = record(run_id, kind, job.prompt());
		rec.mode = perms.label;
		rec.effort = pick_effort(&settings, &i.effort, kind).to_string();
		rec.allowed = perms.allow;
		rec.denied_rules = perms.deny;
		if let Job::Chat { images, .. } = job {
			rec.images = images.clone();
		}
		i.runs.push(rec);
		Ok(())
	})?;
	emit_issue(app, &view);

	// 지식베이스는 계획 · 대화에만 붙인다. 구현 · 되돌리기는 계획 때 붙인 자료를 이어 붙인 세션이 이미 안다.
	let kb_query = match job {
		Job::Plan { feedback } => Some(format!("{}\n{}", view.note, feedback.as_deref().unwrap_or(""))),
		Job::Chat { text, .. } => Some(text.clone()),
		_ => None,
	};
	// 어휘 사전은 새 세션으로 시작할 때 붙인다(아래 loop). 이어 붙인 세션은 첫 프롬프트에서 이미 받았다.
	// 되돌리기는 계획을 거꾸로 따라가는 일이라 붙이지 않는다.
	let gl_list = if project.glossary.enabled && kind != RunKind::Revert { crate::glossary::merged(&store, &project) } else { Vec::new() };
	let (gl_block, gl_terms) = {
		let q = match job {
			Job::Chat { text, .. } => text.clone(),
			Job::Plan { feedback } => format!("{}\n{}", view.note, feedback.as_deref().unwrap_or("")),
			Job::Rework { feedback, .. } => format!("{}\n{feedback}", view.note),
			_ => view.note.clone(),
		};
		crate::glossary::prompt_block(&gl_list, &q)
	};
	let mut kb_block = String::new();
	if let Some(q) = kb_query.filter(|_| project.kb.enabled) {
		// 사전의 비슷한 말을 덧붙여 찾는다. 문서가 다른 말로 적었어도 걸리게 한다.
		let q = crate::glossary::expand_query(&gl_list, &q);
		let hits = crate::kb::find(app, &project, &settings, &q, "").await;
		if !hits.is_empty() {
			kb_block = crate::kb::prompt_block(&hits);
			if let Ok(v) = store.update_issue(pid, iid, |i| {
				if let Some(rec) = i.runs.iter_mut().find(|r| r.id == run_id) {
					rec.kb_hits = crate::kb::brief(&hits);
				}
				Ok(())
			}) {
				emit_issue(app, &v);
			}
		}
	}

	// 첫 계획만 새 세션으로 연다. 그 뒤로는 같은 세션을 이어 Claude 가 읽은 코드와 계획을 기억하게 한다.
	let first_plan = matches!(job, Job::Plan { feedback: None });
	let mut resumed = !first_plan && !view.issue.session_id.is_empty();
	let log = store.issue_run_log(pid, iid, run_id)?;
	// 찍기 도구는 저장할 폴더가 없으면 실패한다(msedge --screenshot 등). 프롬프트가 가리키는 폴더를 미리 만든다.
	if matches!(kind, RunKind::Implement | RunKind::Chat) {
		let _ = std::fs::create_dir_all(Path::new(&view.dir).join("shots"));
	}
	// 함께 도는 구현이 잡은 파일을 고쳤으면 실행은 그대로 두고 흐름에 한 번씩 남긴다. 결과 확인 때 사람이 본다.
	let mut overlapped: HashSet<String> = HashSet::new();
	let outcome = loop {
		let mut args = job_args(job, &settings, &project, &view.issue, Path::new(&view.dir), resumed.then_some(view.issue.session_id.as_str()));
		let mut prompt = issue_prompt(job, &view, resumed);
		if project.kb.enabled {
			kb_add_dir(&mut args, &store, pid);
		}
		if !resumed && !gl_block.is_empty() {
			prompt.push('\n');
			prompt.push_str(&gl_block);
			if let Ok(v) = store.update_issue(pid, iid, |i| {
				if let Some(rec) = i.runs.iter_mut().find(|r| r.id == run_id) {
					rec.glossary_terms = gl_terms.clone();
				}
				Ok(())
			}) {
				emit_issue(app, &v);
			}
		}
		if !kb_block.is_empty() {
			prompt.push('\n');
			prompt.push_str(&kb_block);
		}
		let spec = Spec {
			exe: exe.clone(),
			cwd: PathBuf::from(&project.path),
			args,
			prompt,
			log: log.clone(),
			root: project.path.clone(),
			run_id: run_id.to_string(),
		};
		let o = exec(spec, ctl, |ev, parser| {
			let _ = app.emit(
				"docket://run",
				Envelope { project_id: pid, target: "issue", target_id: iid, run_id, event: ev },
			);
			if let RunEvent::Change { rel, .. } = ev
				&& let Some(who) = claims.touch(pid, &key, rel)
				&& overlapped.insert(norm_path(rel))
				&& let Ok(v) = store.update_issue(pid, iid, |i| {
					i.log("overlap", format!("{rel} · 함께 도는 {who} 도 이 파일을 잡고 있다"));
					Ok(())
				}) {
				emit_issue(app, &v);
			}
			// 바뀐 파일은 그때그때 남긴다. 실행 도중 앱이 꺼져도 무엇을 고쳤는지는 남는다.
			// 되돌리는 편집은 남기지 않는다. 남기면 되돌린 뒤에도 「바꾼 파일」로 보이고, 다시 되돌리면 원래대로 돌아간다.
			if kind != RunKind::Revert
				&& let RunEvent::Change { .. } = ev
				&& let Some(ch) = parser.changes.last().cloned()
				&& !scratch_path(&ch.path, &view.dir)
					&& let Ok(v) = store.update_issue(pid, iid, |i| {
						i.changes.push(ch);
						Ok(())
					}) {
						emit_issue(app, &v);
					}
		})
		.await;
		// 이어 붙일 세션이 사라졌으면 세션 시작 전에 죽는다. 그때는 새 세션으로 한 번 더 간다.
		if resumed && !o.ok && !o.stopped && o.parser.session_id.is_empty() {
			resumed = false;
			continue;
		}
		break o;
	};

	// 되돌리기가 끝나면 새로 만든 파일을 휴지통으로 옮긴다. 지우지 않고 옮기므로 잘못 치웠어도 꺼낼 수 있다.
	let mut trashed: Vec<String> = Vec::new();
	if kind == RunKind::Revert && outcome.ok {
		for path in created_files(&view.issue.changes) {
			let p = Path::new(&path);
			if !p.is_file() {
				continue;
			}
			let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
			match store.trash(p, &format!("되돌림-{name}")) {
				Ok(_) => trashed.push(rel_path(&path, &project.path)),
				Err(e) => trashed.push(format!("{} (옮기지 못함: {e})", rel_path(&path, &project.path))),
			}
		}
	}

	let fallback_title = if view.issue.title.is_empty() { format!("이슈 #{}", view.issue.number) } else { view.issue.title.clone() };
	let decided = store.update_issue(pid, iid, |i| {
		if let Some(rec) = i.runs.iter_mut().find(|r| r.id == run_id) {
			finish(rec, &outcome);
		}
		if !outcome.parser.session_id.is_empty() {
			i.session_id = outcome.parser.session_id.clone();
		}
		// 대화는 오류를 이슈에 올리지 않는다. 실패는 그 실행 기록에 남아 대화 탭에 보인다.
		// 단계는 대화가 실제로 한 일로 옮긴다 — 파일을 고쳤으면 결과 확인, 설계가 정해졌다고 표지를 달았으면 승인 대기.
		if kind == RunKind::Chat {
			settle(i, kind);
			if outcome.ok && !outcome.stopped {
				chat_advance(i, &outcome, run_id, &fallback_title);
			}
			return Ok(());
		}
		if outcome.stopped {
			settle(i, kind);
			i.auto_plan = false;
			i.log("stop", "");
			return Ok(());
		}
		if !outcome.ok {
			settle(i, kind);
			i.error = outcome.error.clone();
			i.log("error", outcome.error.chars().take(300).collect::<String>());
			return Ok(());
		}
		i.run = None;
		match kind {
			RunKind::Plan => {
				let p = parse_plan(&outcome, &fallback_title, run_id);
				i.log("planned", p.title.clone());
				i.plan = Some(p);
				i.status = Status::Planned;
			}
			// 고치기 전으로 돌렸으니 계획 단계로 돌린다. 다시 승인하거나 다시 계획할 수 있다.
			RunKind::Revert => {
				let r = parse_result(&outcome, run_id);
				let mut text = r.summary.clone();
				if !trashed.is_empty() {
					text.push_str(&format!("\n휴지통으로 옮긴 새 파일: {}", trashed.join(", ")));
				}
				if !r.verification.trim().is_empty() {
					text.push_str(&format!("\n{}", r.verification.trim()));
				}
				i.log("reverted", text);
				i.changes.clear();
				i.result = None;
				i.status = if i.plan.is_some() { Status::Planned } else { Status::Inbox };
			}
			_ => {
				let mut r = parse_result(&outcome, run_id);
				collect_shots(&mut r, Path::new(&view.dir), run_id);
				i.result = Some(r);
				i.log("implemented", "");
				i.status = Status::Review;
			}
		}
		Ok(())
	})?;
	emit_issue(app, &decided);
	// 메모는 위 update_issue 가 끝난 뒤에 만든다. store 의 잠금은 다시 들어갈 수 없어 그 안에서 create_issue 를 부르면 멈춘다.
	if kind == RunKind::Chat && view.issue.talk && outcome.ok && !outcome.stopped {
		let memos = memo_blocks(&outcome.parser.result_text()).1;
		if !memos.is_empty() {
			register_memos(app, pid, iid, &memos, settings.auto_plan)?;
		}
	}
	if !outcome.stopped {
		attention(app);
	}
	Ok(())
}

/// 프로젝트 대화가 낸 메모 블록을 보드의 새 메모로 만든다. 자동 계획은 보드 작성칸으로 쓴 메모와 같이 설정을 따른다.
/// 무엇을 등록했는지(실패했으면 까닭)를 대화의 흐름에 남긴다. 대화 화면은 그 기록으로 「메모 #N」 줄을 그린다.
fn register_memos(app: &AppHandle, pid: &str, tid: &str, memos: &[(String, String)], auto_plan: bool) -> Result<()> {
	let store = app.state::<Store>();
	let mode = new_title_mode(&store.settings()?);
	let mut logs = Vec::new();
	for (title, body) in memos {
		let note = if title.is_empty() { format!("{body}\n") } else { format!("# {title}\n\n{body}\n") };
		// 대화가 제목을 붙여 낸 메모는 그 제목(첫 줄)을 쓴다. 이미 Claude 가 지은 제목을 한 번 더 지을 까닭이 없다.
		let mode = if title.is_empty() { mode } else { TitleMode::FirstLine };
		match store.create_issue(pid, None, &note, auto_plan, mode, "", "") {
			Ok(v) => {
				logs.push(format!("#{} {}", v.issue.number, v.issue.title));
				emit_issue(app, &v);
			}
			Err(e) => logs.push(format!("실패 · {e}")),
		}
	}
	let v = store.update_issue(pid, tid, |i| {
		for l in logs {
			i.log("memo", l);
		}
		Ok(())
	})?;
	emit_issue(app, &v);
	Ok(())
}

/* ---------- 산출물 작성 ---------- */

fn is_text_file(name: &str) -> bool {
	let lower = name.to_lowercase();
	[".md", ".markdown", ".txt"].iter().any(|e| lower.ends_with(e))
}

/// 요청은 비워도 된다. 작성 지침이나 템플릿이 있으면 「그대로 새 판」이 요청이 된다.
pub fn document(app: &AppHandle, pid: &str, did: Option<String>, request: String) -> Result<DeliverableView> {
	document_from(app, pid, did, request, "")
}

/// issue_id 는 이슈를 완료해 자동 갱신으로 시작했을 때 그 이슈다. 끝난 결과를 그 이슈의 흐름에 남긴다.
pub fn document_from(app: &AppHandle, pid: &str, did: Option<String>, request: String, issue_id: &str) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	let did = match did {
		Some(d) => {
			let v = store.get_deliverable(pid, &d)?;
			if request.trim().is_empty() && v.deliverable.guide.trim().is_empty() && v.deliverable.skill.trim().is_empty() && v.refs.is_empty() {
				return msg("무엇을 쓸지 적거나, 만드는 법에 작성 지침 · 작성법 · 템플릿을 넣어 주세요");
			}
			d
		}
		None if request.trim().is_empty() => return msg("무엇을 쓸지 적어 주세요"),
		None => store.create_deliverable(pid, "", "")?.id,
	};
	let run_id = short_id();
	let view = store.update_deliverable(pid, &did, |d| {
		if d.job.is_some() {
			return msg("이미 작성 중입니다");
		}
		d.job = Some(DocJob { run_id: run_id.clone(), phase: Phase::Queued, request: request.clone(), queued_at: now_ms(), issue_id: issue_id.to_string() });
		d.error.clear();
		Ok(())
	})?;
	emit_deliverable(app, &view);

	let runner = app.state::<Runner>();
	let key = doc_key(pid, &did);
	let ctl = runner.register(&key);
	let (claims, slots) = (runner.claims.clone(), runner.project_slots(pid));
	// 파일로 만들기는 명령을 열어 두어 저장소를 쓸 수 있으므로 줄에 선다. 무엇을 쓸지 미리 알 수 없어 프로젝트 전체를 잡는다.
	// 마크다운으로 받기는 읽기 도구만 연다.
	let claim = (view.deliverable.mode == "file").then(|| Claim { key: key.clone(), label: format!("산출물 「{}」", view.deliverable.title), files: None, solo: String::new() });
	let (app, pid) = (app.clone(), pid.to_string());
	tauri::async_runtime::spawn(async move {
		let turn = wait_turn(claims, slots, &pid, claim, &ctl, |_| {}).await;
		let res = match turn {
			Some(_g) => run_doc_job(&app, &pid, &did, &request, &run_id, &ctl).await,
			None => Ok(()),
		};
		app.state::<Runner>().release(&key);
		let store = app.state::<Store>();
		let still = store.get_deliverable(&pid, &did).ok().and_then(|d| d.deliverable.job).map(|j| j.run_id == run_id).unwrap_or(false);
		if still {
			let err = res.err().map(|e| e.to_string()).unwrap_or_default();
			if let Ok(v) = store.update_deliverable(&pid, &did, |d| {
				d.job = None;
				d.error = err;
				for r in d.runs.iter_mut().filter(|r| r.status == "running") {
					r.status = "stopped".into();
					r.ended_at = now_ms();
				}
				Ok(())
			}) {
				emit_deliverable(&app, &v);
			}
		}
	});
	Ok(view)
}

/// 문서 작성 인자. out 이 있으면 파일로 만든다: 결과 폴더를 열고 편집 · 명령을 허용하되 저장소 안 편집은 권한 규칙으로 막는다.
fn doc_args(s: &Settings, p: &Project, data_dir: &Path, out: Option<&Path>) -> Vec<String> {
	match out {
		Some(dir) => {
			let mut a = base_args(s, pick_model(s, "", RunKind::Document), pick_effort(s, "", RunKind::Document), &[data_dir, dir]);
			let perms = Perms { tools: None, mode: "acceptEdits", allow: vec!["Bash".into(), "Skill".into()], deny: p.denied_tools.clone(), label: String::new() };
			perm_args(&mut a, &perms, DENY_REPO_EDITS);
			a.extend(["--json-schema".into(), FILE_SCHEMA.into()]);
			a
		}
		None => {
			let mut a = base_args(s, pick_model(s, "", RunKind::Document), pick_effort(s, "", RunKind::Document), &[data_dir]);
			perm_args(&mut a, &read_perms(p), &[]);
			a.extend(["--json-schema".into(), DOC_SCHEMA.into()]);
			a
		}
	}
}

/// 폴더 안 파일과 수정 시각. 실행 전후를 견주어 Claude 가 만든 파일을 찾는다.
fn snapshot(dir: &Path) -> HashMap<String, std::time::SystemTime> {
	std::fs::read_dir(dir)
		.map(|rd| {
			rd.filter_map(|e| e.ok())
				.filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
				.filter_map(|e| Some((e.file_name().to_string_lossy().to_string(), e.metadata().ok()?.modified().ok()?)))
				.collect()
		})
		.unwrap_or_default()
}

async fn run_doc_job(app: &AppHandle, pid: &str, did: &str, request: &str, run_id: &str, ctl: &RunCtl) -> Result<()> {
	let store = app.state::<Store>();
	if ctl.cancelled() {
		return Ok(());
	}
	let settings = store.settings()?;
	let project = store.project(pid)?;
	let exe = resolve_claude(&settings.claude_path)
		.ok_or_else(|| Error::Msg("claude 실행 파일을 찾지 못했습니다. 설정에서 경로를 지정하세요.".into()))?;
	let view = store.update_deliverable(pid, did, |d| {
		if let Some(j) = d.job.as_mut() {
			j.phase = Phase::Running;
		}
		d.runs.push(RunRecord { effort: pick_effort(&settings, "", RunKind::Document).to_string(), ..record(run_id, RunKind::Document, "") });
		Ok(())
	})?;
	emit_deliverable(app, &view);

	let current = view
		.deliverable
		.versions
		.last()
		.filter(|v| is_text_file(&v.file))
		.and_then(|v| store.version_path(pid, did, v.n).ok())
		.and_then(|p| std::fs::read_to_string(p).ok());
	let origin = view.deliverable.job.as_ref().map(|j| j.issue_id.clone()).unwrap_or_default();
	let mut material = doc_material(&view, request, current.as_deref());
	// 지식베이스에서 이 산출물과 가까운 자료를 붙인다. 자기 자신(이 산출물의 판)은 근거로 붙이지 않는다.
	let d = &view.deliverable;
	let query: String = format!("{} {} {} {}", d.title, d.note, d.guide, request).chars().take(4000).collect();
	let gl_list = if project.glossary.enabled { crate::glossary::merged(&store, &project) } else { Vec::new() };
	let (gl_block, gl_terms) = crate::glossary::prompt_block(&gl_list, &query);
	if !gl_block.is_empty() {
		material.push_str(&format!("\n{gl_block}"));
		if let Ok(v) = store.update_deliverable(pid, did, |d| {
			if let Some(rec) = d.runs.iter_mut().find(|r| r.id == run_id) {
				rec.glossary_terms = gl_terms.clone();
			}
			Ok(())
		}) {
			emit_deliverable(app, &v);
		}
	}
	let hits = crate::kb::find(app, &project, &settings, &crate::glossary::expand_query(&gl_list, &query), did).await;
	if !hits.is_empty() {
		material.push_str(&format!("\n{}", crate::kb::prompt_block(&hits)));
		if let Ok(v) = store.update_deliverable(pid, did, |d| {
			if let Some(rec) = d.runs.iter_mut().find(|r| r.id == run_id) {
				rec.kb_hits = crate::kb::brief(&hits);
			}
			Ok(())
		}) {
			emit_deliverable(app, &v);
		}
	}
	let as_file = view.deliverable.mode == "file";
	let data_dir = PathBuf::from(&view.dir);

	let (mut args, prompt, target) = if as_file {
		let (dir, base) = store.plan_file_output(pid, did)?;
		let before = snapshot(&dir);
		(doc_args(&settings, &project, &data_dir, Some(&dir)), doc_file_prompt(&material, &dir, &base, &view.deliverable.format), Some((dir, before)))
	} else {
		(doc_args(&settings, &project, &data_dir, None), doc_prompt(&material), None)
	};
	if project.kb.enabled {
		kb_add_dir(&mut args, &store, pid);
	}

	let started = std::time::SystemTime::now();
	let spec = Spec {
		exe,
		cwd: PathBuf::from(&project.path),
		args,
		prompt,
		log: store.deliverable_run_log(pid, did, run_id)?,
		root: project.path.clone(),
		run_id: run_id.to_string(),
	};
	let mut outcome = exec(spec, ctl, |ev, _| {
		let _ = app.emit(
			"docket://run",
			Envelope { project_id: pid, target: "deliverable", target_id: did, run_id, event: ev },
		);
	})
	.await;

	let out = outcome.parser.structured();
	let field = |k: &str| out.as_ref().and_then(|d| d.get(k)).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
	let title = field("title");
	let mut note: String = if request.trim().is_empty() { "작성 지침대로".into() } else { request.chars().take(200).collect() };
	// 자동 갱신은 요청이 길다(변경분까지 싣는다). 판 메모에는 어느 이슈를 반영했는지만 남긴다.
	let origin_number = if origin.is_empty() { None } else { store.raw_issue(pid, &origin).ok().map(|i| i.number) };
	if let Some(n) = origin_number {
		note = format!("이슈 #{n} 의 코드 변경 반영");
	}
	// 자동 갱신이 「반영할 것이 없다」고 답했으면 새 판을 만들지 않는다.
	let skipped = (outcome.ok && out.as_ref().and_then(|d| d.get("skip")).and_then(|x| x.as_bool()) == Some(true)).then(|| field("reason"));
	let before_n = view.deliverable.versions.len();

	if outcome.ok && skipped.is_none() {
		match &target {
			None => {
				let body = out
					.as_ref()
					.and_then(|d| d.get("document"))
					.and_then(|x| x.as_str())
					.map(|s| s.to_string())
					.unwrap_or_else(|| outcome.parser.result_text());
				if body.trim().is_empty() {
					outcome.ok = false;
					outcome.error = "Claude 가 빈 문서를 냈습니다".into();
				} else {
					store.add_version_text(pid, did, &body, "claude", &note)?;
				}
			}
			Some((dir, before)) => {
				// 새로 생겼거나 실행 중에 바뀐 파일을 고른다. Claude 가 알려 준 파일을 먼저 본다.
				let after = snapshot(dir);
				let fresh: Vec<String> = after
					.iter()
					.filter(|(name, t)| before.get(*name).map(|old| old != *t).unwrap_or(true) && **t >= started)
					.map(|(name, _)| name.clone())
					.collect();
				let reported: Vec<String> = out
					.as_ref()
					.and_then(|d| d.get("files"))
					.and_then(|x| x.as_array())
					.map(|a| a.iter().filter_map(|f| f.as_str()).filter_map(|f| Path::new(f).file_name().map(|n| n.to_string_lossy().to_string())).collect())
					.unwrap_or_default();
				let main = reported
					.iter()
					.find(|n| fresh.iter().any(|f| f.eq_ignore_ascii_case(n)))
					.cloned()
					.or_else(|| fresh.iter().max_by_key(|n| after.get(*n)).cloned());
				match main {
					Some(name) => {
						let others: Vec<&String> = fresh.iter().filter(|f| **f != name).collect();
						let mut note = { let s = field("summary"); if s.is_empty() { note.clone() } else { s } };
						if !others.is_empty() {
							note.push_str(&format!(" (함께 생긴 파일: {})", others.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")));
						}
						store.add_version_existing(pid, did, &dir.join(&name), "claude", &note)?;
					}
					None => {
						outcome.ok = false;
						outcome.error = format!("Claude 가 결과 폴더에 파일을 만들지 않았습니다: {}", dir.display());
					}
				}
			}
		}
	}

	// 자동 갱신의 결과 한 줄. 산출물 목록과 시작한 이슈의 흐름에 같은 말로 남긴다.
	let auto_line = origin_number.map(|n| {
		let what = if outcome.stopped {
			"중지".to_string()
		} else if let Some(r) = &skipped {
			if r.is_empty() { "건너뜀".to_string() } else { format!("건너뜀 · {r}") }
		} else if outcome.ok {
			format!("v{} 갱신", before_n + 1)
		} else {
			format!("실패 · {}", outcome.error.chars().take(200).collect::<String>())
		};
		(n, what)
	});
	let v = store.update_deliverable(pid, did, |d| {
		if let Some(rec) = d.runs.iter_mut().find(|r| r.id == run_id) {
			finish(rec, &outcome);
		}
		d.job = None;
		if d.title.trim().is_empty() {
			d.title = if title.is_empty() { "제목 없는 문서".into() } else { title.clone() };
		}
		d.error = if outcome.stopped || outcome.ok { String::new() } else { outcome.error.clone() };
		if let Some((n, what)) = &auto_line {
			d.auto_last = format!("#{n} · {what}");
		}
		Ok(())
	})?;
	emit_deliverable(app, &v);
	if let Some((_, what)) = &auto_line {
		crate::kb::log_issue(app, pid, &origin, format!("{} · {what}", v.deliverable.title));
	}
	if v.deliverable.versions.len() > before_n {
		crate::kb::touch(app, pid);
	}
	if !outcome.stopped {
		attention(app);
	}
	Ok(())
}

/* ---------- 제목 짓기 ---------- */

/// 새 메모의 제목 방식. 제목 모델을 껐으면 지금처럼 첫 줄을 쓴다.
pub fn new_title_mode(s: &Settings) -> TitleMode {
	if s.title_model.trim().is_empty() { TitleMode::FirstLine } else { TitleMode::Auto }
}

const TITLE_SYSTEM: &str = "너는 개발 이슈 메모에 제목을 붙인다. 한국어 한 줄, 40자 안팎의 평서문(~한다)으로 무엇을 바꾸는지 적는다. 따옴표 · 머리표 · 설명 없이 제목만 답한다.";

/// 그림 줄과 첨부 경로는 제목에 쓸 데가 없어 걷어 낸다. 긴 메모는 앞부분만 넘긴다. 제목은 앞에서 정해지고, 다 넘기면 호출이 비싸진다.
fn title_prompt(note: &str) -> String {
	let body: String = note
		.lines()
		.filter(|l| !l.trim_start().starts_with("![") && !l.contains("attachments/"))
		.collect::<Vec<_>>()
		.join("\n");
	let body: String = body.trim().chars().take(4000).collect();
	format!("아래 메모에 붙일 제목 한 줄만 답한다.\n\n## 메모\n{body}\n")
}

/// 모델이 설명을 덧붙이거나 따옴표 · 머리표를 달아도 첫 줄의 글자만 남긴다.
fn clean_title(text: &str) -> String {
	let line = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
	let line = line.trim_start_matches(['#', '-', '*', '>', ' ']).trim_start_matches("제목:").trim();
	let line = line.trim_matches(['"', '\'', '`', '「', '」', '“', '”', ' ']).trim_end_matches('.').trim();
	line.chars().take(60).collect()
}

/// 도구 없이 글만 받는 짧은 호출. 제목 짓기 · 지식베이스의 색인 카드 · 고르기 다듬기 · 자동 갱신 판정이 쓴다.
/// 파일을 고칠 일이 없어 프로젝트 실행 줄에 서지 않는다. cwd 는 앱 데이터 안 폴더다 — 프로젝트 폴더에서 돌면
/// 저장소 지침을 읽느라 토큰을 쓰고, 그 폴더의 세션 목록에 이 호출들이 섞인다.
/// 결과 형식(--json-schema)은 쓰지 않는다. 도구를 모두 닫은 채로 구조화 결과가 나오는지 확인하지 못해, 부른 쪽이 답 글에서 JSON 을 꺼낸다.
/// 끝나지 않는 호출이 순회를 붙잡지 않게 secs 에서 끊는다. 미래를 버리면 kill_on_drop 으로 claude 도 꺼진다.
/// 성공하면 답 글과 비용(USD)을 돌려준다.
/// model 이 비면 --model 을 빼 CLI 기본 모델로 돈다. 작성법 뽑기는 구현 모델을 쓰는데, 그 칸은 비어 있을 수 있다.
pub async fn quick_call(exe: PathBuf, model: &str, system: &str, prompt: String, cwd: &Path, log: PathBuf, secs: u64) -> Option<(String, f64)> {
	let mut args: Vec<String> = [
		"-p", "--output-format", "stream-json", "--verbose",
		"--tools", "",
		"--no-session-persistence",
		"--disable-slash-commands",
		"--strict-mcp-config",
		"--permission-mode", "default",
		"--system-prompt", system,
	]
	.map(String::from)
	.to_vec();
	if !model.trim().is_empty() {
		args.extend(["--model".into(), model.trim().to_string()]);
	}
	let spec = Spec { exe, cwd: cwd.to_path_buf(), args, prompt, log, root: cwd.to_string_lossy().to_string(), run_id: "quick".into() };
	let ctl = RunCtl::new();
	match tokio::time::timeout(Duration::from_secs(secs), exec(spec, &ctl, |_, _| {})).await {
		Ok(o) if o.ok => {
			let cost = o.parser.result.as_ref().and_then(|r| r.get("total_cost_usd")).and_then(|x| x.as_f64()).unwrap_or(0.0);
			Some((o.parser.result_text(), cost))
		}
		_ => None,
	}
}

/// 메모 한 장의 제목을 짓는다. cwd 는 이슈 폴더이고, 응답은 그 폴더의 title.jsonl 에 남는다.
async fn make_title(app: &AppHandle, pid: &str, iid: &str) -> Result<()> {
	let store = app.state::<Store>();
	let settings = store.settings()?;
	let view = store.get_issue(pid, iid)?;
	let seen = view.issue.note_updated_at;
	let exe = resolve_claude(&settings.claude_path).ok_or_else(|| Error::Msg("claude 실행 파일을 찾지 못했습니다".into()))?;
	let dir = PathBuf::from(&view.dir);
	let title = match quick_call(exe, settings.title_model.trim(), TITLE_SYSTEM, title_prompt(&view.note), &dir, dir.join("title.jsonl"), 90).await {
		Some((t, _)) => clean_title(&t),
		None => String::new(),
	};
	let v = store.update_issue(pid, iid, |i| {
		// 짓는 사이 손으로 고쳤거나 메모가 또 바뀌었으면 이 제목은 늦었다. 메모가 바뀐 것은 다음 순회가 다시 짓는다.
		if i.title_mode != TitleMode::Auto || i.note_updated_at != seen {
			return Ok(());
		}
		// 짓지 못해도 읽은 메모를 적어 둔다. 같은 메모로 되풀이해 부르지 않고, 첫 줄 제목이 남는다.
		i.titled_at = seen.max(1);
		if !title.is_empty() && title != i.title {
			i.title = title.clone();
			i.log("titled", title.clone());
		}
		Ok(())
	})?;
	emit_issue(app, &v);
	Ok(())
}

/// 메모가 잠잠해지면 제목을 짓는다. 고칠 때마다 다시 짓되 쓰는 도중에는 부르지 않는다.
/// title_mode 가 auto 인 이슈만 본다. 옛 이슈(first_line)와 손으로 고친 제목(manual)은 건드리지 않는다.
pub fn spawn_titler(app: AppHandle) {
	tauri::async_runtime::spawn(async move {
		loop {
			tokio::time::sleep(Duration::from_secs(3)).await;
			let store = app.state::<Store>();
			let Ok(settings) = store.settings() else { continue };
			if settings.title_model.trim().is_empty() {
				continue;
			}
			let delay = settings.title_delay_sec as i64 * 1000;
			let Ok(projects) = store.projects() else { continue };
			let now = now_ms();
			let runner = app.state::<Runner>();
			for p in projects {
				let Ok(list) = store.list_issues(&p.id) else { continue };
				for v in list {
					let i = &v.issue;
					let due = i.title_mode == TitleMode::Auto
						&& i.titled_at < i.note_updated_at
						&& !v.note.trim().is_empty()
						&& now - i.note_updated_at >= delay;
					if !due {
						continue;
					}
					let key = issue_key(&p.id, &i.id);
					{
						// 한꺼번에 몰리지 않게 동시에 둘까지만 띄운다.
						let mut titling = runner.titling.lock().unwrap();
						if titling.len() >= 2 || !titling.insert(key.clone()) {
							continue;
						}
					}
					let (app, pid, iid) = (app.clone(), p.id.clone(), i.id.clone());
					tauri::async_runtime::spawn(async move {
						if let Err(e) = make_title(&app, &pid, &iid).await {
							eprintln!("제목을 짓지 못함 #{iid}: {e}");
						}
						app.state::<Runner>().titling.lock().unwrap().remove(&key);
					});
				}
			}
		}
	});
}

/* ---------- 자동 계획 ---------- */

/// 메모를 고친 지 정한 시간이 지나면 계획을 시작한다. 실패했거나 사용자가 중지한 이슈는 다시 건드리지 않는다.
pub fn spawn_auto_planner(app: AppHandle) {
	tauri::async_runtime::spawn(async move {
		loop {
			tokio::time::sleep(Duration::from_secs(10)).await;
			let store = app.state::<Store>();
			let Ok(settings) = store.settings() else { continue };
			let delay = settings.auto_plan_delay_sec as i64 * 1000;
			let Ok(projects) = store.projects() else { continue };
			let now = now_ms();
			for p in projects {
				let Ok(list) = store.list_issues(&p.id) else { continue };
				for v in list {
					let i = &v.issue;
					let due = i.status == Status::Inbox
						&& i.auto_plan
						&& i.run.is_none()
						&& i.error.is_empty()
						&& !v.note.trim().is_empty()
						&& now - i.note_updated_at >= delay;
					if due {
						let _ = plan(&app, &p.id, &i.id, None);
					}
				}
			}
		}
	});
}

/* ---------- 실제 CLI 로 흐름을 확인하는 시험 ---------- */

#[cfg(test)]
mod tests {
	use super::*;

	/// 막힌 명령의 허용 규칙 후보: 이어 붙인 명령은 나누고, cd 는 빼고, git · npm 처럼 하위 명령이 뜻을 가르는 것은 두 낱말로 끊는다.
	#[test]
	fn suggest_rules_splits_commands_and_keeps_subcommands() {
		let cmd = |c: &str| serde_json::json!({ "command": c });
		assert_eq!(suggest_rules("Bash", &cmd(r#"cd "D:/p" && python -I check.py"#), ""), vec!["Bash(python:*)"]);
		assert_eq!(suggest_rules("Bash", &cmd("npm test -- --watch=false | tail -5"), ""), vec!["Bash(npm test:*)", "Bash(tail:*)"]);
		assert_eq!(suggest_rules("Bash", &cmd("git log --oneline; git push"), ""), vec!["Bash(git log:*)", "Bash(git push:*)"]);
		assert_eq!(suggest_rules("WebFetch", &serde_json::json!({ "url": "https://docs.rs/serde/latest" }), ""), vec!["WebFetch(domain:docs.rs)"]);
	}

	/// 대기열 묶기: 글은 차례대로 빈 줄로 잇고, 사라진 첨부 · 겹친 첨부는 걸러 내고, 하나라도 고칠 수 있으면 고칠 수 있게 보낸다.
	#[test]
	fn batch_job_joins_queue_in_order() {
		let q = |text: &str, edit: bool, images: &[&str]| QueuedChat { text: text.into(), edit, images: images.iter().map(|s| s.to_string()).collect(), ..Default::default() };
		let have = vec!["a.png".to_string(), "b.png".to_string()];
		let Some(Job::Chat { text, edit, images }) = batch_job(&[q("첫 물음 ", false, &["a.png"]), q("", false, &["gone.png"]), q("둘째", true, &["a.png", "b.png"])], &have) else {
			panic!("묶지 못했다");
		};
		assert_eq!(text, "첫 물음\n\n둘째");
		assert!(edit);
		assert_eq!(images, vec!["a.png", "b.png"]);
		let Some(Job::Chat { edit, .. }) = batch_job(&[q("읽기만", false, &[])], &have) else { panic!() };
		assert!(!edit);
		assert!(batch_job(&[q("  ", true, &["gone.png"])], &have).is_none(), "빈 묶음을 보냈다");
	}

	/// 제목 짓기: 프롬프트에서 그림 줄 · 첨부 경로를 걷고, 답에서 따옴표 · 머리표 · 덧붙인 설명을 걷는다.
	#[test]
	fn title_prompt_and_answer_are_trimmed() {
		let p = title_prompt("# 로그인 오류\n![캡처](attachments/a.png)\n버튼을 눌러도 안 넘어간다");
		assert!(p.contains("로그인 오류") && p.contains("버튼을 눌러도") && !p.contains("attachments/"));
		assert_eq!(clean_title("「로그인 버튼이 다음 화면으로 넘어가게 한다」\n\n설명: …"), "로그인 버튼이 다음 화면으로 넘어가게 한다");
		assert_eq!(clean_title("# 제목: \"설정 화면을 고친다.\""), "설정 화면을 고친다");
		assert_eq!(clean_title(&"가".repeat(100)).chars().count(), 60);
		assert_eq!(clean_title("  \n "), "");
		assert_eq!(new_title_mode(&Settings::default()), TitleMode::Auto);
		assert_eq!(new_title_mode(&Settings { title_model: " ".into(), ..Default::default() }), TitleMode::FirstLine);
	}

	/// 터미널 변경 담기: 같은 변경은 두 번 담지 않고, 이슈 전 · 되돌린 뒤보다 앞선 것은 버리고, 담으면 결과 확인으로 옮긴다.
	#[test]
	fn absorb_terminal_dedups_and_respects_cutoff() {
		let ch = |id: &str, at: i64| FileChange { rel: "a.py".into(), run_id: format!("{TERMINAL_RUN}{id}"), at, ..Default::default() };
		let turn = |changes: Vec<FileChange>| Turn { at: 0, prompt: "고쳐".into(), events: vec![RunEvent::Text { text: "고쳤다".into() }], changes };
		let mut i = Issue { created_at: 100, status: Status::Planned, ..Default::default() };
		i.history.push(HistoryEntry { at: 200, kind: "reverted".into(), text: String::new() });
		let turns = vec![turn(vec![ch("old", 50), ch("undone", 150), ch("new", 300)])];
		assert!(absorb_terminal(&mut i, &turns));
		assert_eq!(i.changes.iter().map(|c| c.run_id.as_str()).collect::<Vec<_>>(), vec!["terminal-new"]);
		assert_eq!(i.status, Status::Review);
		assert_eq!(i.result.as_ref().map(|r| r.summary.as_str()), Some("고쳤다"));
		assert!(!absorb_terminal(&mut i, &turns), "다시 읽어도 또 담지 않는다");
	}

	/// 함께 돌 근거: 계획 · 고친 파일을 저장소 기준으로 모으고, 폴더 · 와일드카드 · 저장소 밖 · 빈 목록 · 「모두 허용」 · 끈 프로젝트는 한 줄로 세운다.
	#[test]
	fn claim_files_only_when_plan_is_specific() {
		let root = std::env::temp_dir().join(format!("docket-claim-{}", short_id()));
		std::fs::create_dir_all(root.join("src")).unwrap();
		let p = Project { path: root.to_string_lossy().into(), ..Default::default() };
		let plan = |files: &[&str]| Plan { files: files.iter().map(|f| PlanFile { path: f.to_string(), change: String::new() }).collect(), ..Default::default() };
		let issue = |files: &[&str]| Issue { number: 3, plan: Some(plan(files)), ..Default::default() };
		let imp = Job::Implement { instruction: None, allow_all: false };
		let abs = format!("{}\\src\\b.rs", root.to_string_lossy());

		let mut i = issue(&["./src/a.rs", "src\\A.rs", &abs]);
		i.plan.as_mut().unwrap().steps.push(PlanStep { files: vec!["README.md".into()], ..Default::default() });
		i.changes.push(FileChange { rel: "src/c.rs".into(), ..Default::default() });
		assert_eq!(claim_files(&imp, &i, &p), Ok(vec!["src/a.rs".to_string(), "src/b.rs".into(), "README.md".into(), "src/c.rs".into()]));
		assert_eq!(claim_files(&Job::Revert, &i, &p), Ok(vec!["src/c.rs".to_string()]), "되돌리기는 고친 파일만 잡는다");

		assert_eq!(claim_files(&imp, &issue(&["src"]), &p), Err("계획에 폴더가 있어 한 줄로 섬"));
		assert_eq!(claim_files(&imp, &issue(&["src/*.rs"]), &p), Err("계획에 폴더가 있어 한 줄로 섬"));
		assert_eq!(claim_files(&imp, &issue(&["../x.rs"]), &p), Err("저장소 밖 파일이 있어 한 줄로 섬"));
		assert_eq!(claim_files(&imp, &issue(&["C:\\elsewhere\\x.rs"]), &p), Err("저장소 밖 파일이 있어 한 줄로 섬"));
		assert_eq!(claim_files(&imp, &issue(&[]), &p), Err("계획에 바꿀 파일이 없어 한 줄로 섬"));
		assert_eq!(claim_files(&Job::Implement { instruction: None, allow_all: true }, &issue(&["a.rs"]), &p), Err("모두 허용이라 한 줄로 섬"));
		assert_eq!(claim_files(&imp, &issue(&["a.rs"]), &Project { parallel_impl: false, ..p.clone() }), Err(""));
		let _ = std::fs::remove_dir_all(&root);
	}

	/// 잡기 장부: 겹치지 않으면 IMPL_SLOTS 개까지 함께, 겹치면 · 전체를 잡은 것이 있으면 기다리고, 겹치는 것끼리는 먼저 선 차례대로 들어간다.
	#[test]
	fn claims_let_disjoint_files_run_together() {
		let c = Claims::default();
		let files = |key: &str, f: &[&str]| Claim { key: key.into(), label: format!("#{key}"), files: Some(f.iter().map(|s| s.to_string()).collect()), solo: String::new() };
		let whole = |key: &str| Claim { key: key.into(), label: format!("#{key}"), files: None, solo: "계획에 폴더가 있어 한 줄로 섬".into() };

		let a = c.enqueue("p", files("1", &["src/a.rs"]));
		assert_eq!(c.try_take("p", a), Ok(()));
		let b = c.enqueue("p", files("2", &["src/b.rs"]));
		assert_eq!(c.try_take("p", b), Ok(()), "겹치지 않으면 함께 돈다");
		let d = c.enqueue("p", files("3", &["SRC/A.rs"]));
		assert_eq!(c.try_take("p", d), Err("파일이 겹쳐 기다림 · #1 · src/a.rs".into()), "대소문자만 달라도 같은 파일이다");
		let e = c.enqueue("p", files("4", &["src/e.rs"]));
		assert_eq!(c.try_take("p", e), Err(format!("함께 도는 구현이 {IMPL_SLOTS}개라 기다림")));
		assert_eq!(c.others("p", "1"), vec!["src/b.rs".to_string()]);

		// 1 이 끝나면 3 이 들어간다. 1 이 고친 계획 밖 파일은 1 이 놓을 때까지 1 의 것이다.
		assert_eq!(c.touch("p", "1", "src/x.rs"), None);
		assert_eq!(c.touch("p", "2", "src/x.rs"), Some("#1".into()), "남이 잡은 파일을 고치면 그 이름을 알린다");
		c.free("p", "1");
		assert_eq!(c.try_take("p", d), Ok(()));

		// 전체를 잡는 것은 도는 것이 모두 끝나야 들어가고, 뒤에 온 것은 그것을 앞지르지 않는다.
		let w = c.enqueue("p", whole("5"));
		assert_eq!(c.try_take("p", w), Err("앞선 작업을 기다림 · #2 · 계획에 폴더가 있어 한 줄로 섬".into()));
		c.leave("p", e);
		c.free("p", "2");
		c.free("p", "3");
		let f = c.enqueue("p", files("6", &["src/f.rs"]));
		assert!(c.try_take("p", f).is_err(), "먼저 줄 선 전체 잡기를 앞질렀다");
		assert_eq!(c.try_take("p", w), Ok(()));
		c.free("p", "5");
		assert_eq!(c.try_take("p", f), Ok(()));
		assert!(c.try_take("q", 99).is_ok() && c.others("q", "x").is_empty(), "다른 프로젝트는 따로 센다");
	}

	/// 권한 인자: 모드는 늘 적고(전역 기본 모드 auto 를 따르지 않게), 「모두 허용」도 위험 플래그 없이 허용 목록으로 연다.
	#[test]
	fn perm_args_never_skip_permissions() {
		let p = Project { allowed_tools: vec!["Bash(npm test:*)".into()], ..Default::default() };
		let s = Settings::default();
		let dir = Path::new("x");
		let i = Issue::default();
		let plan = job_args(&Job::Plan { feedback: None }, &s, &p, &i, dir, None);
		let at = |a: &[String], k: &str| a.iter().position(|x| x == k).map(|i| a[i + 1].clone());
		assert_eq!(at(&plan, "--permission-mode").as_deref(), Some("default"));
		assert_eq!(at(&plan, "--tools").as_deref(), Some("Read,Grep,Glob,Bash"));
		assert!(plan.iter().any(|x| x == "Bash(svn log:*)") && !plan.iter().any(|x| x == "Bash(npm test:*)"), "계획에 구현용 허용 목록이 섞였다");
		assert!(at(&plan, "--settings").unwrap().contains("git push"), "기본 거부 목록이 걸리지 않았다");

		let once = job_args(&Job::Implement { instruction: None, allow_all: true }, &s, &p, &i, dir, None);
		assert_eq!(at(&once, "--permission-mode").as_deref(), Some("acceptEdits"));
		assert!(once.iter().any(|x| x == "Bash") && once.iter().any(|x| x == "Bash(npm test:*)"));
		let all = job_args(&Job::Revert, &s, &Project { impl_mode: "bypassPermissions".into(), ..p.clone() }, &i, dir, None);
		for a in [&plan, &once, &all] {
			assert!(!a.iter().any(|x| x.contains("dangerously")), "위험 플래그를 썼다: {a:?}");
		}
		assert_eq!(job_perms(&Job::Implement { instruction: None, allow_all: true }, &p).label, "모두 허용 · 이번만");
	}

	/// 모델: 메모에서 고른 것이 앞서고, 없으면 실행 종류에 맞는 설정 칸이다. 모두 비면 --model 을 넘기지 않는다.
	#[test]
	fn model_follows_memo_then_run_kind() {
		let p = Project::default();
		let dir = Path::new("x");
		let model = |a: &[String]| a.iter().position(|x| x == "--model").map(|i| a[i + 1].clone());
		let i = Issue::default();
		let none = job_args(&Job::Plan { feedback: None }, &Settings::default(), &p, &i, dir, None);
		assert_eq!(model(&none), None);

		let s = Settings { plan_model: "opus".into(), impl_model: "sonnet".into(), chat_model: "haiku".into(), ..Default::default() };
		let chat = Job::Chat { text: "물음".into(), edit: false, images: vec![] };
		assert_eq!(model(&job_args(&Job::Plan { feedback: None }, &s, &p, &i, dir, None)).as_deref(), Some("opus"));
		assert_eq!(model(&job_args(&Job::Implement { instruction: None, allow_all: false }, &s, &p, &i, dir, None)).as_deref(), Some("sonnet"));
		assert_eq!(model(&job_args(&Job::Revert, &s, &p, &i, dir, None)).as_deref(), Some("sonnet"));
		assert_eq!(model(&job_args(&chat, &s, &p, &i, dir, None)).as_deref(), Some("haiku"));
		let memo = Issue { model: " fable ".into(), ..Default::default() };
		assert_eq!(model(&job_args(&chat, &s, &p, &memo, dir, None)).as_deref(), Some("fable"), "메모 모델이 앞서지 않았다");
		assert_eq!(model(&doc_args(&s, &p, dir, None)).as_deref(), Some("sonnet"));
	}

	/// effort: 모델과 같은 순서로 고르되 따로 고른다. 모두 비면 --effort 를 넘기지 않는다.
	#[test]
	fn effort_follows_memo_then_run_kind() {
		let p = Project::default();
		let dir = Path::new("x");
		let effort = |a: &[String]| a.iter().position(|x| x == "--effort").map(|i| a[i + 1].clone());
		let i = Issue::default();
		assert_eq!(effort(&job_args(&Job::Plan { feedback: None }, &Settings::default(), &p, &i, dir, None)), None);
		assert_eq!(effort(&doc_args(&Settings::default(), &p, dir, None)), None);

		let s = Settings { plan_effort: "high".into(), impl_effort: "medium".into(), chat_effort: "low".into(), ..Default::default() };
		let chat = Job::Chat { text: "물음".into(), edit: false, images: vec![] };
		assert_eq!(effort(&job_args(&Job::Plan { feedback: None }, &s, &p, &i, dir, None)).as_deref(), Some("high"));
		assert_eq!(effort(&job_args(&Job::Implement { instruction: None, allow_all: false }, &s, &p, &i, dir, None)).as_deref(), Some("medium"));
		assert_eq!(effort(&job_args(&Job::Revert, &s, &p, &i, dir, None)).as_deref(), Some("medium"));
		assert_eq!(effort(&job_args(&chat, &s, &p, &i, dir, None)).as_deref(), Some("low"));
		assert_eq!(effort(&doc_args(&s, &p, dir, None)).as_deref(), Some("medium"), "산출물이 구현 effort 를 따르지 않았다");

		let memo = Issue { effort: " max ".into(), ..Default::default() };
		assert_eq!(effort(&job_args(&chat, &s, &p, &memo, dir, None)).as_deref(), Some("max"), "메모 effort 가 앞서지 않았다");
		let model_only = Issue { model: "opus".into(), ..Default::default() };
		assert_eq!(effort(&job_args(&chat, &s, &p, &model_only, dir, None)).as_deref(), Some("low"), "메모 모델만 골랐는데 effort 가 설정을 따르지 않았다");
	}

	/// 결과 화면: 그림 파일만 실행 폴더로 모으고, 이슈 폴더 것은 옮기고 밖의 것은 복사한다.
	#[test]
	fn shots_are_collected_into_run_folder() {
		let dir = std::env::temp_dir().join(format!("docket-shots-{}", short_id()));
		let outside = std::env::temp_dir().join(format!("docket-shot-{}.png", short_id()));
		std::fs::create_dir_all(dir.join("shots")).unwrap();
		std::fs::write(dir.join("shots").join("main.png"), b"png").unwrap();
		std::fs::write(&outside, b"png").unwrap();
		std::fs::write(dir.join("shots").join("note.txt"), b"x").unwrap();
		let shot = |p: &Path, c: &str| Shot { path: p.to_string_lossy().into(), caption: c.into() };
		let mut r = ImplResult {
			screenshots: vec![
				shot(&dir.join("shots").join("main.png"), " 첫 화면 "),
				shot(&outside, "임시 폴더"),
				shot(&dir.join("shots").join("note.txt"), "그림 아님"),
				shot(&dir.join("없음.png"), "없는 파일"),
			],
			..Default::default()
		};
		collect_shots(&mut r, &dir, "r1");
		let got: Vec<(&str, &str)> = r.screenshots.iter().map(|s| (s.path.as_str(), s.caption.as_str())).collect();
		assert_eq!(got, vec![("shots/r1/01-main.png", "첫 화면"), (format!("shots/r1/02-{}", outside.file_name().unwrap().to_string_lossy()).as_str(), "임시 폴더")]);
		assert!(!dir.join("shots").join("main.png").exists(), "shots 바로 아래 것은 옮겨야 한다");
		assert!(outside.is_file(), "밖의 파일은 복사만 해야 한다");
		assert!(dir.join("shots").join("r1").join("01-main.png").is_file());
		let _ = std::fs::remove_dir_all(&dir);
		let _ = std::fs::remove_file(&outside);
	}

	/// screenshots 가 없던 때 저장한 결과도 그대로 읽힌다.
	#[test]
	fn old_result_without_screenshots_still_reads() {
		let r: ImplResult = serde_json::from_str(r#"{"summary":"s","changed":[],"verification":"v","followups":[]}"#).unwrap();
		assert!(r.screenshots.is_empty());
	}

	/// 이슈 폴더 · 임시 폴더에 쓴 것은 바꾼 파일로 남기지 않는다. 저장소 안 파일은 남긴다.
	#[test]
	fn scratch_paths_are_not_changes() {
		let tmp = std::env::temp_dir().join("shot.js");
		assert!(scratch_path(&tmp.to_string_lossy(), "D:\\data\\issues\\a"));
		assert!(scratch_path("D:\\data\\issues\\a\\shots\\x.png", "D:\\data\\issues\\a"));
		assert!(!scratch_path("D:\\p\\src\\App.tsx", "D:\\data\\issues\\a"));
	}

	/// 되돌리기에 넘기는 변경분: 고친 파일은 diff 로 싣고, 새로 만든 파일은 앱이 치우므로 목록에만 둔다.
	#[test]
	fn revert_block_lists_diffs_and_leaves_created_files_to_app() {
		let edit = FileChange {
			path: "D:\\p\\calc.py".into(),
			rel: "calc.py".into(),
			kind: "edit".into(),
			hunks: vec![Hunk { old_start: 1, old_lines: 2, new_start: 1, new_lines: 2, lines: vec![" def add(a, b):".into(), "-    return a - b".into(), "+    return a + b".into()] }],
			..Default::default()
		};
		let made = FileChange { path: "D:\\p\\t.py".into(), rel: "t.py".into(), kind: "create".into(), hunks: vec![Hunk { lines: vec!["+x = 1".into()], ..Default::default() }], ..Default::default() };
		let again = FileChange { kind: "edit".into(), ..made.clone() };
		let s = revert_block(&[edit, made, again]);
		assert!(s.contains("### calc.py (edit)") && s.contains("@@ -1,2 +1,2 @@") && s.contains("+    return a + b"));
		assert!(s.contains("- D:\\p\\t.py"), "새 파일 목록이 없다");
		assert!(!s.contains("### t.py"), "앱이 치울 새 파일의 변경분까지 넘겼다");
		assert_eq!(created_files(&[FileChange { kind: "create".into(), path: "a".into(), ..Default::default() }]), vec!["a".to_string()]);
	}

	#[test]
	fn stage_mark_is_stripped_and_read() {
		assert_eq!(stage_mark("설계는 이렇다.\n\n[단계:설계] 저장 단추를 위로 옮긴다"), ("설계는 이렇다.".into(), Some("저장 단추를 위로 옮긴다".into())));
		assert_eq!(stage_mark("답\n`[단계:설계]`"), ("답".into(), Some(String::new())));
		assert_eq!(stage_mark("그냥 답"), ("그냥 답".into(), None));
	}

	#[test]
	fn memo_blocks_are_read_and_markers_stripped() {
		let (shown, blocks) = memo_blocks("남겼습니다.\n\n[메모:등록] 저장 단추를 위로\n저장 단추가 아래에 묻힌다.\n`a.tsx:10`\n[/메모]");
		assert_eq!(shown, "남겼습니다.\n\n저장 단추가 아래에 묻힌다.\n`a.tsx:10`");
		assert_eq!(blocks, vec![("저장 단추를 위로".to_string(), "저장 단추가 아래에 묻힌다.\n`a.tsx:10`".to_string())]);

		let (_, two) = memo_blocks("`[메모:등록] 하나`\n본문 1\n`[/메모]`\n[메모:등록]\n# 둘째 제목\n본문 2\n[/메모]");
		assert_eq!(two.len(), 2);
		assert_eq!(two[1].0, "둘째 제목");

		// 닫는 줄이 없으면 등록하지 않는다. 본문은 답으로 남는다.
		assert_eq!(memo_blocks("[메모:등록] 반쪽\n끊긴 본문"), ("끊긴 본문".into(), Vec::new()));
		assert_eq!(memo_blocks("그냥 답"), ("그냥 답".into(), Vec::new()));
	}

	/// 2026-10-28 전에 저장된 계획은 질문이 문자열이고 steps 가 없다. 그대로 열려야 한다.
	#[test]
	fn old_plan_questions_still_load() {
		let p: Plan = serde_json::from_str(r#"{"title":"t","questions":["반올림할까요?",{"header":"범위","question":"어디까지?","options":[{"label":"전부","description":"","recommended":true}],"multi":false}]}"#).unwrap();
		assert!(p.steps.is_empty());
		assert_eq!(p.questions[0].question, "반올림할까요?");
		assert!(p.questions[0].options.is_empty());
		assert_eq!(p.questions[1].header, "범위");
		assert!(p.questions[1].options[0].recommended);
		let schema: Value = serde_json::from_str(PLAN_SCHEMA).unwrap();
		assert!(schema["properties"]["steps"].is_object());
	}

	/// claude 를 실제로 부른다(비용이 든다). DOCKET_TEST_PROJECT 에 일부러 틀린 calc.py 가 든 폴더를 주고
	/// `cargo test -- --ignored --nocapture` 로 돌린다. 계획 → 같은 세션으로 구현 → 바뀐 파일 기록까지 본다.
	#[tokio::test]
	#[ignore]
	async fn plan_then_implement_with_real_claude() {
		let root = std::env::var("DOCKET_TEST_PROJECT").expect("DOCKET_TEST_PROJECT");
		let exe = resolve_claude("").expect("claude 실행 파일");
		let settings = Settings { plan_model: "haiku".into(), impl_model: "haiku".into(), chat_model: "haiku".into(), ..Default::default() };
		let project = Project { path: root.clone(), ..Default::default() };
		let issue_dir = std::env::temp_dir().join(format!("docket-test-{}", short_id()));
		std::fs::create_dir_all(&issue_dir).unwrap();
		let mut view = IssueView {
			issue: Issue { number: 1, ..Default::default() },
			note: "calc.py 의 add 가 더하지 않고 뺀다\n\n고쳐 주세요.".into(),
			attachments: Vec::new(),
			dir: issue_dir.to_string_lossy().to_string(),
		};
		let ctl = RunCtl::new();

		let job = Job::Plan { feedback: None };
		let spec = Spec {
			exe: exe.clone(),
			cwd: PathBuf::from(&root),
			args: job_args(&job, &settings, &project, &view.issue, &issue_dir, None),
			prompt: issue_prompt(&job, &view, false),
			log: issue_dir.join("plan.jsonl"),
			root: root.clone(),
			run_id: "plan".into(),
		};
		let mut tools = Vec::new();
		let o = exec(spec, &ctl, |ev, _| {
			if let RunEvent::Tool { name, .. } = ev {
				tools.push(name.clone());
			}
		})
		.await;
		assert!(o.ok, "계획 실패: {}", o.error);
		assert!(!tools.iter().any(|t| t == "Edit" || t == "Write"), "계획 단계에서 편집 도구를 썼다: {tools:?}");
		let plan = parse_plan(&o, "fallback", "plan");
		println!("계획: {} / 파일 {:?}", plan.title, plan.files.iter().map(|f| &f.path).collect::<Vec<_>>());
		assert!(!plan.plan.trim().is_empty());
		assert!(!o.parser.session_id.is_empty());
		assert!(std::fs::read_to_string(Path::new(&root).join("calc.py")).unwrap().contains("a - b"), "계획 단계에서 파일이 바뀌었다");

		view.issue.plan = Some(plan);
		view.issue.session_id = o.parser.session_id.clone();

		// 대화: 계획 세션을 이어 묻는다. 계획 때 본 것을 기억해야 답할 수 있는 질문이다.
		let job = Job::Chat { text: "방금 세운 계획에서 고칠 파일 이름만 답해. 다른 말은 붙이지 마.".into(), edit: false, images: vec![] };
		let spec = Spec {
			exe: exe.clone(),
			cwd: PathBuf::from(&root),
			args: job_args(&job, &settings, &project, &view.issue, &issue_dir, Some(&view.issue.session_id)),
			prompt: issue_prompt(&job, &view, true),
			log: issue_dir.join("chat.jsonl"),
			root: root.clone(),
			run_id: "chat".into(),
		};
		let (mut said, mut tools) = (String::new(), Vec::new());
		let o = exec(spec, &ctl, |ev, _| match ev {
			RunEvent::Text { text } => said.push_str(text),
			RunEvent::Tool { name, .. } => tools.push(name.clone()),
			_ => {}
		})
		.await;
		assert!(o.ok, "대화 실패: {}", o.error);
		println!("대화 답: {said}\n대화 세션 {} · 계획 세션 {}", o.parser.session_id, view.issue.session_id);
		assert!(said.contains("calc"), "계획을 기억하지 못했다: {said}");
		assert!(!tools.iter().any(|t| t == "Edit" || t == "Write"), "읽기 전용 대화에서 편집 도구를 썼다: {tools:?}");
		assert!(std::fs::read_to_string(Path::new(&root).join("calc.py")).unwrap().contains("a - b"), "대화에서 파일이 바뀌었다");
		// 세션 기록 파일에서 같은 질문을 다시 읽을 수 있어야 터미널에서 이은 대화도 화면에 보인다.
		let path = transcript_path(&root, &o.parser.session_id).expect("세션 기록 파일");
		let turns = read_turns(&path, &root).unwrap();
		println!("세션 기록 {} · 차례 {}", path.display(), turns.len());
		assert!(turns.iter().any(|t| t.prompt.contains("고칠 파일 이름만")), "세션 기록에서 질문을 찾지 못했다");
		assert!(turns.last().map(|t| t.events.iter().any(|e| matches!(e, RunEvent::Text { .. }))).unwrap_or(false), "세션 기록에서 답을 찾지 못했다");
		view.issue.session_id = o.parser.session_id.clone();

		let job = Job::Implement { instruction: None, allow_all: false };
		let spec = Spec {
			exe: exe.clone(),
			cwd: PathBuf::from(&root),
			args: job_args(&job, &settings, &project, &view.issue, &issue_dir, Some(&view.issue.session_id)),
			prompt: issue_prompt(&job, &view, true),
			log: issue_dir.join("impl.jsonl"),
			root: root.clone(),
			run_id: "impl".into(),
		};
		let o = exec(spec, &ctl, |_, _| {}).await;
		assert!(o.ok, "구현 실패: {}", o.error);
		let r = parse_result(&o, "impl");
		println!("결과: {}\n확인: {}", r.summary, r.verification);
		assert!(!o.parser.changes.is_empty(), "바뀐 파일을 잡지 못했다");
		let c = &o.parser.changes[0];
		println!("바뀐 파일 {} ({}) {:?}", c.rel, c.kind, count_lines(c));
		assert_eq!(c.rel, "calc.py");
		assert!(std::fs::read_to_string(Path::new(&root).join("calc.py")).unwrap().contains("a + b"));

		// 되돌리기: 기록한 변경분을 넘겨 같은 세션에서 거꾸로 고치게 한다. 고치기 전 코드로 돌아와야 한다.
		view.issue.session_id = o.parser.session_id.clone();
		view.issue.changes = o.parser.changes.clone();
		let job = Job::Revert;
		let spec = Spec {
			exe,
			cwd: PathBuf::from(&root),
			args: job_args(&job, &settings, &project, &view.issue, &issue_dir, Some(&view.issue.session_id)),
			prompt: issue_prompt(&job, &view, true),
			log: issue_dir.join("revert.jsonl"),
			root: root.clone(),
			run_id: "revert".into(),
		};
		let o = exec(spec, &ctl, |_, _| {}).await;
		assert!(o.ok, "되돌리기 실패: {}", o.error);
		println!("되돌림: {}", parse_result(&o, "revert").summary);
		let now = std::fs::read_to_string(Path::new(&root).join("calc.py")).unwrap();
		assert!(now.contains("a - b") && !now.contains("a + b"), "되돌리지 못했다:\n{now}");
		let _ = std::fs::remove_dir_all(&issue_dir);
	}
}

#[cfg(test)]
mod doc_tests {
	use super::*;

	/// 「파일로 만들기」를 실제 CLI 로 본다(비용이 든다). 결과 폴더에만 파일이 생기고 저장소는 그대로여야 한다.
	/// DOCKET_TEST_PROJECT 에 calc.py 가 든 폴더를 주고 `cargo test file_mode -- --ignored --nocapture`
	#[tokio::test]
	#[ignore]
	async fn file_mode_writes_only_to_output() {
		let root = std::env::var("DOCKET_TEST_PROJECT").expect("DOCKET_TEST_PROJECT");
		let exe = resolve_claude("").expect("claude 실행 파일");
		let settings = Settings { plan_model: "haiku".into(), impl_model: "haiku".into(), chat_model: "haiku".into(), ..Default::default() };
		let project = Project { path: root.clone(), ..Default::default() };
		let base = std::env::temp_dir().join(format!("docket-doc-{}", short_id()));
		let (data, out) = (base.join("data"), base.join("out"));
		std::fs::create_dir_all(data.join("refs")).unwrap();
		std::fs::create_dir_all(&out).unwrap();
		std::fs::write(data.join("refs").join("양식.md"), "# 함수 목록\n\n| 함수 | 하는 일 |\n| - | - |\n").unwrap();
		let view = DeliverableView {
			deliverable: Deliverable { title: "함수 목록".into(), guide: "calc.py 의 함수를 양식의 표에 채운다.".into(), mode: "file".into(), ..Default::default() },
			dir: data.to_string_lossy().into(),
			refs: vec![RefFile { name: "양식.md".into(), size: 0, kind: "direct".into(), text_path: String::new(), template: false }],
			output_dir: out.to_string_lossy().into(),
			next_name: String::new(),
		};
		let repo_before = snapshot(Path::new(&root));
		let spec = Spec {
			exe,
			cwd: PathBuf::from(&root),
			args: doc_args(&settings, &project, &data, Some(&out)),
			prompt: doc_file_prompt(&doc_material(&view, "", None), &out, "함수_목록_v1", ""),
			log: base.join("run.jsonl"),
			root: root.clone(),
			run_id: "t".into(),
		};
		let o = exec(spec, &RunCtl::new(), |_, _| {}).await;
		assert!(o.ok, "실패: {}", o.error);
		let made: Vec<String> = snapshot(&out).into_keys().collect();
		println!("만든 파일: {made:?}\n{}", made.first().map(|f| std::fs::read_to_string(out.join(f)).unwrap_or_default()).unwrap_or_default());
		assert!(made.iter().any(|f| f.starts_with("함수_목록_v1")), "이름 규칙대로 만들지 않았다");
		assert_eq!(snapshot(Path::new(&root)), repo_before, "저장소가 바뀌었다");
		let _ = std::fs::remove_dir_all(&base);
	}
}

#[cfg(all(test, windows))]
mod job_tests {
	use super::*;

	/// 작업 개체에 넣은 자식이 시험 프로세스와 함께 끝나는지 본다. 이 시험이 출력한 PID 를 시험이 끝난 뒤 tasklist 로 찾아
	/// 없어야 맞다. `cargo test job_kills -- --ignored --nocapture`
	#[tokio::test]
	#[ignore]
	async fn job_kills_child_on_exit() {
		let child = tokio::process::Command::new("ping").args(["-n", "60", "127.0.0.1"]).stdout(std::process::Stdio::null()).spawn().unwrap();
		bind_to_app(&child);
		println!("CHILD_PID={}", child.id().unwrap());
		// kill_on_drop 을 걸지 않았고 소멸자도 돌지 않게 잊는다. 그래도 프로세스가 끝나면 함께 꺼져야 한다.
		std::mem::forget(child);
	}
}

#[cfg(test)]
mod perm_tests {
	use super::*;

	/// 읽기 모드(계획 · 읽기 대화)를 실제 CLI 로 본다(비용이 든다). git 저장소인 DOCKET_TEST_PROJECT 를 주고
	/// `cargo test read_mode -- --ignored --nocapture`. git log 는 돌고, 상태를 바꾸는 명령은 「ask」로 막혀 거부 사건이 잡혀야 한다.
	/// echo · ls 같은 읽기 전용 명령은 CLI 가 원래 묻지 않고 통과시키므로 막히는 쪽 시험에 쓰지 않는다 (2026-10-28 실측).
	#[tokio::test]
	#[ignore]
	async fn read_mode_allows_vcs_log_and_reports_denials() {
		let root = std::env::var("DOCKET_TEST_PROJECT").expect("DOCKET_TEST_PROJECT");
		let exe = resolve_claude("").expect("claude 실행 파일");
		let settings = Settings { plan_model: "haiku".into(), impl_model: "haiku".into(), chat_model: "haiku".into(), ..Default::default() };
		let project = Project { path: root.clone(), ..Default::default() };
		let dir = std::env::temp_dir().join(format!("docket-perm-{}", short_id()));
		std::fs::create_dir_all(&dir).unwrap();
		let view = IssueView { issue: Issue { number: 1, ..Default::default() }, note: "권한 시험".into(), attachments: Vec::new(), dir: dir.to_string_lossy().into() };
		let job = Job::Chat { text: "Bash 로 `git log --oneline -1` 을 실행해 결과를 말해. 그다음 Bash 로 `touch probe.txt` 도 실행해 봐. 막히면 막혔다고만 말하고 다른 방법은 쓰지 마.".into(), edit: false, images: vec![] };
		let spec = Spec {
			exe,
			cwd: PathBuf::from(&root),
			args: job_args(&job, &settings, &project, &view.issue, &dir, None),
			prompt: issue_prompt(&job, &view, true),
			log: dir.join("read.jsonl"),
			root: root.clone(),
			run_id: "read".into(),
		};
		let o = exec(spec, &RunCtl::new(), |_, _| {}).await;
		assert!(o.ok, "실패: {}", o.error);
		println!("명령: {:?}\n막힘: {:?}", o.parser.commands, o.parser.denials);
		assert!(o.parser.commands.iter().any(|c| c.contains("git log")), "git log 를 실행하지 않았다");
		assert!(!o.parser.denials.iter().any(|d| d.target.contains("git log")), "git log 가 막혔다");
		let touch = o.parser.denials.iter().find(|d| d.target.contains("touch")).expect("touch 가 막히지 않았다");
		assert_eq!(touch.reason, "ask");
		assert_eq!(touch.suggest, vec!["Bash(touch:*)"]);
		assert!(!Path::new(&root).join("probe.txt").exists(), "읽기 모드에서 파일이 생겼다");
		let _ = std::fs::remove_dir_all(&dir);
	}
}
