mod claude_files;
mod commands;
mod dbsrc;
mod error;
mod extract;
mod global_talk;
mod glossary;
mod kb;
mod memory;
mod model;
mod naming;
mod perf;
mod plugin_host;
mod quick;
mod recipe;
mod runner;
mod store;
mod thumb;
mod tray;
mod usage;
mod worktree;

use tauri::Manager;

/// 앱이 스스로를 한 번 더 띄워 맡긴 일이면 그 일을 하고 종료 코드를 돌려준다. 지금은 PDF 글자 뽑기 하나다(extract::pdf_text).
pub fn child_task() -> Option<i32> {
	let args: Vec<String> = std::env::args().skip(1).collect();
	(args.first().map(String::as_str) == Some(extract::PDF_FLAG)).then(|| extract::pdf_child(&args[1..]))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	let builder = tauri::Builder::default();
	// 트레이에 숨어 있을 때 docket 을 또 켜면 숨은 주 창을 띄우고 새 프로세스는 끝낸다. 두 프로세스가 데이터 폴더를 함께 쓰지 않게 하려는 것이다.
	// 다른 플러그인보다 먼저 달아야 한다. 개발 실행은 설치본과 identifier 가 같아 서로 막으므로 달지 않는다.
	#[cfg(not(debug_assertions))]
	let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| quick::show_main(app)));
	builder
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_updater::Builder::new().build())
		.plugin(tauri_plugin_process::init())
		.plugin(tauri_plugin_notification::init())
		.plugin(quick::shortcut_plugin())
		.setup(|app| {
			let store = store::Store::open()?;
			if let Err(e) = store.recover_interrupted() {
				eprintln!("끊긴 실행을 정리하지 못함: {e}");
			}
			if let Err(e) = store.sweep_blank_talks() {
				eprintln!("빈 대화를 정리하지 못함: {e}");
			}
			runner::note_settings(&store.settings().unwrap_or_default());
			// 첨부 이미지를 화면에 띄우려면 데이터 폴더를 asset 프로토콜에 연다. DOCKET_HOME 으로 옮겨도 따라가도록 실행 때 연다.
			app.asset_protocol_scope().allow_directory(&store.root, true)?;
			// 프로젝트마다 정한 산출물 폴더도 연다. 그 폴더의 그림 판을 화면에서 미리 본다.
			for p in store.projects().unwrap_or_default().iter().filter(|p| !p.deliverables_dir.is_empty()) {
				let _ = app.asset_protocol_scope().allow_directory(&p.deliverables_dir, true);
			}
			// 창 바탕을 테마에 맞춘다. 화면이 그려지기 전에 잠깐 보이는 색이다. tauri.conf.json 의 색은 어두운 테마 것이다.
			let settings = store.settings().unwrap_or_default();
			let mut light = settings.theme == "light";
			if let Some(w) = app.get_webview_window("main") {
				light = light || (settings.theme == "system" && matches!(w.theme(), Ok(tauri::Theme::Light)));
				if light {
					let _ = w.set_background_color(Some(tauri::window::Color(247, 247, 247, 255)));
				}
			}
			// 트레이 · 빠른 메모 창 · 전역 단축키. 어느 하나가 안 돼도 앱은 켠다 — 단축키는 다른 프로그램이 먼저 잡았을 수 있다.
			if let Err(e) = tray::create(app.handle()) {
				eprintln!("트레이 아이콘을 만들지 못함: {e}");
			}
			if let Err(e) = quick::create(app.handle(), light) {
				eprintln!("빠른 메모 창을 만들지 못함: {e}");
			}
			if let Err(e) = quick::apply_key(app.handle(), &settings.quick_capture_key) {
				eprintln!("{e}");
			}
			// 예전에 「herdr 정의 만들기」로 만든 파일은 이제 코어 플러그인이 맡는다. 남겨 두면 같은 id 가 둘이 된다.
			plugin_host::core::retire_on_start(&store);
			usage::init(app.handle().clone(), &store.root);
			app.manage(store);
			app.manage(runner::Runner::default());
			app.manage(kb::Kb::default());
			app.manage(memory::Memory::default());
			runner::spawn_auto_planner(app.handle().clone());
			runner::spawn_titler(app.handle().clone());
			kb::spawn_indexer(app.handle().clone());
			memory::spawn_digester(app.handle().clone());
			dbsrc::spawn_startup(app.handle().clone());
			Ok(())
		})
		.invoke_handler(tauri::generate_handler![
			commands::app_info,
			commands::perf_enabled,
			commands::update_installable,
			commands::doc_tools_check,
			commands::usage_get,
			commands::spend_summary,
			commands::settings_get,
			commands::settings_save,
			commands::quick_key_error,
			commands::app_quit,
			commands::path_open,
			commands::path_reveal,
			commands::projects_list,
			commands::project_add,
			commands::project_save,
			commands::deliverable_settings_save,
			commands::naming_preview,
			commands::project_remove,
			commands::project_archive,
			commands::project_allow,
			commands::permissions_view,
			commands::permissions_suggest,
			commands::issues_list,
			commands::issue_get,
			commands::issue_create,
			commands::issue_follow_up,
			commands::talks_list,
			commands::talk_create,
			commands::talk_promote,
			commands::app_project,
			commands::issue_save_note,
			commands::issue_set_title,
			commands::issue_set_auto_plan,
			commands::issue_set_model,
			commands::issue_set_effort,
			commands::issue_plan,
			commands::issue_approve,
			commands::issue_rework,
			commands::runs_stop_all,
			commands::issue_revert,
			commands::issue_merge,
			commands::issue_chat,
			commands::issue_chat_answer,
			commands::slash_commands,
			commands::project_files,
			commands::issue_queue_remove,
			commands::issue_queue_send,
			commands::issue_open_terminal,
			commands::issue_transcript,
			commands::issue_sessions,
			commands::issue_set_session,
			commands::plugins_list,
			commands::plugin_grant,
			commands::plugin_inspect,
			commands::plugin_install,
			commands::plugin_uninstall,
			commands::plugin_settings_get,
			commands::plugin_settings_set,
			commands::plugin_invoke,
			commands::issue_complete,
			commands::issue_drop,
			commands::issue_reopen,
			commands::issue_clear_error,
			commands::issue_stop,
			commands::issue_delete,
			commands::attachment_save,
			commands::attachment_import,
			commands::attachment_delete,
			commands::asset_allow,
			commands::run_events,
			commands::deliverables_list,
			commands::deliverable_import,
			commands::deliverable_create,
			commands::deliverable_create_doc,
			commands::deliverable_refs_add,
			commands::deliverable_ref_delete,
			commands::deliverable_save_doc,
			commands::paths_split,
			commands::deliverable_import_folder,
			commands::deliverable_move_shelf,
			commands::deliverable_thumb,
			commands::deliverable_read_text,
			commands::deliverable_version_path,
			commands::deliverable_update,
			commands::deliverable_clear_error,
			commands::deliverable_delete,
			commands::deliverable_generate,
			commands::deliverable_stop,
			commands::deliverable_catch_up,
			commands::db_sources_list,
			commands::db_sources_save,
			commands::db_source_fetch,
			commands::db_snapshot_compare,
			commands::deliverable_version_review,
			commands::deliverable_from_issue,
			commands::deliverable_learn,
			commands::deliverable_learn_stop,
			commands::deliverable_draft_apply,
			commands::deliverable_set_template,
			commands::deliverable_vocab_promote,
			commands::kb_status,
			commands::kb_save,
			commands::kb_import,
			commands::kb_inbox_delete,
			commands::kb_reindex,
			commands::kb_stop,
			commands::kb_search,
			commands::kb_cards,
			commands::glossary_get,
			commands::glossary_save_entries,
			commands::glossary_save_settings,
			commands::memory_get,
			commands::memory_save_settings,
			commands::memory_digest,
			commands::memory_stop,
			commands::memory_add,
			commands::memory_edit,
			commands::memory_delete,
			commands::memory_approve,
			commands::memory_restore,
			commands::resources_list,
			commands::claude_run_include,
			commands::text_read,
			commands::text_write,
			commands::resource_create,
			commands::resource_delete,
		])
		.run(tauri::generate_context!())
		.expect("docket 을 띄우지 못했습니다");
}
