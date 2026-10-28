//! 화면이 부르는 명령. 얇게 두고 일은 store · runner · claude_files 가 한다.
//!
//! 바뀐 이슈 · 산출물은 docket://issue · docket://deliverable 사건으로 화면에 다시 알린다.
//! 실행 작업이 바꾼 것과 화면이 바꾼 것이 같은 길로 들어와야 목록이 어긋나지 않는다.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::claude_files::{self, Resource, TextFile};
use crate::error::{Error, Result, msg};
use crate::model::*;
use crate::plugins;
use crate::runner::{self, RunEvent, emit_deliverable, emit_issue};
use crate::store::{Store, settle};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Removed<'a> {
	project_id: &'a str,
	id: &'a str,
}

fn allowed_roots(store: &Store) -> Vec<PathBuf> {
	let mut roots = vec![claude_files::claude_home(), store.root.clone()];
	if let Ok(ps) = store.projects() {
		for p in ps {
			if !p.deliverables_dir.is_empty() {
				roots.push(PathBuf::from(&p.deliverables_dir));
			}
			roots.push(PathBuf::from(p.path));
		}
	}
	roots
}

/* ---------- 앱 ---------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
	data_root: String,
	claude_home: String,
	claude_path: String,
	claude_version: String,
	version: String,
}

#[tauri::command]
pub async fn app_info(app: AppHandle) -> Result<AppInfo> {
	let store = app.state::<Store>();
	let s = store.settings()?;
	let exe = runner::resolve_claude(&s.claude_path);
	let claude_version = match &exe {
		Some(e) => runner::claude_version(e).await,
		None => String::new(),
	};
	Ok(AppInfo {
		data_root: store.root.to_string_lossy().to_string(),
		claude_home: claude_files::claude_home().to_string_lossy().to_string(),
		claude_path: exe.map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
		claude_version,
		version: app.package_info().version.to_string(),
	})
}

#[tauri::command]
pub fn settings_get(store: State<Store>) -> Result<Settings> {
	store.settings()
}

#[tauri::command]
pub fn settings_save(store: State<Store>, settings: Settings) -> Result<Settings> {
	store.save_settings(&settings)
}

#[tauri::command]
pub fn path_open(app: AppHandle, path: String) -> Result<()> {
	claude_files::check_allowed(Path::new(&path), &allowed_roots(&app.state::<Store>()))?;
	app.opener().open_path(&path, None::<&str>).map_err(|e| Error::Msg(e.to_string()))
}

#[tauri::command]
pub fn path_reveal(app: AppHandle, path: String) -> Result<()> {
	claude_files::check_allowed(Path::new(&path), &allowed_roots(&app.state::<Store>()))?;
	app.opener().reveal_item_in_dir(&path).map_err(|e| Error::Msg(e.to_string()))
}

/// canonicalize 는 Windows 에서 `\\?\` 를 붙인다. 붙은 채로는 프로젝트 경로와 앞머리를 견줄 수 없다.
fn real_path(p: &Path) -> Option<PathBuf> {
	let c = std::fs::canonicalize(p).ok()?;
	let s = c.to_string_lossy();
	Some(match s.strip_prefix(r"\\?\UNC\") {
		Some(rest) => PathBuf::from(format!(r"\\{rest}")),
		None => PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s)),
	})
}

/// 계획 · 대화 · 결과에 건 저장소 안 그림을 화면이 띄울 수 있게 그 파일 하나만 asset 범위에 연다.
/// 저장소 폴더째 열면 웹뷰가 소스 · 설정까지 읽을 수 있다. 그래서 등록한 프로젝트 안의 그림 파일만 연다.
/// 실제 경로로 푼 뒤에 견준다. 그러지 않으면 `..` · 심볼릭 링크로 프로젝트 밖 파일이 빠져나간다.
/// 연 실제 경로를 돌려준다. 화면은 그 경로로 띄운다. 열지 않았으면 빈 글자다.
#[tauri::command]
pub fn asset_allow(app: AppHandle, path: String) -> Result<String> {
	let Some(real) = real_path(Path::new(&path)) else { return Ok(String::new()) };
	let ext = real.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
	if !real.is_file() || !runner::IMAGE_EXT.contains(&ext.as_str()) {
		return Ok(String::new());
	}
	let roots: Vec<PathBuf> = app.state::<Store>().projects()?.iter().filter_map(|p| real_path(Path::new(&p.path))).collect();
	if claude_files::check_allowed(&real, &roots).is_err() {
		return Ok(String::new());
	}
	app.asset_protocol_scope().allow_file(&real).map_err(|e| Error::Msg(e.to_string()))?;
	Ok(real.to_string_lossy().to_string())
}

/* ---------- 프로젝트 ---------- */

