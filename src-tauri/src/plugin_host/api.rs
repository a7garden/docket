//! 플러그인 API: wasm 이 받는 입력 · 돌려주는 값 · 부를 수 있는 호스트 함수.
//! 플러그인 작성자용 타입(`examples/plugins/docket-plugin.d.ts`)과 이름을 맞춘다. 바꾸면 manifest::API_VERSION 을 올린다.
//!
//! 입력 (on_event · on_command 모두 JSON 글 하나):
//! ```json
//! { "apiVersion": 1, "event": "implemented", "command": "", "where": "",
//!   "project": { "id": "…", "name": "calc", "path": "D:\\work\\calc" },
//!   "issue": { "id": "…", "number": 4, "title": "…", "status": "review", "changes": [{ "path": "…", "rel": "calc.py", "kind": "edit" }], … },
//!   "deliverable": null, "file": "", "settings": { "webhook": "…" } }
//! ```
//! `issue:read` 권한이 없으면 project 는 id · name, issue 는 id · number 만 싣는다.
//!
//! 호스트 함수 (네임스페이스 extism:host/user · 입력도 출력도 글 하나):
//! | 함수 | 권한 | 입력 → 출력 |
//! | - | - | - |
//! | docket_log | 없음 | 글 → "" · 플러그인 기록(log.jsonl)에 남긴다 |
//! | docket_notify | notify | 글 → "" · 앱 안 알림 |
//! | docket_open | open | 경로 · http(s) 주소 → "" |
//! | docket_issue_get | issue:read | {"projectId","issueId"} → 입력의 issue 꼴 |
//! | docket_kv_get · docket_kv_set | storage | 키 → 값 · {"key","value"} → "" |
//! | docket_run | process:<이름> | {"exe","args","cwd"} → {"ok","code","stdout","stderr","timedOut"} |
//!
//! 구획: 입력 · 돌려주는 값 · 호스트 함수

use std::collections::BTreeMap;
use std::path::PathBuf;

use extism::{Function, PTR, UserData, host_fn};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use super::manifest::{self, Manifest};
use crate::store::Store;

/* ---------- 입력 ---------- */

/// 무엇에 대해 부르는지. 사건이면 그 이슈 · 산출물, 메뉴면 누른 자리다.
#[derive(Debug, Clone, Default)]
pub struct Target {
	pub project_id: String,
	pub issue_id: String,
	pub deliverable_id: String,
	/// 바뀐 파일 머리에서 누른 메뉴의 파일 경로
	pub file: String,
}

fn issue_json(store: &Store, pid: &str, iid: &str, full: bool) -> Value {
	let Ok(v) = store.get_issue(pid, iid) else { return Value::Null };
	let i = &v.issue;
	if !full {
		return json!({ "id": i.id, "number": i.number });
	}
	// 같은 파일을 여러 번 고쳤어도 한 줄로 싣는다. 꼴(kind)은 처음 것을 쓴다 — 새로 만든 파일을 고쳐도 「만듦」으로 남게.
	let mut seen = std::collections::HashSet::new();
	let changes: Vec<Value> = i.changes.iter().filter(|c| seen.insert(c.path.clone())).map(|c| json!({ "path": c.path, "rel": c.rel, "kind": c.kind })).collect();
	json!({
		"id": i.id,
		"number": i.number,
		"title": i.title,
		"status": i.status,
		"note": v.note,
		"sessionId": i.session_id,
		"error": i.error,
		"dir": v.dir,
		"plan": i.plan.as_ref().map(|p| json!({ "title": p.title, "summary": p.summary, "plan": p.plan, "risks": p.risks })),
		"result": i.result.as_ref().map(|r| json!({ "summary": r.summary, "verification": r.verification, "followups": r.followups })),
		"changes": changes,
		"follows": i.follows.as_ref().map(|f| json!({ "id": f.id, "number": f.number, "title": f.title })),
	})
}

/// 플러그인에 넘길 입력. `head` 에 event 또는 command · where 를 담아 온다.
pub fn input(store: &Store, m: &Manifest, grants: &[String], head: Value, t: &Target, settings: Value) -> Value {
	let full = grants.iter().any(|g| g == "issue:read");
	let project = match store.project(&t.project_id) {
		Ok(p) if full => json!({ "id": p.id, "name": p.name, "path": p.path }),
		Ok(p) => json!({ "id": p.id, "name": p.name }),
		Err(_) => Value::Null,
	};
	let issue = if t.issue_id.is_empty() { Value::Null } else { issue_json(store, &t.project_id, &t.issue_id, full) };
	let deliverable = match store.get_deliverable(&t.project_id, &t.deliverable_id) {
		Ok(d) if !t.deliverable_id.is_empty() && full => {
			let last = d.deliverable.versions.last().and_then(|v| store.version_path(&t.project_id, &t.deliverable_id, v.n).ok());
			json!({ "id": d.deliverable.id, "title": d.deliverable.title, "versions": d.deliverable.versions.len(), "latest": last })
		}
		Ok(d) if !t.deliverable_id.is_empty() => json!({ "id": d.deliverable.id }),
		_ => Value::Null,
	};
	let mut v = json!({
		"apiVersion": manifest::API_VERSION,
		"event": "",
		"command": "",
		"where": "",
		"plugin": { "id": m.id, "version": m.version },
		"project": project,
		"issue": issue,
		"deliverable": deliverable,
		"file": if full { t.file.clone() } else { String::new() },
		"settings": settings,
	});
	if let (Some(o), Value::Object(h)) = (v.as_object_mut(), head) {
		o.extend(h);
	}
	v
}

