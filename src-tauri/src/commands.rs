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
use crate::plugin_host::{self, api::Target};
use crate::{glossary, kb, recipe, usage};
use crate::runner::{self, RunEvent, emit_deliverable, emit_issue};
use crate::store::{Store, settle, title_of};

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

/// 마지막으로 받은 구독 사용률. 한 번도 받지 않았으면(API 키로 쓰는 경우 등) 없다.
#[tauri::command]
pub fn usage_get() -> Option<usage::Usage> {
	usage::get()
}

/// 최근 days 일 동안 이 앱이 claude 를 부른 횟수 · 토큰 · 비용을 실행 종류별로 더한다.
#[tauri::command]
pub fn spend_summary(days: u32) -> usage::Spend {
	usage::spend_summary(days.clamp(1, 90))
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
	let busy = store.list_issues(&id)?.iter().chain(store.list_talks(&id)?.iter()).any(|v| v.issue.run.is_some())
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
pub fn issue_create(app: AppHandle, project_id: String, issue_id: Option<String>, note: String, auto_plan: Option<bool>, model: Option<String>, effort: Option<String>) -> Result<IssueView> {
	let store = app.state::<Store>();
	if note.trim().is_empty() {
		return msg("메모가 비어 있습니다");
	}
	let settings = store.settings()?;
	let auto = auto_plan.unwrap_or(settings.auto_plan);
	let v = store.create_issue(&project_id, issue_id.as_deref(), &note, auto, runner::new_title_mode(&settings), model.as_deref().unwrap_or(""), effort.as_deref().unwrap_or(""))?;
	emit_issue(&app, &v);
	Ok(v)
}

/// 제목을 손으로 고친다. 고친 제목은 메모를 바꿔도 덮지 않는다. 비우면 다시 제목 모델에 맡긴다(모델을 껐으면 첫 줄).
#[tauri::command]
pub fn issue_set_title(app: AppHandle, project_id: String, issue_id: String, title: String) -> Result<IssueView> {
	let store = app.state::<Store>();
	let note = store.get_issue(&project_id, &issue_id)?.note;
	let mode = runner::new_title_mode(&store.settings()?);
	let title: String = title.trim().chars().take(80).collect();
	change(&app, &project_id, &issue_id, |i| {
		if i.talk {
			return msg("대화에는 제목을 달지 않습니다");
		}
		if title.is_empty() {
			i.title = title_of(&note);
			i.title_mode = mode;
			i.titled_at = 0;
		} else {
			i.title = title;
			i.title_mode = TitleMode::Manual;
		}
		Ok(())
	})
}

/* ---------- 프로젝트 대화 ---------- */
//
// 대화는 보드에 나오지 않는 이슈다. 보내기 · 중지 · 터미널 · 첨부 · 지우기는 issue_* 명령을 그대로 쓴다.

#[tauri::command]
pub fn talks_list(store: State<Store>, project_id: String) -> Result<Vec<IssueView>> {
	store.list_talks(&project_id)
}

#[tauri::command]
pub fn talk_create(app: AppHandle, project_id: String, talk_id: String) -> Result<IssueView> {
	let v = app.state::<Store>().create_talk(&project_id, &talk_id)?;
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

/// 이 메모에 쓸 모델을 바꾼다. 비우면 설정의 실행별 모델을 따른다. 돌고 있는 실행에는 들지 않고 다음 실행부터 쓰인다.
#[tauri::command]
pub fn issue_set_model(app: AppHandle, project_id: String, issue_id: String, model: String) -> Result<IssueView> {
	change(&app, &project_id, &issue_id, |i| {
		i.model = model.trim().to_string();
		Ok(())
	})
}

/// 이 메모에 쓸 effort 를 바꾼다. 비우면 설정의 실행별 effort 를 따른다. 모델과 같이 다음 실행부터 쓰인다.
#[tauri::command]
pub fn issue_set_effort(app: AppHandle, project_id: String, issue_id: String, effort: String) -> Result<IssueView> {
	change(&app, &project_id, &issue_id, |i| {
		i.effort = effort.trim().to_string();
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

/// 대기열에서 질문 하나를 뺀다. 고치려고 입력칸으로 되돌릴 때는 첨부를 남기고(keep_files), 그냥 뺄 때는 첨부 폴더에서도 치운다.
#[tauri::command]
pub fn issue_queue_remove(app: AppHandle, project_id: String, issue_id: String, queue_id: String, keep_files: bool) -> Result<IssueView> {
	let mut gone = Vec::new();
	let v = change(&app, &project_id, &issue_id, |i| {
		if let Some(at) = i.queue.iter().position(|q| q.id == queue_id) {
			gone = i.queue.remove(at).images;
		}
		Ok(())
	})?;
	if !keep_files {
		let store = app.state::<Store>();
		for name in gone {
			let _ = store.delete_attachment(&project_id, &issue_id, &name);
		}
	}
	Ok(v)
}

/// 중지했거나 앱을 다시 켜서 남은 대기열을 한 차례로 묶어 보낸다.
#[tauri::command]
pub fn issue_queue_send(app: AppHandle, project_id: String, issue_id: String) -> Result<IssueView> {
	let store = app.state::<Store>();
	if store.get_issue(&project_id, &issue_id)?.issue.run.is_some() {
		return msg("실행이 끝나면 이어서 보냅니다");
	}
	match runner::send_queued(&app, &project_id, &issue_id, None)? {
		Some(v) => Ok(v),
		None => store.get_issue(&project_id, &issue_id),
	}
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
	let plugin = plugin_host::terminal(&store.root, &settings)?;
	let title = format!("#{} {}", v.issue.number, v.issue.title);
	let session = v.issue.session_id;
	tauri::async_runtime::spawn_blocking(move || {
		runner::open_terminal(&exe, Path::new(&project.path), &session, plugin.as_ref().map(|(n, t, e)| (n.as_str(), t, e.as_path())), &title)
	})
	.await
	.map_err(|e| Error::Msg(e.to_string()))?
}

/* ---------- 플러그인 ---------- */

#[tauri::command]
pub fn plugins_list(store: State<Store>) -> Result<plugin_host::PluginList> {
	Ok(plugin_host::PluginList {
		dir: plugin_host::dir(&store.root).to_string_lossy().to_string(),
		plugins: plugin_host::load(&store.root, &store.settings()?),
	})
}

/// 미리 만든 틀을 plugins/<id>/ 에 쓴다. 이미 있으면 덮지 않는다.
#[tauri::command]
pub fn plugin_create_preset(store: State<Store>, id: String) -> Result<String> {
	Ok(plugin_host::create_preset(&store, &id)?.to_string_lossy().to_string())
}

/// 매니페스트의 권한을 허락하고 켠다. 화면이 권한 목록을 보이고 사용자가 고른 뒤에 부른다.
#[tauri::command]
pub fn plugin_grant(store: State<Store>, id: String) -> Result<Settings> {
	plugin_host::grant(&store, &id)
}

/// 설치하기 전에 꾸러미(zip · plugin.json)를 읽어 권한 · 문제를 본다.
#[tauri::command]
pub fn plugin_inspect(store: State<Store>, path: String) -> Result<plugin_host::install::Inspect> {
	plugin_host::install::inspect(&store, &store.settings()?, Path::new(&path))
}

#[tauri::command]
pub fn plugin_install(store: State<Store>, path: String) -> Result<Settings> {
	plugin_host::install::install(&store, Path::new(&path))
}

#[tauri::command]
pub fn plugin_uninstall(store: State<Store>, id: String) -> Result<Settings> {
	plugin_host::install::uninstall(&store, &id)
}

#[tauri::command]
pub fn plugin_settings_get(store: State<Store>, id: String) -> Result<serde_json::Value> {
	let v = plugin_host::find(&store.root, &store.settings()?, &id)?;
	Ok(plugin_host::settings_get(&store.root, &v.manifest))
}

#[tauri::command]
pub fn plugin_settings_set(store: State<Store>, id: String, values: serde_json::Value) -> Result<serde_json::Value> {
	let v = plugin_host::find(&store.root, &store.settings()?, &id)?;
	plugin_host::settings_set(&store.root, &v.manifest, &values)
}

/// 플러그인이 더한 메뉴 항목을 눌렀다. 플러그인이 바깥 프로그램을 기다릴 수 있어 async 로 두고 따로 돌린다.
#[tauri::command]
pub async fn plugin_invoke(
	app: AppHandle,
	plugin_id: String,
	command: String,
	place: String,
	project_id: String,
	issue_id: Option<String>,
	file: Option<String>,
) -> Result<plugin_host::api::Reply> {
	let target = Target { project_id, issue_id: issue_id.unwrap_or_default(), file: file.unwrap_or_default(), ..Default::default() };
	tauri::async_runtime::spawn_blocking(move || plugin_host::invoke(&app, &plugin_id, &command, &place, target))
		.await
		.map_err(|e| Error::Msg(e.to_string()))?
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

/// 완료하면 「자동 갱신」을 켠 산출물 가운데 이 변경과 관련 있는 것을 가려 새 판을 쓴다(kb::after_complete).
/// 판정은 기다리지 않는다 — 완료 단추가 Claude 호출을 기다리며 멈추지 않게.
#[tauri::command]
pub fn issue_complete(app: AppHandle, project_id: String, issue_id: String) -> Result<IssueView> {
	let v = change(&app, &project_id, &issue_id, |i| {
		if i.status != Status::Review {
			return msg("결과를 확인하는 단계에서만 완료할 수 있습니다");
		}
		i.status = Status::Done;
		i.log("done", "");
		Ok(())
	})?;
	plugin_host::dispatch(&app, "done", Target { project_id: project_id.clone(), issue_id: issue_id.clone(), ..Default::default() });
	tauri::async_runtime::spawn(kb::after_complete(app.clone(), project_id, issue_id));
	Ok(v)
}

#[tauri::command]
pub fn issue_drop(app: AppHandle, project_id: String, issue_id: String) -> Result<IssueView> {
	let v = change(&app, &project_id, &issue_id, |i| {
		if i.run.is_some() {
			return msg("실행 중에는 보류할 수 없습니다. 먼저 중지하세요.");
		}
		i.status = Status::Dropped;
		i.auto_plan = false;
		i.log("drop", "");
		Ok(())
	})?;
	plugin_host::dispatch(&app, "dropped", Target { project_id, issue_id, ..Default::default() });
	Ok(v)
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
		let (did, fresh) = match &deliverable_id {
			Some(d) => (d.clone(), false),
			None => {
				let title = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
				(store.create_deliverable(&project_id, &title, "")?.id, true)
			}
		};
		let v = store.add_version_file(&project_id, &did, &p, "import", "")?;
		// 새로 등록한 오피스 파일은 견본으로 refs/ 에 한 부 더 둬 템플릿으로 삼는다. 판 파일은 나중에 옮겨지거나 덮일 수 있다.
		if fresh && recipe::is_template(&p.to_string_lossy()) {
			store.import_refs(&project_id, &did, &[p.to_string_lossy().to_string()])?;
		}
		// 이미 작성법이 있는 산출물에 판을 더 가져온 것이면 다시 뽑지 않는다. 이름 규칙 · 형식만 맞춘다.
		let learn = fresh || v.deliverable.skill.trim().is_empty();
		out.push(recipe::after_files(&app, &project_id, &did, learn)?);
	}
	if out.is_empty() {
		return msg("가져올 파일이 없습니다. 폴더는 가져오지 않습니다.");
	}
	kb::touch(&app, &project_id);
	Ok(out)
}

#[tauri::command]
pub fn deliverable_create_doc(app: AppHandle, project_id: String, title: String, content: String) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	let title = if title.trim().is_empty() { "제목 없는 문서".to_string() } else { title.trim().to_string() };
	let d = store.create_deliverable(&project_id, &title, "")?;
	store.add_version_text(&project_id, &d.id, &content, "editor", "")?;
	let v = recipe::after_files(&app, &project_id, &d.id, !content.trim().is_empty())?;
	kb::touch(&app, &project_id);
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
	kb::touch(&app, &project_id);
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
	/// 이 칸이 생기기 전의 화면이 보낸 패치에는 없다. 그때는 지금 값을 그대로 둔다.
	#[serde(default)]
	auto_update: Option<bool>,
	/// 작성법 · 어휘 · 형식. 없으면 지금 값을 그대로 둔다 — 다른 칸만 고친 패치가 뽑아 둔 값을 지우지 않게.
	#[serde(default)]
	skill: Option<String>,
	#[serde(default)]
	vocab: Option<Vec<Term>>,
	#[serde(default)]
	format: Option<String>,
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
		if let Some(on) = patch.auto_update {
			d.auto_update = on;
		}
		if let Some(s) = &patch.skill {
			d.skill = s.clone();
		}
		if let Some(list) = &patch.vocab {
			d.vocab = clean_vocab(list);
		}
		if let Some(f) = &patch.format {
			d.format = f.trim().trim_start_matches('.').to_lowercase();
		}
		Ok(())
	})?;
	emit_deliverable(&app, &v);
	Ok(v)
}

/// 빈 말을 빼고, 같은 말은 앞의 것만 남긴다.
fn clean_vocab(list: &[Term]) -> Vec<Term> {
	let mut out: Vec<Term> = Vec::new();
	for t in list {
		let term = t.term.trim();
		if term.is_empty() || out.iter().any(|o| o.term.to_lowercase() == term.to_lowercase()) {
			continue;
		}
		let avoid = t.avoid.iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty() && a != term).collect();
		out.push(Term { term: term.to_string(), avoid, note: t.note.trim().to_string() });
	}
	out
}

#[tauri::command]
pub fn deliverable_refs_add(app: AppHandle, project_id: String, deliverable_id: String, paths: Vec<String>) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	store.import_refs(&project_id, &deliverable_id, &paths)?;
	recipe::after_files(&app, &project_id, &deliverable_id, true)
}

