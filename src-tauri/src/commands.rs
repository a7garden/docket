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
use crate::{dbsrc, glossary, kb, memory, perf, quick, recipe, usage};
use crate::runner::{self, RunEvent, emit_deliverable, emit_issue};
use crate::store::{FoundImport, Store, settle, title_of};

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
			// 상위 폴더 지침은 그 파일 하나씩만 연다. 폴더째 열면 D:\workspace 아래 다른 저장소까지 화면에서 고칠 수 있게 된다.
			roots.extend(claude_files::parent_instructions(Path::new(&p.path)));
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

/// 화면 쪽 계측을 켤지. app_info 는 claude 버전을 묻느라 늦게 오므로 따로 둔다 — 첫 명령부터 재야 한다.
/// 설치본인지. 설치기가 실행 파일 옆에 남기는 uninstall.exe 로 가린다. 소스에서 띄운 앱을 업데이트하면 다른 폴더에 깔리고 켜던 것은 그대로 남는다.
#[tauri::command]
pub fn update_installable() -> bool {
	std::env::current_exe().ok().and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").is_file())).unwrap_or(false)
}

#[tauri::command]
pub fn perf_enabled() -> bool {
	perf::on()
}

/// 산출물을 파일로 만들 때 쓰는 도구(Python 패키지 · LibreOffice · Office · Node · 한컴)가 있는지 본다. 설정 화면의 「점검」이 부른다.
#[tauri::command]
pub async fn doc_tools_check(app: AppHandle) -> serde_json::Value {
	runner::doc_tools_check(&app).await
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
pub fn settings_save(app: AppHandle, store: State<Store>, settings: Settings) -> Result<Settings> {
	// 단축키를 먼저 단다. 다른 프로그램이 잡은 조합이면 저장하지 않고 오류를 돌려준다 — 설정과 실제로 듣는 키가 어긋나지 않게.
	let old = store.settings().unwrap_or_default();
	quick::change_key(&app, &old.quick_capture_key, &settings.quick_capture_key)?;
	let saved = store.save_settings(&settings)?;
	runner::note_settings(&saved);
	Ok(saved)
}

/// 시작할 때 빠른 메모 단축키를 등록하지 못한 까닭. 비어 있으면 듣고 있다(또는 꺼 두었다).
#[tauri::command]
pub fn quick_key_error() -> String {
	quick::key_error()
}

/// 앱을 끝낸다. 트레이의 「끝내기」와 닫기 동작이 「끝내기」일 때의 닫기가 여기로 온다.
/// 주 창만 닫으면 숨은 빠른 창 · 트레이 때문에 프로세스가 남는다. 띄운 claude 는 끝날 때 작업 개체가 끈다.
#[tauri::command]
pub fn app_quit(app: AppHandle) {
	app.exit(0);
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

#[tauri::command(async)]
pub fn projects_list(store: State<Store>) -> Result<Vec<Project>> {
	perf::command("projects_list", "", || store.projects())
}

#[tauri::command]
pub fn project_add(store: State<Store>, path: String) -> Result<Project> {
	store.add_project(&path)
}

#[tauri::command]
pub fn project_save(store: State<Store>, project: Project) -> Result<Project> {
	store.save_project(&project)
}

/// 산출물 폴더를 바꾸면 그 폴더의 그림을 화면에 띄울 수 있게 asset 범위에 연다.
#[tauri::command]
pub fn deliverable_settings_save(app: AppHandle, project_id: String, settings: DeliverableSettings) -> Result<Project> {
	let p = app.state::<Store>().save_deliverable_settings(&project_id, &settings)?;
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
	if project_busy(&store, &id)? {
		return msg("실행 중인 작업이 있어 뺄 수 없습니다. 먼저 중지하세요.");
	}
	store.remove_project(&id, delete_data)
}

/// 도는 실행 · 줄 선 실행 · 산출물 작성 · 작성법 뽑기가 하나라도 있는지.
fn project_busy(store: &Store, id: &str) -> Result<bool> {
	Ok(store.list_issues(id)?.iter().chain(store.list_talks(id)?.iter()).any(|v| v.issue.run.is_some())
		|| store.list_deliverables(id)?.iter().any(|v| v.deliverable.job.is_some() || v.deliverable.learn.is_some()))
}

/// 보관 · 되살리기. 도는 작업이 있으면 보관하지 않는다 — 실행 목록과 창 닫기 경고에서 사라져 멈출 길이 없어진다.
#[tauri::command]
pub fn project_archive(app: AppHandle, id: String, archived: bool) -> Result<Project> {
	let store = app.state::<Store>();
	if archived && project_busy(&store, &id)? {
		return msg("실행 중인 작업이 있어 보관할 수 없습니다. 먼저 중지하세요.");
	}
	let p = store.set_project_archived(&id, archived)?;
	if archived {
		app.state::<crate::kb::Kb>().stop(&id);
		app.state::<memory::Memory>().stop(&id);
	} else {
		crate::kb::touch(&app, &id);
	}
	Ok(p)
}

/// 실행 기록의 「허용 목록에 추가」.
#[tauri::command]
pub fn project_allow(store: State<Store>, project_id: String, rules: Vec<String>) -> Result<Project> {
	store.allow_rules(&project_id, &rules)
}

/// 앱이 띄운 claude 에 실제로 걸리는 규칙: 전역 · 저장소 공유 · 저장소 개인 설정. 앱 자신의 규칙은 프로젝트에 있다.
#[tauri::command(async)]
pub fn permissions_view(store: State<Store>, project_id: String) -> Result<Vec<claude_files::RuleSet>> {
	Ok(claude_files::rule_sets(Path::new(&store.project(&project_id)?.path)))
}

#[tauri::command(async)]
pub fn permissions_suggest(store: State<Store>, project_id: String) -> Result<Vec<claude_files::Suggestion>> {
	Ok(claude_files::suggest_commands(Path::new(&store.project(&project_id)?.path)))
}

/* ---------- 이슈 ---------- */

#[tauri::command(async)]
pub fn issues_list(store: State<Store>, project_id: String) -> Result<Vec<IssueView>> {
	perf::command("issues_list", &project_id, || store.list_issues(&project_id))
}

#[tauri::command(async)]
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
	let v = store.create_issue(&project_id, issue_id.as_deref(), &note, auto, runner::new_title_mode(&settings), model.as_deref().unwrap_or(""), effort.as_deref().unwrap_or(""), None)?;
	emit_issue(&app, &v);
	Ok(v)
}

/// 이 메모에서 이어지는 새 메모를 만든다. 앞선 메모의 단계는 바꾸지 않고 이력 한 줄만 남긴다.
/// 모델 · effort 는 앞선 메모의 것을 물려준다 — 같은 일을 잇는 것이라 사용자가 고른 값이 그대로 맞다.
#[tauri::command]
pub fn issue_follow_up(app: AppHandle, project_id: String, issue_id: String, note: String) -> Result<IssueView> {
	let store = app.state::<Store>();
	if note.trim().is_empty() {
		return msg("메모가 비어 있습니다");
	}
	let src = store.raw_issue(&project_id, &issue_id)?;
	if src.talk {
		return msg("메모에서만 후속 메모를 만들 수 있습니다");
	}
	let settings = store.settings()?;
	let from = IssueRef { id: src.id.clone(), number: src.number, title: src.title.clone() };
	// 새 메모를 다 쓴 뒤에 앞선 메모를 고친다. store 의 잠금은 다시 들어갈 수 없어 한 번에 하나씩 부른다.
	let v = store.create_issue(&project_id, None, &note, settings.auto_plan, runner::new_title_mode(&settings), &src.model, &src.effort, Some(from))?;
	emit_issue(&app, &v);
	let line = format!("#{} {}", v.issue.number, v.issue.title);
	change(&app, &project_id, &issue_id, |i| {
		i.log("follow", line);
		Ok(())
	})?;
	Ok(v)
}

/// 제목을 손으로 고친다. 고친 제목은 메모를 바꿔도 덮지 않는다. 비우면 다시 제목 모델에 맡긴다(모델을 껐으면 첫 줄).
/// 프로젝트 대화는 메모가 없어 첫 질문이 첫 줄 노릇을 한다. 비우면 제목 짓기 순회가 첫 문답으로 다시 짓는다.
#[tauri::command]
pub fn issue_set_title(app: AppHandle, project_id: String, issue_id: String, title: String) -> Result<IssueView> {
	let store = app.state::<Store>();
	let note = store.get_issue(&project_id, &issue_id)?.note;
	let mode = runner::new_title_mode(&store.settings()?);
	let title: String = title.trim().chars().take(80).collect();
	change(&app, &project_id, &issue_id, |i| {
		if title.is_empty() {
			let first = i.runs.first().map(|r| r.prompt.clone()).unwrap_or_default();
			i.title = title_of(if i.talk { &first } else { &note });
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

#[tauri::command(async)]
pub fn talks_list(store: State<Store>, project_id: String) -> Result<Vec<IssueView>> {
	perf::command("talks_list", &project_id, || store.list_talks(&project_id))
}

#[tauri::command]
pub fn talk_create(app: AppHandle, project_id: String, talk_id: String) -> Result<IssueView> {
	let v = app.state::<Store>().create_talk(&project_id, &talk_id)?;
	emit_issue(&app, &v);
	Ok(v)
}

/// 앱 대화가 도는 가상의 프로젝트(앱 데이터 폴더 · 권한 칸). 프로젝트 목록에는 없어 따로 받는다.
#[tauri::command]
pub fn app_project(store: State<Store>) -> Result<Project> {
	store.global_project()
}

/// 메모의 대화를 프로젝트 대화로 갈라 낸다. 메모는 그대로 남는다.
/// 워크트리에서 돈 메모면 세션 기록이 그 폴더의 자리에 있어, 대화가 도는 프로젝트 폴더의 자리로 복사해 둔다.
#[tauri::command]
pub fn talk_promote(app: AppHandle, project_id: String, issue_id: String, talk_id: String) -> Result<IssueView> {
	let store = app.state::<Store>();
	let src = store.raw_issue(&project_id, &issue_id)?;
	let project = store.project(&project_id)?;
	let from = src.worktree.as_ref().map_or(project.path.as_str(), |w| w.path.as_str());
	runner::copy_transcript(&src.session_id, from, &project.path);
	let (talk, issue) = store.talk_from_issue(&project_id, &issue_id, &talk_id)?;
	emit_issue(&app, &issue);
	emit_issue(&app, &talk);
	Ok(talk)
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

/// 워크트리에서 끝난 구현을 본 작업트리에 반영한다. 파일을 합치느라 git 을 여러 번 부르므로 async 로 둔다.
#[tauri::command]
pub async fn issue_merge(app: AppHandle, project_id: String, issue_id: String) -> Result<IssueView> {
	runner::merge(&app, &project_id, &issue_id).await
}

#[tauri::command]
pub fn issue_chat(app: AppHandle, project_id: String, issue_id: String, text: String, mode: ChatMode, images: Option<Vec<String>>) -> Result<IssueView> {
	runner::chat(&app, &project_id, &issue_id, text, mode, images.unwrap_or_default())
}

/// 대화가 기다리는 승인 · 되묻기에 답한다. updated_input 은 AskUserQuestion 의 답(answers)을 담은 입력이다.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn issue_chat_answer(
	app: AppHandle,
	project_id: String,
	issue_id: String,
	request_id: String,
	allow: bool,
	updated_input: Option<serde_json::Value>,
	remember: Option<bool>,
	message: Option<String>,
) -> Result<IssueView> {
	runner::chat_answer(&app, &project_id, &issue_id, &request_id, allow, updated_input, remember.unwrap_or(false), message.as_deref().unwrap_or(""))
}

/// 입력칸 `/` 자동완성 한 줄. source: cli(그 프로젝트의 실행이 알려 준 것) · skill · command(Claude 설정에서 찾은 것) · app(앱이 받아 처리)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashItem {
	name: String,
	description: String,
	source: &'static str,
}

/// CLI 기본 명령 중 `-p` 에서도 뜻이 있는 것의 풀이. 목록에는 실행이 알려 준 것만 오르고, 여기에는 풀이만 둔다.
const SLASH_NOTES: &[(&str, &str)] = &[
	("compact", "지난 대화를 요약해 컨텍스트를 줄입니다"),
	("context", "컨텍스트를 무엇이 차지하는지 보입니다"),
	("cost", "이 세션이 쓴 토큰 · 비용"),
	("init", "저장소를 읽고 CLAUDE.md 를 만듭니다"),
	("review", "변경을 검토합니다"),
	("security-review", "변경의 보안 검토"),
	("pr-comments", "PR 댓글을 가져옵니다"),
];

/// 슬래시 명령 후보. 그 프로젝트에서 마지막으로 돈 실행의 init 목록이 앞서고(실제로 쓸 수 있는 것), 아직 돌린 적이 없으면
/// Claude 설정에서 찾은 스킬 · 명령을 보인다. /clear · /model 은 -p 에서 뜻이 없어 앱이 받아 처리한다.
#[tauri::command(async)]
pub fn slash_commands(app: AppHandle, project_id: String) -> Result<Vec<SlashItem>> {
	let store = app.state::<Store>();
	let root = store.project(&project_id).ok().map(|p| PathBuf::from(p.path)).filter(|p| p.is_dir() && project_id != GLOBAL_PID);
	let resources: Vec<Resource> = claude_files::list(root.as_deref(), &[]).into_iter().filter(|r| r.kind == "skill" || r.kind == "command").collect();
	let note = |name: &str| -> String {
		SLASH_NOTES.iter().find(|(n, _)| *n == name).map(|(_, d)| d.to_string()).or_else(|| resources.iter().find(|r| r.name == name).map(|r| r.description.clone())).unwrap_or_default()
	};
	let mut out = vec![
		SlashItem { name: "clear".into(), description: "새 대화를 엽니다".into(), source: "app" },
		SlashItem { name: "model".into(), description: "이 대화의 모델 · effort 를 고릅니다".into(), source: "app" },
	];
	let cli = app.state::<runner::Runner>().slash_commands(&project_id);
	for name in &cli {
		if !out.iter().any(|x| x.name == *name) {
			out.push(SlashItem { name: name.clone(), description: note(name), source: "cli" });
		}
	}
	if cli.is_empty() {
		out.push(SlashItem { name: "compact".into(), description: note("compact"), source: "cli" });
	}
	for r in &resources {
		if !out.iter().any(|x| x.name == r.name) {
			out.push(SlashItem { name: r.name.clone(), description: r.description.clone(), source: if r.kind == "skill" { "skill" } else { "command" } });
		}
	}
	Ok(out)
}

/// `@` 자동완성의 파일 목록. git 저장소면 .gitignore 를 따르는 `git ls-files` 를, 아니면 흔한 빌드 폴더를 건너뛰며 훑는다.
/// 치는 글자마다 부르므로 프로젝트마다 30초 동안 목록을 들고 있는다.
#[tauri::command(async)]
pub fn project_files(store: State<Store>, project_id: String, query: String) -> Result<Vec<String>> {
	use std::sync::Mutex;
	use std::time::{Duration, Instant};
	static CACHE: Mutex<Option<std::collections::HashMap<String, (Instant, Vec<String>)>>> = Mutex::new(None);
	let project = store.project(&project_id)?;
	let root = PathBuf::from(&project.path);
	if !root.is_dir() {
		return Ok(Vec::new());
	}
	let files = {
		let mut c = CACHE.lock().unwrap_or_else(|e| e.into_inner());
		let map = c.get_or_insert_with(Default::default);
		match map.get(&project_id).filter(|(at, _)| at.elapsed() < Duration::from_secs(30)) {
			Some((_, f)) => f.clone(),
			None => {
				let f = list_files(&root);
				map.insert(project_id.clone(), (Instant::now(), f.clone()));
				f
			}
		}
	};
	let q = query.trim().to_lowercase().replace('\\', "/");
	let mut hits: Vec<(u8, &String)> = files
		.iter()
		.filter_map(|f| {
			let lower = f.to_lowercase();
			let name = lower.rsplit('/').next().unwrap_or(&lower);
			let score = if q.is_empty() || name.starts_with(&q) {
				0
			} else if name.contains(&q) {
				1
			} else if lower.contains(&q) {
				2
			} else {
				return None;
			};
			Some((score, f))
		})
		.collect();
	hits.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.len().cmp(&b.1.len())));
	Ok(hits.into_iter().take(30).map(|(_, f)| f.clone()).collect())
}

fn list_files(root: &Path) -> Vec<String> {
	const MAX: usize = 20_000;
	if root.join(".git").exists() {
		let mut cmd = std::process::Command::new("git");
		cmd.arg("-C").arg(root).args(["ls-files", "--cached", "--others", "--exclude-standard"]);
		#[cfg(windows)]
		{
			use std::os::windows::process::CommandExt;
			cmd.creation_flags(0x0800_0000);
		}
		if let Ok(o) = cmd.output()
			&& o.status.success()
		{
			return String::from_utf8_lossy(&o.stdout).lines().filter(|l| !l.is_empty()).take(MAX).map(String::from).collect();
		}
	}
	let mut out = Vec::new();
	let mut stack = vec![root.to_path_buf()];
	while let Some(dir) = stack.pop() {
		let Ok(rd) = std::fs::read_dir(&dir) else { continue };
		for e in rd.filter_map(|e| e.ok()) {
			let name = e.file_name().to_string_lossy().to_string();
			if name.starts_with('.') || ["node_modules", "target", "dist", "build", "bin", "obj", "__pycache__"].contains(&name.as_str()) {
				continue;
			}
			let p = e.path();
			if p.is_dir() {
				stack.push(p);
			} else if let Ok(rel) = p.strip_prefix(root) {
				out.push(rel.to_string_lossy().replace('\\', "/"));
				if out.len() >= MAX {
					return out;
				}
			}
		}
	}
	out
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
	// claude 는 실행 폴더의 자리에서 세션을 찾는다. 워크트리에서 도는 이슈는 그 폴더에서 연다.
	let cwd = v.issue.worktree.map_or(project.path, |w| w.path);
	tauri::async_runtime::spawn_blocking(move || {
		runner::open_terminal(&exe, Path::new(&cwd), &session, plugin.as_ref().map(|(n, t, e)| (n.as_str(), t, e.as_path())), &title)
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
#[tauri::command(async)]
pub fn issue_transcript(app: AppHandle, project_id: String, issue_id: String) -> Result<Vec<runner::Turn>> {
	let key = format!("{project_id}/{issue_id}");
	perf::command("issue_transcript", &key, || transcript(&app, &project_id, &issue_id))
}

fn transcript(app: &AppHandle, project_id: &str, issue_id: &str) -> Result<Vec<runner::Turn>> {
	let store = app.state::<Store>();
	let v = store.get_issue(project_id, issue_id)?;
	let project = store.project(project_id)?;
	let Some(path) = runner::transcript_path(&project.path, &v.issue.session_id) else { return Ok(Vec::new()) };
	let windows: Vec<(i64, i64)> = v.issue.runs.iter().map(|r| (r.started_at, if r.ended_at > 0 { r.ended_at } else { i64::MAX })).collect();
	let mut turns = runner::read_turns(&path, &project.path)?;
	turns.retain(|t| !windows.iter().any(|(a, b)| t.at >= *a && t.at <= *b));
	// 메모에서 갈라 낸 대화의 세션에는 메모의 계획 · 구현 차례가 앞에 들어 있다. 터미널 차례로 보이거나 그 변경을 담지 않게 갈라 낸 뒤만 본다.
	if v.issue.from_issue.is_some() {
		turns.retain(|t| t.at >= v.issue.created_at);
	}
	// 터미널에서 고친 파일도 변경 탭에 있어야 되돌리기 · 산출물이 빠뜨리지 않는다. 새로 담을 것이 있을 때만 쓴다.
	if runner::absorb_terminal(&mut v.issue.clone(), &turns) {
		change(app, project_id, issue_id, |i| {
			runner::absorb_terminal(i, &turns);
			Ok(())
		})?;
	}
	Ok(turns)
}

#[tauri::command(async)]
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
		// 완료하면 워크트리의 수정이 본 작업트리에 들어가지 않은 채 잊힌다.
		if i.worktree.is_some() {
			return msg("워크트리에서 고친 것을 먼저 반영하거나 되돌리세요");
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
	let store = app.state::<Store>();
	let worktree = store.raw_issue(&project_id, &issue_id).ok().and_then(|i| i.worktree);
	store.delete_issue(&project_id, &issue_id)?;
	// 이슈를 지우면 워크트리를 찾을 길이 없다. 반영하지 않은 수정도 함께 버린다 — 지우기 확인 창이 이미 물었다.
	if let (Some(w), Ok(p)) = (worktree, store.project(&project_id)) {
		tauri::async_runtime::spawn_blocking(move || crate::worktree::remove(Path::new(&p.path), Path::new(&w.path)));
	}
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

#[tauri::command(async)]
pub fn run_events(store: State<Store>, project_id: String, target: String, target_id: String, run_id: String) -> Result<Vec<RunEvent>> {
	let project = store.project(&project_id)?;
	let path = if target == "issue" {
		store.issue_run_log(&project_id, &target_id, &run_id)?
	} else {
		// deliverable · learn(작성법 뽑기) 모두 산출물의 runs/ 에 남는다.
		store.deliverable_run_log(&project_id, &target_id, &run_id)?
	};
	if !path.exists() {
		return Ok(Vec::new());
	}
	runner::replay(&path, &project.path)
}

/* ---------- 산출물 ---------- */

#[tauri::command(async)]
pub fn deliverables_list(store: State<Store>, project_id: String) -> Result<Vec<DeliverableView>> {
	perf::command("deliverables_list", &project_id, || store.list_deliverables(&project_id))
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
		return msg("가져올 파일이 없습니다.");
	}
	kb::touch(&app, &project_id);
	Ok(out)
}

/// 폴더 가져오기 한 번에 받는 파일 수. 드라이브 전체를 놓은 실수로 수천 개를 복사하지 않게 한다.
const FOLDER_IMPORT_MAX: usize = 500;

/// 놓인 경로를 파일과 폴더로 나눈다. 화면은 경로가 무엇인지 알 수 없다.
#[derive(Serialize)]
pub struct PathKinds {
	files: Vec<String>,
	folders: Vec<String>,
}

#[tauri::command]
pub fn paths_split(paths: Vec<String>) -> PathKinds {
	let (folders, rest): (Vec<String>, Vec<String>) = paths.into_iter().partition(|p| Path::new(p).is_dir());
	PathKinds { files: rest.into_iter().filter(|p| Path::new(p).is_file()).collect(), folders }
}

/// 폴더가 놓일 책장 칸. 산출물 폴더 안이면 그 안의 자리를 그대로 쓰고(산출물 폴더 자체면 맨 위), 밖이면 폴더 이름이 첫 칸이다.
fn folder_cell(root: &Path, base: Option<&Path>) -> String {
	match base.and_then(|b| root.strip_prefix(b).ok()) {
		Some(rel) => rel.to_string_lossy().replace('\\', "/"),
		None => root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
	}
}

/// 폴더를 훑어 (파일, 칸)을 낸다. 숨은 폴더 · 빌드 폴더 · 지난 판 폴더 · 키 파일 · 잠금 파일은 뺀다. max 를 넘으면 그 자리에서 멈춘다.
fn scan_folder(root: &Path, cell: &str, archive: &str, max: usize) -> Vec<(PathBuf, String)> {
	let mut out = Vec::new();
	let mut stack = vec![(root.to_path_buf(), cell.to_string())];
	while let Some((dir, cell)) = stack.pop() {
		let Ok(rd) = std::fs::read_dir(&dir) else { continue };
		let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
		entries.sort_by_key(|e| e.file_name());
		for e in entries {
			let Ok(t) = e.file_type() else { continue };
			let name = e.file_name().to_string_lossy().to_string();
			if t.is_symlink() {
				continue;
			}
			if t.is_dir() {
				if !kb::skip_dir(&name) && name != archive {
					let next = if cell.is_empty() { name } else { format!("{cell}/{name}") };
					stack.push((e.path(), next));
				}
			} else if !name.starts_with('.') && !name.starts_with("~$") && !kb::secret_name(&name) {
				out.push((e.path(), cell.clone()));
				if out.len() > max {
					return out;
				}
			}
		}
	}
	out
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderImport {
	/// 새 산출물 · 기존 산출물의 새 판으로 들어온 파일 수
	imported: usize,
	/// 이미 있어 건너뛴 파일 수
	skipped: usize,
	failed: usize,
	/// 실패한 것의 앞 몇 건. 알림에 보인다.
	errors: Vec<String>,
}

/// 폴더를 하위 구조대로 책장에 들인다. 파일 하나가 산출물 하나고, 작성법은 뽑지 않는다 — 파일마다 Claude 를 부르면 비용이 크게 든다.
/// 파일 하나가 실패해도 나머지를 계속한다.
#[tauri::command(async)]
pub fn deliverable_import_folder(app: AppHandle, project_id: String, paths: Vec<String>) -> Result<FolderImport> {
	let store = app.state::<Store>();
	let project = store.project(&project_id)?;
	let base = Some(project.deliverables_dir.trim()).filter(|b| !b.is_empty()).map(PathBuf::from);
	let archive = project.archive_dir.trim().trim_matches(['/', '\\']);
	let mut found = Vec::new();
	for root in paths.iter().map(PathBuf::from).filter(|p| p.is_dir()) {
		found.extend(scan_folder(&root, &folder_cell(&root, base.as_deref()), archive, FOLDER_IMPORT_MAX));
		if found.len() > FOLDER_IMPORT_MAX {
			return msg(format!("파일이 {FOLDER_IMPORT_MAX}개를 넘어 가져오지 않았습니다. 더 작은 폴더로 나눠 가져오세요."));
		}
	}
	if found.is_empty() {
		return msg("가져올 파일이 없습니다.");
	}
	let mut known = store.deliverables_raw(&project_id)?;
	let mut result = FolderImport::default();
	for (file, cell) in found {
		let name = file.file_name().unwrap_or_default().to_string_lossy().to_string();
		let one = (|| -> Result<bool> {
			let cell = crate::store::clean_subdir(&cell)?;
			match store.import_found(&project_id, &mut known, &file, &cell)? {
				FoundImport::Skipped => Ok(false),
				FoundImport::Created(did) => {
					// 파일 가져오기와 같이 오피스 파일은 견본을 한 부 둔다.
					if recipe::is_template(&file.to_string_lossy()) {
						store.import_refs(&project_id, &did, &[file.to_string_lossy().to_string()])?;
					}
					recipe::after_files(&app, &project_id, &did, false)?;
					Ok(true)
				}
				FoundImport::Updated(did) => {
					recipe::after_files(&app, &project_id, &did, false)?;
					Ok(true)
				}
			}
		})();
		match one {
			Ok(true) => result.imported += 1,
			Ok(false) => result.skipped += 1,
			Err(e) => {
				result.failed += 1;
				if result.errors.len() < 3 {
					result.errors.push(format!("{name}: {e}"));
				}
			}
		}
	}
	if result.imported > 0 {
		kb::touch(&app, &project_id);
	}
	Ok(result)
}

/// 다른 책장 칸으로 옮긴다. 산출물 폴더를 정했으면 최신 판 파일도 옮긴다.
#[tauri::command]
pub fn deliverable_move_shelf(app: AppHandle, project_id: String, deliverable_id: String, subdir: String) -> Result<DeliverableView> {
	let v = app.state::<Store>().move_shelf(&project_id, &deliverable_id, &subdir)?;
	emit_deliverable(&app, &v);
	kb::touch(&app, &project_id);
	Ok(v)
}

#[tauri::command]
pub async fn deliverable_thumb(app: AppHandle, project_id: String, deliverable_id: String, n: u32) -> Result<crate::thumb::Thumb> {
	crate::thumb::thumb(&app, &project_id, &deliverable_id, n).await
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
	/// 무엇이 바뀌면 새 판을 쓸지(`code` · `db:<자료 id>`). 없으면 지금 값을 그대로 둔다.
	#[serde(default)]
	triggers: Option<Vec<String>>,
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
		if let Some(list) = &patch.triggers {
			let mut out: Vec<String> = Vec::new();
			for t in list.iter().map(|t| t.trim()) {
				let ok = t == TRIGGER_CODE || t.strip_prefix(TRIGGER_DB).is_some_and(|s| !s.is_empty());
				if ok && !out.iter().any(|o| o == t) {
					out.push(t.to_string());
				}
			}
			d.triggers = out;
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

/// 작성법 뽑기를 멈춘다. 자리를 기다리던 뽑기는 줄에서 빠진다. 칸 · 제안은 그대로 둔다.
#[tauri::command]
pub fn deliverable_learn_stop(app: AppHandle, project_id: String, deliverable_id: String) -> Result<()> {
	app.state::<runner::Runner>().stop(&runner::learn_key(&project_id, &deliverable_id));
	Ok(())
}

/// 뽑은 제안을 적용하거나 버린다. field: skill · vocab · format · naming · template · all
/// terms 를 주면 어휘 제안 가운데 그 말만 처리한다. 없으면 칸 전체다.
#[tauri::command]
pub fn deliverable_draft_apply(app: AppHandle, project_id: String, deliverable_id: String, field: String, apply: bool, terms: Option<Vec<String>>) -> Result<DeliverableView> {
	let v = app.state::<Store>().update_deliverable(&project_id, &deliverable_id, |d| match (&terms, field.as_str()) {
		(Some(terms), "vocab") => {
			recipe::apply_draft_vocab(d, terms, apply);
			Ok(())
		}
		_ => recipe::apply_draft(d, &field, apply),
	})?;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Promoted {
	deliverable: DeliverableView,
	/// 사전에 새로 더한 말 수
	added: usize,
	/// 사전에 이미 있어 피할 말 · 뜻만 보탠 말 수
	merged: usize,
}

/// 산출물 어휘(제안 포함)를 프로젝트 어휘 사전으로 옮긴다. 사전에 같은 말이 있으면 피할 말 · 뜻만 보탠다.
/// 사전은 한 번만 저장한다 — 말마다 저장하면 updated_at 이 바뀌어 두 번째부터 충돌로 실패한다.
#[tauri::command]
pub fn deliverable_vocab_promote(app: AppHandle, project_id: String, deliverable_id: String, terms: Vec<String>) -> Result<Promoted> {
	let store = app.state::<Store>();
	let d = store.get_deliverable(&project_id, &deliverable_id)?.deliverable;
	let keys: Vec<String> = terms.iter().map(|t| t.trim().to_lowercase()).filter(|k| !k.is_empty()).collect();
	let picked: Vec<Term> = d.vocab.iter().chain(&d.draft.vocab).filter(|t| keys.contains(&t.term.trim().to_lowercase())).cloned().collect();
	if picked.is_empty() {
		return msg("그 어휘가 없습니다");
	}
	let file = store.glossary(&project_id);
	let mut entries = file.entries.clone();
	let (mut added, mut merged) = (0, 0);
	for t in &picked {
		let k = t.term.trim().to_lowercase();
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
				merged += 1;
			}
			// 사전의 「비슷한 말」은 같은 것을 가리키는 다른 표현이라 피할 말을 그리로 옮긴다.
			None => {
				entries.push(GlossaryEntry { term: t.term.clone(), meaning: t.note.clone(), aliases: t.avoid.clone() });
				added += 1;
			}
		}
	}
	store.save_glossary_entries(&project_id, &entries, file.updated_at)?;
	// 사전과 산출물에 같은 말을 겹쳐 두지 않는다. 제안에서 바로 올린 말도 제안에서 뺀다.
	let v = store.update_deliverable(&project_id, &deliverable_id, |d| {
		d.vocab.retain(|x| !keys.contains(&x.term.trim().to_lowercase()));
		d.draft.vocab.retain(|x| !keys.contains(&x.term.trim().to_lowercase()));
		Ok(())
	})?;
	emit_deliverable(&app, &v);
	Ok(Promoted { deliverable: v, added, merged })
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

/// 반영 대기(이슈 · DB 변경) 가운데 고른 것들을 한 번에 반영한 새 판을 쓴다(kb::catch_up).
#[tauri::command]
pub fn deliverable_catch_up(app: AppHandle, project_id: String, deliverable_id: String, issue_ids: Vec<String>) -> Result<DeliverableView> {
	kb::catch_up(&app, &project_id, &deliverable_id, &issue_ids)
}

/* ---------- DB 자료 ---------- */

#[tauri::command]
pub fn db_sources_list(store: State<Store>, project_id: String) -> Result<Vec<dbsrc::DbSourceView>> {
	dbsrc::views(&store, &project_id)
}

/// 목록을 통째로 저장한다. 빠진 자료를 트리거로 고른 산출물은 그 트리거만 쓸모가 없어진다(반영 대기 · 판정에서 빠진다).
#[tauri::command]
pub fn db_sources_save(app: AppHandle, project_id: String, sources: Vec<DbSource>) -> Result<Vec<dbsrc::DbSourceView>> {
	let store = app.state::<Store>();
	store.save_db_sources(&project_id, dbsrc::clean(&sources)?)?;
	dbsrc::emit_project(&app, &project_id);
	dbsrc::views(&store, &project_id)
}

/// 자료 하나를 지금 받는다. 바뀌었으면 트리거로 고른 산출물을 판정한다(기다리지 않는다).
#[tauri::command]
pub async fn db_source_fetch(app: AppHandle, project_id: String, source_id: String) -> Result<dbsrc::FetchResult> {
	let r = dbsrc::fetch(&app, &project_id, &source_id).await;
	dbsrc::emit_project(&app, &project_id);
	let r = r?;
	if r.changed {
		tauri::async_runtime::spawn(kb::after_db_change(app.clone(), project_id));
	}
	Ok(r)
}

/// 두 스냅숏의 변경 글
#[tauri::command]
pub fn db_snapshot_compare(store: State<Store>, project_id: String, source_id: String, from: String, to: String) -> Result<String> {
	dbsrc::compare(&store, &project_id, &source_id, &from, &to)
}

/// 자동으로 쓴 판을 검토한다. keep 이면 검토 표지만 지우고, 아니면 그 판을 휴지통으로 옮긴다.
#[tauri::command]
pub fn deliverable_version_review(app: AppHandle, project_id: String, deliverable_id: String, n: u32, keep: bool) -> Result<DeliverableView> {
	let v = app.state::<Store>().review_version(&project_id, &deliverable_id, n, keep)?;
	emit_deliverable(&app, &v);
	Ok(v)
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

#[tauri::command(async)]
pub fn kb_status(app: AppHandle, project_id: String) -> Result<kb::KbView> {
	perf::command("kb_status", &project_id, || kb::status(&app, &project_id))
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

#[tauri::command(async)]
pub fn memory_get(app: AppHandle, project_id: String) -> Result<memory::MemoryView> {
	memory::view(&app, &project_id)
}

/// 끄면 소화 줄도 멈춘다.
#[tauri::command]
pub fn memory_save_settings(app: AppHandle, project_id: String, memory: ProjectMemory) -> Result<memory::MemoryView> {
	let p = app.state::<Store>().save_memory_settings(&project_id, &memory)?;
	if !p.memory.enabled {
		app.state::<memory::Memory>().stop(&project_id);
	}
	memory::view(&app, &project_id)
}

/// 파일 · 폴더를 소화 줄에 세운다. 복사하지 않고 제자리에서 읽는다.
#[tauri::command]
pub fn memory_digest(app: AppHandle, project_id: String, paths: Vec<String>) -> Result<usize> {
	memory::request(&app, &project_id, &paths)
}

#[tauri::command]
pub fn memory_stop(app: AppHandle, project_id: String) -> bool {
	app.state::<memory::Memory>().stop(&project_id)
}

#[tauri::command]
pub fn memory_add(app: AppHandle, project_id: String, kind: String, text: String) -> Result<memory::MemoryView> {
	memory::add(&app.state::<Store>(), &project_id, &kind, &text)?;
	memory::view(&app, &project_id)
}

#[tauri::command]
pub fn memory_edit(app: AppHandle, project_id: String, id: String, kind: String, text: String) -> Result<memory::MemoryView> {
	memory::edit(&app.state::<Store>(), &project_id, &id, &kind, &text)?;
	memory::view(&app, &project_id)
}

#[tauri::command]
pub fn memory_delete(app: AppHandle, project_id: String, id: String) -> Result<memory::MemoryView> {
	memory::remove(&app.state::<Store>(), &project_id, &id)?;
	memory::view(&app, &project_id)
}

/// 승인 대기를 넣거나, 밀린 항목을 되돌린다.
#[tauri::command]
pub fn memory_approve(app: AppHandle, project_id: String, id: String) -> Result<memory::MemoryView> {
	memory::approve_entry(&app.state::<Store>(), &project_id, &id)?;
	memory::view(&app, &project_id)
}

/// 소화가 버린 내용을 되살린다.
#[tauri::command]
pub fn memory_restore(app: AppHandle, project_id: String, digest_id: String, index: usize) -> Result<memory::MemoryView> {
	memory::restore(&app.state::<Store>(), &project_id, &digest_id, index)?;
	memory::view(&app, &project_id)
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn resources_list(store: State<Store>, project_id: Option<String>) -> Result<Vec<Resource>> {
	let project = match project_id.filter(|p| !p.is_empty()) {
		Some(pid) => Some(store.project(&pid)?),
		None => None,
	};
	let root = project.as_ref().map(|p| PathBuf::from(&p.path));
	Ok(claude_files::list(root.as_deref(), project.as_ref().map_or(&[][..], |p| &p.extra_dirs)))
}

/// 전역 지침(CLAUDE.md · rules 의 파일)을 docket 실행에 싣거나 뺀다. key 는 ~/.claude 기준 경로다.
#[tauri::command]
pub fn claude_run_include(store: State<Store>, key: String, include: bool) -> Result<Settings> {
	let key = key.trim().replace('\\', "/");
	if !(key == "CLAUDE.md" || key.starts_with("rules/")) || key.split('/').any(|s| s == "..") {
		return msg("전역 CLAUDE.md 와 rules 만 싣고 뺄 수 있습니다");
	}
	let mut s = store.settings()?;
	s.run_excludes = claude_files::with_included(&s.run_excludes, &key, include);
	let saved = store.save_settings(&s)?;
	runner::note_settings(&saved);
	Ok(saved)
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

#[cfg(test)]
mod shelf_tests {
	use super::*;

	/// 산출물 폴더 안이면 그 자리, 산출물 폴더 자체면 맨 위, 밖이면 폴더 이름이 칸이다.
	#[test]
	fn folder_cell_follows_where_it_is() {
		let base = Path::new("D:\\out");
		assert_eq!(folder_cell(Path::new("D:\\out"), Some(base)), "");
		assert_eq!(folder_cell(Path::new("D:\\out\\요구\\중간"), Some(base)), "요구/중간");
		assert_eq!(folder_cell(Path::new("D:\\받은\\자료"), Some(base)), "자료");
		assert_eq!(folder_cell(Path::new("D:\\받은\\자료"), None), "자료");
	}

	/// 하위 폴더는 칸이 되고, 지난 판 폴더 · 숨은 폴더 · 키 파일 · 잠금 파일은 빠지며, 상한을 넘으면 멈춘다.
	#[test]
	fn scan_keeps_structure_and_skips_noise() {
		let root = std::env::temp_dir().join(format!("docket-scan-{}", short_id()));
		for dir in ["a/b", "이전판", ".git", "node_modules"] {
			std::fs::create_dir_all(root.join(dir)).unwrap();
		}
		for file in ["맨위.md", "a/가.docx", "a/b/나.pdf", "이전판/옛.md", ".git/x", "node_modules/y", "server.pem", "~$잠금.docx"] {
			std::fs::write(root.join(file), "x").unwrap();
		}
		let mut got: Vec<(String, String)> = scan_folder(&root, "칸", "이전판", 500).into_iter().map(|(p, c)| (p.file_name().unwrap().to_string_lossy().to_string(), c)).collect();
		got.sort();
		let want = [("가.docx", "칸/a"), ("나.pdf", "칸/a/b"), ("맨위.md", "칸")].map(|(a, b)| (a.to_string(), b.to_string()));
		assert_eq!(got, want);
		assert_eq!(scan_folder(&root, "", "이전판", 1).len(), 2);
		let _ = std::fs::remove_dir_all(root);
	}
}