#[tauri::command]
pub fn projects_list(store: State<Store>) -> Result<Vec<Project>> {
	store.projects()
}

#[tauri::command]
pub fn project_add(store: State<Store>, path: String) -> Result<Project> {
	store.add_project(&path)
}

/// 산출물 폴더를 바꾸면 그 폴더의 그림을 화면에 띄울 수 있게 asset 범위에 연다.
#[tauri::command]
pub fn project_save(app: AppHandle, project: Project) -> Result<Project> {
	let p = app.state::<Store>().save_project(&project)?;
	if !p.deliverables_dir.is_empty() {
		let _ = app.asset_protocol_scope().allow_directory(&p.deliverables_dir, true);
	}
	Ok(p)
}

/// 화면에서 이름 규칙을 고치는 동안 결과를 바로 보여 준다. 규칙을 푸는 곳은 naming 하나뿐이다.
#[tauri::command]
pub fn naming_preview(store: State<Store>, project_id: String, pattern: String, title: String, n: u32, underscore: Option<bool>) -> Result<String> {
	let p = store.project(&project_id)?;
	let ctx = crate::naming::Ctx { title: &title, project: &p.name, n };
	let pattern = if pattern.trim().is_empty() { p.naming.clone() } else { pattern };
	Ok(crate::naming::apply(&pattern, &ctx, "md", underscore.unwrap_or(p.naming_underscore)))
}

#[tauri::command]
pub fn project_remove(store: State<Store>, id: String, delete_data: bool) -> Result<()> {
	let busy = store.list_issues(&id)?.iter().any(|v| v.issue.run.is_some())
		|| store.list_deliverables(&id)?.iter().any(|v| v.deliverable.job.is_some());
	if busy {
		return msg("실행 중인 작업이 있어 뺄 수 없습니다. 먼저 중지하세요.");
	}
	store.remove_project(&id, delete_data)
}

/// 실행 기록의 「허용 목록에 추가」.
#[tauri::command]
pub fn project_allow(store: State<Store>, project_id: String, rules: Vec<String>) -> Result<Project> {
	store.allow_rules(&project_id, &rules)
}

/// 앱이 띄운 claude 에 실제로 걸리는 규칙: 전역 · 저장소 공유 · 저장소 개인 설정. 앱 자신의 규칙은 프로젝트에 있다.
#[tauri::command]
pub fn permissions_view(store: State<Store>, project_id: String) -> Result<Vec<claude_files::RuleSet>> {
	Ok(claude_files::rule_sets(Path::new(&store.project(&project_id)?.path)))
}

#[tauri::command]
pub fn permissions_suggest(store: State<Store>, project_id: String) -> Result<Vec<claude_files::Suggestion>> {
	Ok(claude_files::suggest_commands(Path::new(&store.project(&project_id)?.path)))
}

/* ---------- 이슈 ---------- */

#[tauri::command]
pub fn issues_list(store: State<Store>, project_id: String) -> Result<Vec<IssueView>> {
	store.list_issues(&project_id)
}

#[tauri::command]
pub fn issue_get(store: State<Store>, project_id: String, issue_id: String) -> Result<IssueView> {
	store.get_issue(&project_id, &issue_id)
}

#[tauri::command]
pub fn issue_create(app: AppHandle, project_id: String, issue_id: Option<String>, note: String, auto_plan: Option<bool>) -> Result<IssueView> {
	let store = app.state::<Store>();
	if note.trim().is_empty() {
		return msg("메모가 비어 있습니다");
	}
	let auto = match auto_plan {
		Some(a) => a,
		None => store.settings()?.auto_plan,
	};
	let v = store.create_issue(&project_id, issue_id.as_deref(), &note, auto)?;
	emit_issue(&app, &v);
	Ok(v)
}