#[tauri::command]
pub fn deliverable_ref_delete(app: AppHandle, project_id: String, deliverable_id: String, name: String) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	store.delete_ref(&project_id, &deliverable_id, &name)?;
	// 지운 것이 템플릿이었으면 남은 오피스 파일로 바꾸거나 비운다. 작성법은 다시 뽑지 않는다.
	recipe::after_files(&app, &project_id, &deliverable_id, false)
}

/// 작성법 · 어휘 · 형식 · 템플릿 · 이름 규칙을 다시 뽑는다. 값이 있는 칸은 제안으로만 들어온다.
#[tauri::command]
pub fn deliverable_learn(app: AppHandle, project_id: String, deliverable_id: String) -> Result<DeliverableView> {
	recipe::start(&app, &project_id, &deliverable_id)
}

/// 뽑은 제안을 적용하거나 버린다. field: skill · vocab · format · naming · template · all
#[tauri::command]
pub fn deliverable_draft_apply(app: AppHandle, project_id: String, deliverable_id: String, field: String, apply: bool) -> Result<DeliverableView> {
	let v = app.state::<Store>().update_deliverable(&project_id, &deliverable_id, |d| recipe::apply_draft(d, &field, apply))?;
	emit_deliverable(&app, &v);
	Ok(v)
}

