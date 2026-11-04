//! 작업 표시줄 알림 영역의 아이콘. 주 창을 닫아도 앱이 여기 남아 단축키를 듣고 돌던 작업을 이어 간다.
//!
//! 앱을 끝내는 길은 메뉴의 「끝내기」다. 돌고 있는 작업이 있으면 화면이 묻도록 주 창에 docket://quit 을 보낸다(src/components/TitleBar.tsx).

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::quick;

pub fn create(app: &AppHandle) -> tauri::Result<()> {
	let open = MenuItem::with_id(app, "open", "docket 열기", true, None::<&str>)?;
	let memo = MenuItem::with_id(app, "quick", "빠른 메모", true, None::<&str>)?;
	let sep = PredefinedMenuItem::separator(app)?;
	let quit = MenuItem::with_id(app, "quit", "끝내기", true, None::<&str>)?;
	let menu = Menu::with_items(app, &[&open, &memo, &sep, &quit])?;
	let mut b = TrayIconBuilder::with_id("main")
		.tooltip("docket")
		.menu(&menu)
		// 왼쪽 클릭은 주 창을 연다. 메뉴는 오른쪽 클릭에만 뜬다.
		.show_menu_on_left_click(false)
		.on_menu_event(|app, e| match e.id().as_ref() {
			"open" => quick::show_main(app),
			"quick" => quick::toggle(app),
			"quit" => request_quit(app),
			_ => {}
		})
		.on_tray_icon_event(|tray, e| {
			if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
				quick::show_main(tray.app_handle());
			}
		});
	if let Some(icon) = app.default_window_icon() {
		b = b.icon(icon.clone());
	}
	b.build(app)?;
	Ok(())
}

/// 화면에 끝내도 되는지 묻는다. 주 창이 없으면 물을 곳이 없으니 바로 끝낸다.
fn request_quit(app: &AppHandle) {
	if app.get_webview_window(quick::MAIN).is_some() {
		let _ = app.emit_to(quick::MAIN, "docket://quit", ());
	} else {
		app.exit(0);
	}
}