#[tauri::command]
pub fn issue_save_note(app: AppHandle, project_id: String, issue_id: String, note: String) -> Result<IssueView> {
	let v = app.state::<Store>().save_note(&project_id, &issue_id, &note)?;
	emit_issue(&app, &v);
	Ok(v)
}

fn change(app: &AppHandle, pid: &str, iid: &str, f: impl FnOnce(&mut Issue) -> Result<()>) -> Result<IssueView> {
	let v = app.state::<Store>().update_issue(pid, iid, f)?;
	emit_issue(app, &v);
	Ok(v)
}

#[tauri::command]
pub fn issue_set_auto_plan(app: AppHandle, project_id: String, issue_id: String, on: bool) -> Result<IssueView> {
	change(&app, &project_id, &issue_id, |i| {
		i.auto_plan = on;
		if on {
			i.error.clear();
		}
		Ok(())
	})
}

#[tauri::command]
pub fn issue_plan(app: AppHandle, project_id: String, issue_id: String, feedback: Option<String>) -> Result<IssueView> {
	runner::plan(&app, &project_id, &issue_id, feedback)
}

#[tauri::command]
pub fn issue_approve(app: AppHandle, project_id: String, issue_id: String, instruction: Option<String>, allow_all: Option<bool>) -> Result<IssueView> {
	runner::approve(&app, &project_id, &issue_id, instruction, allow_all.unwrap_or(false))
}

#[tauri::command]
pub fn issue_rework(app: AppHandle, project_id: String, issue_id: String, feedback: String, allow_all: Option<bool>) -> Result<IssueView> {
	runner::rework(&app, &project_id, &issue_id, feedback, allow_all.unwrap_or(false))
}

/// 앱을 닫기 전에 화면이 부른다. 멈춘 실행은 다음에 켤 때 「앱이 닫혀 끊겼다」로 정리된다.
#[tauri::command]
pub fn runs_stop_all(app: AppHandle) -> usize {
	app.state::<runner::Runner>().stop_all()
}

#[tauri::command]
pub fn issue_revert(app: AppHandle, project_id: String, issue_id: String) -> Result<IssueView> {
	runner::revert(&app, &project_id, &issue_id)
}

#[tauri::command]
pub fn issue_chat(app: AppHandle, project_id: String, issue_id: String, text: String, edit: bool, images: Option<Vec<String>>) -> Result<IssueView> {
	runner::chat(&app, &project_id, &issue_id, text, edit, images.unwrap_or_default())
}

/// 같은 세션을 두 곳에서 동시에 이으면 대화가 갈라진다. 앱이 그 세션을 돌리는 동안에는 열지 않는다.
/// 플러그인의 probe · attach 를 몇 초 기다릴 수 있어 async 로 두고 따로 돌린다. 동기 명령은 화면 스레드를 묶는다.
#[tauri::command]
pub async fn issue_open_terminal(app: AppHandle, project_id: String, issue_id: String) -> Result<()> {
	let store = app.state::<Store>();
	let v = store.get_issue(&project_id, &issue_id)?;
	if v.issue.session_id.is_empty() {
		return msg("이어 갈 세션이 아직 없습니다");
	}
	if v.issue.run.is_some() {
		return msg("실행 중에는 열 수 없습니다. 끝나거나 중지한 뒤에 여세요.");
	}
	let project = store.project(&project_id)?;
	let settings = store.settings()?;
	let exe = runner::resolve_claude(&settings.claude_path)
		.ok_or_else(|| Error::Msg("claude 실행 파일을 찾지 못했습니다. 설정에서 경로를 지정하세요.".into()))?;
	let plugin = plugins::terminal(&store.root, &settings.enabled_plugins)?;
	let title = format!("#{} {}", v.issue.number, v.issue.title);
	let session = v.issue.session_id;
	tauri::async_runtime::spawn_blocking(move || {
		runner::open_terminal(&exe, Path::new(&project.path), &session, plugin.as_ref().map(|(p, e)| (p, e.as_path())), &title)
	})
	.await
	.map_err(|e| Error::Msg(e.to_string()))?
}