/// 템플릿으로 쓸 refs/ 파일을 정한다. 비우면 템플릿 없이 참고 자료만 둔다. 형식은 템플릿을 따라간다.
#[tauri::command]
pub fn deliverable_set_template(app: AppHandle, project_id: String, deliverable_id: String, name: String) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	let refs: Vec<String> = store.list_refs(&project_id, &deliverable_id).into_iter().map(|r| r.name).collect();
	if !name.is_empty() && !refs.contains(&name) {
		return msg("템플릿 · 참고 자료에 없는 파일입니다");
	}
	let v = store.update_deliverable(&project_id, &deliverable_id, |d| {
		if !name.is_empty() {
			d.format = crate::extract::ext_of(&name);
		}
		d.template = name.clone();
		d.draft.template.clear();
		d.draft.format.clear();
		Ok(())
	})?;
	emit_deliverable(&app, &v);
	Ok(v)
}

/// 산출물 어휘 하나를 프로젝트 어휘 사전으로 옮긴다. 사전에 같은 말이 있으면 피할 말 · 뜻만 보탠다.
#[tauri::command]
pub fn deliverable_vocab_promote(app: AppHandle, project_id: String, deliverable_id: String, term: String) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	let d = store.get_deliverable(&project_id, &deliverable_id)?;
	let k = term.trim().to_lowercase();
	let Some(t) = d.deliverable.vocab.iter().find(|t| t.term.trim().to_lowercase() == k).cloned() else { return msg("그 어휘가 없습니다") };
	let file = store.glossary(&project_id);
	let mut entries = file.entries.clone();
	match entries.iter_mut().find(|e| e.term.trim().to_lowercase() == k) {
		Some(e) => {
			for a in &t.avoid {
				if !e.aliases.iter().any(|x| x.trim() == a.trim()) {
					e.aliases.push(a.clone());
				}
			}
			if e.meaning.trim().is_empty() {
				e.meaning = t.note.clone();
			}
		}
		// 사전의 「비슷한 말」은 같은 것을 가리키는 다른 표현이라 피할 말을 그리로 옮긴다.
		None => entries.push(GlossaryEntry { term: t.term.clone(), meaning: t.note.clone(), aliases: t.avoid.clone() }),
	}
	store.save_glossary_entries(&project_id, &entries, file.updated_at)?;
	let v = store.update_deliverable(&project_id, &deliverable_id, |d| {
		d.vocab.retain(|x| x.term.trim().to_lowercase() != k);
		Ok(())
	})?;
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
	kb::touch(&app, &project_id);
	Ok(out)
}