/* ---------- 돌려주는 값 ---------- */

/// on_command 가 돌려주는 것. 화면이 그린다 — 플러그인이 화면을 직접 만지지 않는다. 모두 비어도 된다.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Reply {
	/// 앱 안 알림 한 줄
	pub toast: String,
	/// 기본 프로그램으로 열 경로 · 주소 (open 권한)
	pub open: String,
	/// 클립보드에 넣을 글
	pub copy: String,
	/// 창에 띄울 마크다운. 앱의 마크다운 표시로 그리고, 스크립트 · 원시 HTML 은 그리지 않는다.
	pub markdown: String,
	/// 창의 제목
	pub title: String,
}

/// 플러그인이 낸 글을 Reply 로 읽는다. 빈 글이면 할 일이 없다는 뜻이다.
pub fn reply(out: &str, grants: &[String]) -> Result<Reply, String> {
	if out.trim().is_empty() {
		return Ok(Reply::default());
	}
	let r: Reply = serde_json::from_str(out).map_err(|e| format!("돌려준 값을 읽지 못했습니다: {e}"))?;
	if !r.open.is_empty() && !grants.iter().any(|g| g == "open") {
		return Err("열기(open) 권한 없이 open 을 돌려주었습니다".into());
	}
	Ok(r)
}

/* ---------- 호스트 함수 ---------- */

/// 호스트 함수가 쓰는 것. 플러그인 하나에 하나다.
pub struct HostCtx {
	pub app: AppHandle,
	pub name: String,
	pub grants: Vec<String>,
	pub data: PathBuf,
}

/// 2026.10.29 : 바깥 프로그램 하나가 돌 수 있는 시간. 플러그인 한 번 부르기(wasm::CALL_LIMIT 30초)보다 짧아야 결과를 받아 볼 수 있다.
#[cfg(windows)]
const RUN_LIMIT: std::time::Duration = std::time::Duration::from_secs(25);
/// kv.json 이 이보다 커지면 더 쓰지 않는다. 플러그인 하나가 앱 데이터 폴더를 채우지 못하게 한다.
const KV_LIMIT: usize = 1 << 20;

type Ctx = UserData<HostCtx>;

fn with<T>(ud: &Ctx, f: impl FnOnce(&HostCtx) -> Result<T, extism::Error>) -> Result<T, extism::Error> {
	let arc = ud.get()?;
	let c = arc.lock().map_err(|_| extism::Error::msg("플러그인 상태를 잠그지 못했습니다"))?;
	f(&c)
}

fn kv_path(c: &HostCtx) -> PathBuf {
	c.data.join("kv.json")
}