/* ---------- 플러그인 ---------- */

#[tauri::command]
pub fn plugins_list(store: State<Store>) -> Result<plugins::PluginList> {
	Ok(plugins::PluginList {
		dir: plugins::dir(&store.root).to_string_lossy().to_string(),
		plugins: plugins::load(&store.root, &store.settings()?.enabled_plugins),
	})
}

/// 미리 만든 틀을 plugins/ 에 쓴다. 이미 있으면 덮지 않는다.
#[tauri::command]
pub fn plugin_create_preset(store: State<Store>, id: String) -> Result<String> {
	Ok(plugins::create_preset(&store.root, &id)?.to_string_lossy().to_string())
}

/// 이슈 세션 기록에서 앱이 돌리지 않은 차례만 꺼낸다. 앱이 돌린 차례는 실행 기록으로 이미 보인다.
/// 앱의 실행 시간 안에 찍힌 차례를 앱 것으로 본다. 앱 실행 중에는 터미널을 열지 못하게 하므로 둘이 겹치지 않는다.
#[tauri::command]
pub fn issue_transcript(app: AppHandle, project_id: String, issue_id: String) -> Result<Vec<runner::Turn>> {
	let store = app.state::<Store>();
	let v = store.get_issue(&project_id, &issue_id)?;
	let project = store.project(&project_id)?;
	let Some(path) = runner::transcript_path(&project.path, &v.issue.session_id) else { return Ok(Vec::new()) };
	let windows: Vec<(i64, i64)> = v.issue.runs.iter().map(|r| (r.started_at, if r.ended_at > 0 { r.ended_at } else { i64::MAX })).collect();
	let mut turns = runner::read_turns(&path, &project.path)?;
	turns.retain(|t| !windows.iter().any(|(a, b)| t.at >= *a && t.at <= *b));
	// 터미널에서 고친 파일도 변경 탭에 있어야 되돌리기 · 산출물이 빠뜨리지 않는다. 새로 담을 것이 있을 때만 쓴다.
	if runner::absorb_terminal(&mut v.issue.clone(), &turns) {
		change(&app, &project_id, &issue_id, |i| {
			runner::absorb_terminal(i, &turns);
			Ok(())
		})?;
	}
	Ok(turns)
}

#[tauri::command]
pub fn issue_sessions(store: State<Store>, project_id: String) -> Result<Vec<runner::SessionInfo>> {
	Ok(runner::recent_sessions(&store.project(&project_id)?.path, 12))
}

/// 터미널에서 이으며 세션 ID 가 바뀌었으면 사용자가 고른 세션으로 갈아 끼운다. 다음 질문 · 구현은 그 세션을 잇는다.
#[tauri::command]
pub fn issue_set_session(app: AppHandle, project_id: String, issue_id: String, session_id: String) -> Result<IssueView> {
	let path = app.state::<Store>().project(&project_id)?.path;
	if runner::transcript_path(&path, &session_id).is_none() {
		return msg("그 세션 기록을 찾지 못했습니다");
	}
	change(&app, &project_id, &issue_id, |i| {
		if i.run.is_some() {
			return msg("실행 중에는 세션을 바꿀 수 없습니다");
		}
		i.session_id = session_id.clone();
		i.log("session", session_id.clone());
		Ok(())
	})
}

#[tauri::command]
pub fn issue_complete(app: AppHandle, project_id: String, issue_id: String) -> Result<IssueView> {
	change(&app, &project_id, &issue_id, |i| {
		if i.status != Status::Review {
			return msg("결과를 확인하는 단계에서만 완료할 수 있습니다");
		}
		i.status = Status::Done;
		i.log("done", "");
		Ok(())
	})
}

#[tauri::command]
pub fn issue_drop(app: AppHandle, project_id: String, issue_id: String) -> Result<IssueView> {
	change(&app, &project_id, &issue_id, |i| {
		if i.run.is_some() {
			return msg("실행 중에는 보류할 수 없습니다. 먼저 중지하세요.");
		}
		i.status = Status::Dropped;
		i.auto_plan = false;
		i.log("drop", "");
		Ok(())
	})
}