/* ---------- 지식베이스 ---------- */

#[tauri::command]
pub fn kb_status(app: AppHandle, project_id: String) -> Result<kb::KbView> {
	kb::status(&app, &project_id)
}

/// 켜기 · 참조 폴더 · 산출물 포함 · 붙일 수 · 다듬기를 바꾼다. 켜 두었으면 바로 다시 훑는다.
#[tauri::command]
pub fn kb_save(app: AppHandle, project_id: String, kb: ProjectKb) -> Result<kb::KbView> {
	let p = app.state::<Store>().save_kb(&project_id, &kb)?;
	if p.kb.enabled {
		app.state::<kb::Kb>().request(&project_id);
	} else {
		app.state::<kb::Kb>().stop(&project_id);
	}
	kb::status(&app, &project_id)
}

/// 끌어 놓은 파일 · 폴더를 넣는다. 끈 프로젝트에도 넣어 둘 수 있다 — 켜면 그때 훑는다.
#[tauri::command]
pub fn kb_import(app: AppHandle, project_id: String, paths: Vec<String>) -> Result<kb::KbView> {
	app.state::<Store>().kb_import(&project_id, &paths)?;
	kb::touch(&app, &project_id);
	kb::status(&app, &project_id)
}

#[tauri::command]
pub fn kb_inbox_delete(app: AppHandle, project_id: String, path: String) -> Result<kb::KbView> {
	app.state::<Store>().kb_inbox_delete(&project_id, &path)?;
	kb::touch(&app, &project_id);
	kb::status(&app, &project_id)
}