fn kv_read(c: &HostCtx) -> BTreeMap<String, String> {
	std::fs::read(kv_path(c)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

host_fn!(docket_log(ud: HostCtx; text: String) -> String {
	with(&ud, |c| {
		super::log(&c.data, "log", "", true, &text);
		Ok(String::new())
	})
});

host_fn!(docket_notify(ud: HostCtx; text: String) -> String {
	with(&ud, |c| {
		let _ = c.app.emit("docket://plugin-notice", json!({ "plugin": c.name, "text": text.chars().take(300).collect::<String>() }));
		Ok(String::new())
	})
});

host_fn!(docket_open(ud: HostCtx; target: String) -> String {
	with(&ud, |c| {
		use tauri_plugin_opener::OpenerExt;
		let t = target.trim();
		let r = if t.starts_with("https://") || t.starts_with("http://") {
			c.app.opener().open_url(t, None::<&str>)
		} else {
			c.app.opener().open_path(t, None::<&str>)
		};
		r.map_err(|e| extism::Error::msg(e.to_string()))?;
		Ok(String::new())
	})
});

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueRef {
	project_id: String,
	issue_id: String,
}

host_fn!(docket_issue_get(ud: HostCtx; req: String) -> String {
	with(&ud, |c| {
		let r: IssueRef = serde_json::from_str(&req)?;
		let store = c.app.state::<Store>();
		Ok(issue_json(&store, &r.project_id, &r.issue_id, true).to_string())
	})
});

host_fn!(docket_kv_get(ud: HostCtx; key: String) -> String {
	with(&ud, |c| Ok(kv_read(c).remove(&key).unwrap_or_default()))
});

#[derive(Deserialize)]
struct KvSet {
	key: String,
	value: String,
}

host_fn!(docket_kv_set(ud: HostCtx; req: String) -> String {
	with(&ud, |c| {
		let r: KvSet = serde_json::from_str(&req)?;
		let mut kv = kv_read(c);
		if r.value.is_empty() {
			kv.remove(&r.key);
		} else {
			kv.insert(r.key, r.value);
		}
		let bytes = serde_json::to_vec(&kv)?;
		if bytes.len() > KV_LIMIT {
			return Err(extism::Error::msg("저장소가 1MB 를 넘습니다"));
		}
		crate::store::write_atomic(&kv_path(c), &bytes).map_err(|e| extism::Error::msg(e.to_string()))?;
		Ok(String::new())
	})
});

#[derive(Deserialize, Default)]
#[serde(default)]
struct RunReq {
	exe: String,
	args: Vec<String>,
	cwd: String,
}

host_fn!(docket_run(ud: HostCtx; req: String) -> String {
	with(&ud, |c| {
		let r: RunReq = serde_json::from_str(&req)?;
		// 이름만 받는다. 경로를 받으면 허락한 이름과 같은 이름의 다른 파일을 부를 수 있다.
		if r.exe.contains(['/', '\\']) || !manifest::allows_process(&c.grants, &r.exe) {
			return Err(extism::Error::msg(format!("허락받지 않은 실행 파일입니다: {} · permissions 에 process:{} 를 적고 다시 허락받으세요", r.exe, manifest::exe_name(&r.exe))));
		}
		let exe = super::terminal::resolve_exe(&r.exe).ok_or_else(|| extism::Error::msg(format!("실행 파일을 찾지 못했습니다: {}", r.exe)))?;
		let cwd = if r.cwd.is_empty() { c.data.clone() } else { PathBuf::from(&r.cwd) };
		if !cwd.is_dir() {
			return Err(extism::Error::msg(format!("폴더가 없습니다: {}", cwd.display())));
		}
		#[cfg(windows)]
		{
			let out = super::terminal::run_hidden(&exe, &r.args, &cwd, RUN_LIMIT, true)?;
			Ok(match out {
				Some(o) => json!({ "ok": o.ok, "code": o.code, "stdout": o.stdout, "stderr": o.stderr, "timedOut": false }),
				None => json!({ "ok": false, "code": null, "stdout": "", "stderr": "", "timedOut": true }),
			}
			.to_string())
		}
		#[cfg(not(windows))]
		{
			let _ = (exe, cwd);
			Err(extism::Error::msg("이 운영체제에서는 실행하지 못합니다"))
		}
	})
});

/// 허락한 권한에 맞는 호스트 함수만 넘긴다. 넘기지 않은 함수를 가져다 쓰는 플러그인은 띄우지 못한다(wasm.rs).
pub fn functions(ctx: HostCtx) -> Vec<Function> {
	let has = |p: &str| ctx.grants.iter().any(|g| g == p);
	let (notify, open, read, storage) = (has("notify"), has("open"), has("issue:read"), has("storage"));
	let process = ctx.grants.iter().any(|g| g.starts_with("process:"));
	let ud = UserData::new(ctx);
	let f = |name: &str, imp: fn(&mut extism::CurrentPlugin, &[extism::Val], &mut [extism::Val], Ctx) -> Result<(), extism::Error>| {
		Function::new(name, [PTR], [PTR], ud.clone(), imp)
	};
	let mut out = vec![f("docket_log", docket_log)];
	if notify {
		out.push(f("docket_notify", docket_notify));
	}
	if open {
		out.push(f("docket_open", docket_open));
	}
	if read {
		out.push(f("docket_issue_get", docket_issue_get));
	}
	if storage {
		out.push(f("docket_kv_get", docket_kv_get));
		out.push(f("docket_kv_set", docket_kv_set));
	}
	if process {
		out.push(f("docket_run", docket_run));
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reply_needs_open_permission() {
		assert_eq!(reply("", &[]).unwrap().toast, "");
		assert_eq!(reply(r#"{"toast":"열었습니다","markdown":"| a |"}"#, &[]).unwrap().markdown, "| a |");
		assert!(reply(r#"{"open":"C:\\x"}"#, &[]).is_err());
		assert_eq!(reply(r#"{"open":"C:\\x"}"#, &["open".to_string()]).unwrap().open, r"C:\x");
		assert!(reply("not json", &[]).is_err());
	}
}