#[tauri::command]
pub fn issue_reopen(app: AppHandle, project_id: String, issue_id: String) -> Result<IssueView> {
	change(&app, &project_id, &issue_id, |i| {
		if !matches!(i.status, Status::Done | Status::Dropped) {
			return msg("완료했거나 보류한 이슈만 다시 열 수 있습니다");
		}
		// 계획까지만 갔던 이슈는 승인 단계로, 구현까지 갔던 이슈는 새 일감으로 돌린다.
		i.status = if i.plan.is_some() && i.result.is_none() { Status::Planned } else { Status::Inbox };
		i.auto_plan = false;
		i.error.clear();
		i.log("reopen", "");
		Ok(())
	})
}

#[tauri::command]
pub fn issue_clear_error(app: AppHandle, project_id: String, issue_id: String) -> Result<IssueView> {
	change(&app, &project_id, &issue_id, |i| {
		i.error.clear();
		Ok(())
	})
}

#[tauri::command]
pub fn issue_stop(app: AppHandle, project_id: String, issue_id: String) -> Result<IssueView> {
	let stopped = app.state::<runner::Runner>().stop(&runner::issue_key(&project_id, &issue_id));
	if stopped {
		return app.state::<Store>().get_issue(&project_id, &issue_id);
	}
	// 실행기에 없는데 이슈만 실행 중으로 남은 경우다. 그 자리에서 정리한다.
	change(&app, &project_id, &issue_id, |i| {
		if let Some(r) = i.run.clone() {
			settle(i, r.kind);
			i.log("stop", "");
		}
		Ok(())
	})
}

#[tauri::command]
pub fn issue_delete(app: AppHandle, project_id: String, issue_id: String) -> Result<()> {
	app.state::<Store>().delete_issue(&project_id, &issue_id)?;
	let _ = app.emit("docket://issue-removed", Removed { project_id: &project_id, id: &issue_id });
	Ok(())
}

fn emit_if_exists(app: &AppHandle, pid: &str, iid: &str) {
	if let Ok(v) = app.state::<Store>().get_issue(pid, iid) {
		emit_issue(app, &v);
	}
}

/// 붙여 넣은 이미지는 JSON 이 아닌 날 바이트로 받는다. 숫자 배열로 보내면 스크린샷 한 장이 몇 MB 의 JSON 이 된다.
#[tauri::command]
pub fn attachment_save(app: AppHandle, request: Request<'_>) -> Result<String> {
	let h = request.headers();
	let get = |k: &str| h.get(k).and_then(|v| v.to_str().ok()).map(|s| s.to_string()).ok_or_else(|| Error::Msg(format!("{k} 가 없습니다")));
	let (pid, iid, ext) = (get("x-project")?, get("x-issue")?, get("x-ext").unwrap_or_default());
	let InvokeBody::Raw(bytes) = request.body() else { return msg("이미지 데이터가 없습니다") };
	let name = app.state::<Store>().save_attachment(&pid, &iid, bytes, &ext)?;
	emit_if_exists(&app, &pid, &iid);
	Ok(name)
}

#[tauri::command]
pub fn attachment_import(app: AppHandle, project_id: String, issue_id: String, paths: Vec<String>) -> Result<Vec<String>> {
	let names = app.state::<Store>().import_attachments(&project_id, &issue_id, &paths)?;
	emit_if_exists(&app, &project_id, &issue_id);
	Ok(names)
}

#[tauri::command]
pub fn attachment_delete(app: AppHandle, project_id: String, issue_id: String, name: String) -> Result<()> {
	app.state::<Store>().delete_attachment(&project_id, &issue_id, &name)?;
	emit_if_exists(&app, &project_id, &issue_id);
	Ok(())
}

#[tauri::command]
pub fn run_events(store: State<Store>, project_id: String, target: String, target_id: String, run_id: String) -> Result<Vec<RunEvent>> {
	let project = store.project(&project_id)?;
	let path = if target == "issue" {
		store.issue_run_log(&project_id, &target_id, &run_id)?
	} else {
		store.deliverable_run_log(&project_id, &target_id, &run_id)?
	};
	if !path.exists() {
		return Ok(Vec::new());
	}
	runner::replay(&path, &project.path)
}