#[tauri::command]
pub fn kb_reindex(app: AppHandle, project_id: String) -> Result<()> {
	if !app.state::<Store>().project(&project_id)?.kb.enabled {
		return msg("지식베이스를 켜야 색인합니다");
	}
	app.state::<kb::Kb>().request(&project_id);
	Ok(())
}

#[tauri::command]
pub fn kb_stop(app: AppHandle, project_id: String) -> bool {
	app.state::<kb::Kb>().stop(&project_id)
}

/// 화면의 찾아보기. 실행 때와 같은 로컬 찾기이고, 다듬기 호출은 하지 않는다.
#[tauri::command]
pub async fn kb_search(app: AppHandle, project_id: String, query: String) -> Result<Vec<KbHit>> {
	let dir = app.state::<Store>().kb_dir(&project_id);
	let k = app.state::<Store>().project(&project_id)?.kb.top_k.max(1) as usize;
	tokio::task::spawn_blocking(move || kb::search_local(&dir, &query, k, "")).await.map_err(|e| Error::Msg(e.to_string()))
}

#[tauri::command]
pub fn kb_cards(app: AppHandle, project_id: String, path: String) -> Result<Vec<kb::SectionView>> {
	kb::cards_of(&app, &project_id, &path)
}

/* ---------- 어휘 사전 ---------- */

#[tauri::command]
pub fn glossary_get(store: State<Store>, project_id: String) -> Result<glossary::GlossaryView> {
	glossary::view(&store, &project_id)
}

/// 용어 표 전체를 바꾼다. updated_at 은 화면이 읽어 둔 값이다 — 그 사이 다른 곳에서 저장했으면 거절한다.
#[tauri::command]
pub fn glossary_save_entries(store: State<Store>, project_id: String, entries: Vec<GlossaryEntry>, updated_at: i64) -> Result<glossary::GlossaryView> {
	store.save_glossary_entries(&project_id, &entries, updated_at)?;
	glossary::view(&store, &project_id)
}

/// 켜기 · 함께 쓸 프로젝트를 바꾼다.
#[tauri::command]
pub fn glossary_save_settings(store: State<Store>, project_id: String, glossary: ProjectGlossary) -> Result<glossary::GlossaryView> {
	store.save_glossary_settings(&project_id, &glossary)?;
	glossary::view(&store, &project_id)
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