/* ---------- 산출물 ---------- */

#[tauri::command]
pub fn deliverables_list(store: State<Store>, project_id: String) -> Result<Vec<DeliverableView>> {
	store.list_deliverables(&project_id)
}

#[tauri::command]
pub fn deliverable_import(app: AppHandle, project_id: String, paths: Vec<String>, deliverable_id: Option<String>) -> Result<Vec<DeliverableView>> {
	let store = app.state::<Store>();
	let mut out = Vec::new();
	for p in paths.iter().map(PathBuf::from).filter(|p| p.is_file()) {
		let did = match &deliverable_id {
			Some(d) => d.clone(),
			None => {
				let title = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
				store.create_deliverable(&project_id, &title, "")?.id
			}
		};
		let v = store.add_version_file(&project_id, &did, &p, "import", "")?;
		emit_deliverable(&app, &v);
		out.push(v);
	}
	if out.is_empty() {
		return msg("가져올 파일이 없습니다. 폴더는 가져오지 않습니다.");
	}
	Ok(out)
}

#[tauri::command]
pub fn deliverable_create_doc(app: AppHandle, project_id: String, title: String, content: String) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	let title = if title.trim().is_empty() { "제목 없는 문서".to_string() } else { title.trim().to_string() };
	let d = store.create_deliverable(&project_id, &title, "")?;
	let v = store.add_version_text(&project_id, &d.id, &content, "editor", "")?;
	emit_deliverable(&app, &v);
	Ok(v)
}

/// 판 없이 산출물만 만든다. 템플릿 · 지침을 먼저 넣고 나서 쓰게 하는 흐름이다.
#[tauri::command]
pub fn deliverable_create(app: AppHandle, project_id: String, title: String) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	let d = store.create_deliverable(&project_id, if title.trim().is_empty() { "새 산출물" } else { title.trim() }, "")?;
	let v = store.dview(d);
	emit_deliverable(&app, &v);
	Ok(v)
}

#[tauri::command]
pub fn deliverable_save_doc(app: AppHandle, project_id: String, deliverable_id: String, content: String, new_version: bool, note: String) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	let v = if new_version {
		store.add_version_text(&project_id, &deliverable_id, &content, "editor", &note)?
	} else {
		store.overwrite_latest_text(&project_id, &deliverable_id, &content)?
	};
	emit_deliverable(&app, &v);
	Ok(v)
}

#[tauri::command]
pub fn deliverable_read_text(store: State<Store>, project_id: String, deliverable_id: String, n: u32) -> Result<String> {
	let path = store.version_path(&project_id, &deliverable_id, n)?;
	if std::fs::metadata(&path)?.len() > 8 * 1024 * 1024 {
		return msg("너무 커서 앱 안에서는 열지 않습니다");
	}
	String::from_utf8(std::fs::read(&path)?).map_err(|_| Error::Msg("UTF-8 글 파일이 아닙니다".into()))
}

#[tauri::command]
pub fn deliverable_version_path(store: State<Store>, project_id: String, deliverable_id: String, n: u32) -> Result<String> {
	Ok(store.version_path(&project_id, &deliverable_id, n)?.to_string_lossy().to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliverablePatch {
	title: String,
	note: String,
	guide: String,
	naming: String,
	subdir: String,
	mode: String,
}

#[tauri::command]
pub fn deliverable_update(app: AppHandle, project_id: String, deliverable_id: String, patch: DeliverablePatch) -> Result<DeliverableView> {
	let v = app.state::<Store>().update_deliverable(&project_id, &deliverable_id, |d| {
		if !patch.title.trim().is_empty() {
			d.title = patch.title.trim().to_string();
		}
		d.note = patch.note.clone();
		d.guide = patch.guide.clone();
		d.naming = patch.naming.trim().to_string();
		d.subdir = patch.subdir.trim().trim_matches(['/', '\\']).to_string();
		d.mode = if patch.mode == "file" { "file".into() } else { "md".into() };
		Ok(())
	})?;
	emit_deliverable(&app, &v);
	Ok(v)
}

#[tauri::command]
pub fn deliverable_refs_add(app: AppHandle, project_id: String, deliverable_id: String, paths: Vec<String>) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	store.import_refs(&project_id, &deliverable_id, &paths)?;
	let v = store.get_deliverable(&project_id, &deliverable_id)?;
	emit_deliverable(&app, &v);
	Ok(v)
}

#[tauri::command]
pub fn deliverable_ref_delete(app: AppHandle, project_id: String, deliverable_id: String, name: String) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	store.delete_ref(&project_id, &deliverable_id, &name)?;
	let v = store.get_deliverable(&project_id, &deliverable_id)?;
	emit_deliverable(&app, &v);
	Ok(v)
}

#[tauri::command]
pub fn deliverable_clear_error(app: AppHandle, project_id: String, deliverable_id: String) -> Result<DeliverableView> {
	let v = app.state::<Store>().update_deliverable(&project_id, &deliverable_id, |d| {
		d.error.clear();
		Ok(())
	})?;
	emit_deliverable(&app, &v);
	Ok(v)
}

#[tauri::command]
pub fn deliverable_delete(app: AppHandle, project_id: String, deliverable_id: String) -> Result<()> {
	app.state::<Store>().delete_deliverable(&project_id, &deliverable_id)?;
	let _ = app.emit("docket://deliverable-removed", Removed { project_id: &project_id, id: &deliverable_id });
	Ok(())
}

#[tauri::command]
pub fn deliverable_generate(app: AppHandle, project_id: String, deliverable_id: Option<String>, request: String) -> Result<DeliverableView> {
	runner::document(&app, &project_id, deliverable_id, request)
}

#[tauri::command]
pub fn deliverable_stop(app: AppHandle, project_id: String, deliverable_id: String) -> Result<()> {
	app.state::<runner::Runner>().stop(&runner::doc_key(&project_id, &deliverable_id));
	Ok(())
}

/// 이슈 하나를 메모 · 계획 · 결과 · 바꾼 파일을 묶은 문서로 남긴다. 첨부도 판 폴더에 함께 복사해 그림 링크가 살아 있게 한다.
#[tauri::command]
pub fn deliverable_from_issue(app: AppHandle, project_id: String, issue_id: String) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	let v = store.get_issue(&project_id, &issue_id)?;
	let i = &v.issue;
	let title = i.plan.as_ref().map(|p| p.title.clone()).filter(|t| !t.is_empty()).unwrap_or_else(|| i.title.clone());
	let mut md = format!("# {title}\n\n## 메모\n\n{}\n", v.note.trim());
	if let Some(p) = &i.plan {
		md.push_str(&format!("\n## 계획\n\n{}\n\n{}\n", p.summary, p.plan));
		if !p.steps.is_empty() {
			md.push_str("\n### 순서\n\n");
			for (n, st) in p.steps.iter().enumerate() {
				md.push_str(&format!("{}. **{}**", n + 1, st.title));
				if !st.detail.trim().is_empty() {
					md.push_str(&format!("  \n   {}", st.detail.trim().replace('\n', "\n   ")));
				}
				md.push('\n');
			}
		}
		if !p.risks.is_empty() {
			md.push_str("\n### 주의할 점\n\n");
			md.push_str(&p.risks.iter().map(|r| format!("- {r}\n")).collect::<String>());
		}
	}
	if let Some(r) = &i.result {
		md.push_str(&format!("\n## 구현 결과\n\n{}\n", r.summary));
		if !r.verification.is_empty() {
			md.push_str(&format!("\n### 확인\n\n{}\n", r.verification));
		}
		if !r.followups.is_empty() {
			md.push_str("\n### 이어서 할 일\n\n");
			md.push_str(&r.followups.iter().map(|f| format!("- {f}\n")).collect::<String>());
		}
		if !r.screenshots.is_empty() {
			md.push_str("\n### 결과 화면\n\n");
			for s in &r.screenshots {
				md.push_str(&format!("![{}](<{}>)\n\n", s.caption, s.path));
			}
		}
	}
	let shots: Vec<&str> = i.result.iter().flat_map(|r| r.screenshots.iter().map(|s| s.path.as_str())).collect();
	if !i.changes.is_empty() {
		md.push_str("\n## 바꾼 파일\n\n");
		for c in &i.changes {
			let (a, d) = runner::count_lines(c);
			md.push_str(&format!("- `{}` +{a} -{d}\n", c.rel));
		}
	}
	let d = store.create_deliverable(&project_id, &title, &issue_id)?;
	let mut out = store.add_version_text(&project_id, &d.id, &md, "issue", &format!("이슈 #{}", i.number))?;
	// 산출물 폴더에는 여러 문서가 함께 놓이므로 첨부는 「<파일 이름>_첨부」 폴더로 따로 묶고 링크를 그쪽으로 바꾼다.
	// 결과 화면은 그 안의 shots/ 폴더 구조를 그대로 따라 옮긴다.
	if !v.attachments.is_empty() || !shots.is_empty() {
		let file = store.version_path(&project_id, &d.id, 1)?;
		let stem = file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "첨부".into());
		if let Some(dest) = file.parent().map(|p| p.join(format!("{stem}_첨부"))) {
			std::fs::create_dir_all(&dest)?;
			for a in &v.attachments {
				let _ = std::fs::copy(Path::new(&v.dir).join("attachments").join(a), dest.join(a));
			}
			for s in &shots {
				let to = dest.join(s);
				if let Some(parent) = to.parent() {
					let _ = std::fs::create_dir_all(parent);
				}
				let _ = std::fs::copy(Path::new(&v.dir).join(s), to);
			}
			let linked = md
				.replace("](<attachments/", &format!("](<{stem}_첨부/"))
				.replace("](attachments/", &format!("]({stem}_첨부/"))
				.replace("](<shots/", &format!("](<{stem}_첨부/shots/"));
			out = store.overwrite_latest_text(&project_id, &d.id, &linked)?;
		}
	}
	emit_deliverable(&app, &out);
	Ok(out)
}

/* ---------- Claude 설정 ---------- */

#[tauri::command]
pub fn resources_list(store: State<Store>, project_id: Option<String>) -> Result<Vec<Resource>> {
	let root = match project_id.filter(|p| !p.is_empty()) {
		Some(pid) => Some(PathBuf::from(store.project(&pid)?.path)),
		None => None,
	};
	Ok(claude_files::list(root.as_deref()))
}

#[tauri::command]
pub fn text_read(store: State<Store>, path: String) -> Result<TextFile> {
	let p = PathBuf::from(&path);
	claude_files::check_allowed(&p, &allowed_roots(&store))?;
	claude_files::read_text(&p)
}

#[tauri::command]
pub fn text_write(store: State<Store>, path: String, content: String, crlf: bool, bom: bool, expected_modified: i64, force: bool) -> Result<TextFile> {
	let p = PathBuf::from(&path);
	claude_files::check_allowed(&p, &allowed_roots(&store))?;
	claude_files::write_text(&p, &content, crlf, bom, expected_modified, force)
}

fn scope_base(store: &Store, scope: &str, project_id: Option<&str>) -> Result<PathBuf> {
	if scope == "global" {
		return Ok(claude_files::claude_home());
	}
	let pid = project_id.ok_or_else(|| Error::Msg("프로젝트를 고르세요".into()))?;
	Ok(PathBuf::from(store.project(pid)?.path).join(".claude"))
}

#[tauri::command]
pub fn resource_create(store: State<Store>, kind: String, scope: String, project_id: Option<String>, name: String, description: String) -> Result<String> {
	let base = scope_base(&store, &scope, project_id.as_deref())?;
	Ok(claude_files::create(&kind, &base, &name, &description)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn resource_delete(store: State<Store>, path: String) -> Result<String> {
	let p = PathBuf::from(&path);
	let mut bases = vec![claude_files::claude_home()];
	if let Ok(ps) = store.projects() {
		bases.extend(ps.into_iter().map(|p| PathBuf::from(p.path).join(".claude")));
	}
	let target = claude_files::delete_target(&p, &bases)?;
	let label = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
	Ok(store.trash(&target, &label)?.to_string_lossy().to_string())
}
