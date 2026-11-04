//! 빠른 메모 창과 그것을 띄우는 전역 단축키.
//!
//! 다른 프로그램을 쓰다가 단축키를 누르면 작은 창이 떠서 메모를 적고 붙인다. 창은 켤 때 숨긴 채 만들어 두고 보였다 숨겼다만 한다.
//! 누를 때마다 WebView 를 새로 띄우면 첫 묶음을 풀어 읽는 동안 기다려야 한다. 화면은 같은 index.html 이 창 이름(quick)을 보고 고른다(src/main.tsx).

use std::sync::Mutex;

use tauri::plugin::TauriPlugin;
use tauri::window::Color;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::error::{Error, Result};

/// 설정이 비어 있지 않은 옛 설정 · 새 설치의 단축키. 앱 안 Ctrl+N(메모 붙이기)과 겹치지 않고, 편집기 단축키와도 잘 겹치지 않는 조합이다.
pub const DEFAULT_KEY: &str = "Ctrl+Shift+Space";
pub const LABEL: &str = "quick";
pub const MAIN: &str = "main";
const SIZE: (f64, f64) = (460.0, 300.0);

/// 시작할 때 단축키를 등록하지 못한 까닭. 설정 화면이 그 행에 보인다. 다시 등록되면 비운다.
static KEY_ERROR: Mutex<String> = Mutex::new(String::new());

fn set_error(e: &str) {
	if let Ok(mut g) = KEY_ERROR.lock() {
		*g = e.to_string();
	}
}

pub fn key_error() -> String {
	KEY_ERROR.lock().map(|g| g.clone()).unwrap_or_default()
}

/// 단축키 플러그인. 등록한 단축키는 하나뿐이라 무엇이 눌렸는지 따지지 않고 창을 띄우거나 숨긴다.
pub fn shortcut_plugin() -> TauriPlugin<Wry> {
	tauri_plugin_global_shortcut::Builder::new()
		.with_handler(|app, _shortcut, event| {
			if event.state() == ShortcutState::Pressed {
				toggle(app);
			}
		})
		.build()
}

/// 숨긴 빠른 창을 만든다. 바탕색은 주 창처럼 테마를 따른다 — 처음 보일 때 화면보다 먼저 드러나는 색이다.
pub fn create(app: &AppHandle, light: bool) -> tauri::Result<()> {
	let bg = if light { Color(247, 247, 247, 255) } else { Color(22, 22, 22, 255) };
	WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
		.title("docket 빠른 메모")
		.inner_size(SIZE.0, SIZE.1)
		.resizable(false)
		.maximizable(false)
		.minimizable(false)
		.decorations(false)
		.always_on_top(true)
		.skip_taskbar(true)
		.visible(false)
		.focused(false)
		.background_color(bg)
		.build()?;
	Ok(())
}

fn parse(key: &str) -> Result<Option<Shortcut>> {
	let key = key.trim();
	if key.is_empty() {
		return Ok(None);
	}
	key.parse::<Shortcut>().map(Some).map_err(|e| Error::Msg(format!("단축키 「{key}」를 알아보지 못했습니다 ({e})")))
}

/// 단축키를 바꿔 단다. 비우면 듣지 않는다. 다른 프로그램이 먼저 잡은 조합이면 오류다.
pub fn apply_key(app: &AppHandle, key: &str) -> Result<()> {
	let next = parse(key)?;
	let gs = app.global_shortcut();
	let _ = gs.unregister_all();
	if let Some(s) = next {
		if let Err(e) = gs.register(s) {
			let text = format!("단축키 {} 를 쓰지 못했습니다. 다른 프로그램이 쓰고 있을 수 있습니다 ({e})", key.trim());
			set_error(&text);
			return Err(Error::Msg(text));
		}
	}
	set_error("");
	Ok(())
}

/// 설정을 저장하기 전에 부른다. 단축키가 바뀌었을 때만 새로 달고, 실패하면 전 것을 되살려 저장을 막는다.
/// 바뀌지 않았으면 건드리지 않는다 — 시작 때 등록에 실패한 채라도 다른 설정을 저장할 때마다 오류가 나지 않게 하려는 것이다.
pub fn change_key(app: &AppHandle, old: &str, new: &str) -> Result<()> {
	if old.trim().eq_ignore_ascii_case(new.trim()) {
		return Ok(());
	}
	apply_key(app, new).inspect_err(|_| {
		let _ = apply_key(app, old);
	})
}

/// 단축키 · 트레이 메뉴의 「빠른 메모」. 앞에 떠 있으면 숨기고, 아니면 커서가 있는 화면 가운데 조금 위에 띄운다.
pub fn toggle(app: &AppHandle) {
	let Some(w) = app.get_webview_window(LABEL) else { return };
	let shown = w.is_visible().unwrap_or(false);
	if shown && w.is_focused().unwrap_or(false) {
		let _ = w.hide();
		return;
	}
	if !shown {
		place(&w);
	}
	let _ = w.show();
	let _ = w.set_focus();
	let _ = app.emit_to(LABEL, "docket://quick-open", ());
}

/// 커서가 있는 모니터의 가로 가운데 · 세로 1/3 자리. 모니터를 못 찾으면 지난 자리에 둔다.
fn place(w: &WebviewWindow) {
	let Ok(cursor) = w.cursor_position() else { return };
	let monitors = w.available_monitors().unwrap_or_default();
	let inside = |m: &&tauri::Monitor| {
		let (p, s) = (m.position(), m.size());
		cursor.x >= p.x as f64 && cursor.x < p.x as f64 + s.width as f64 && cursor.y >= p.y as f64 && cursor.y < p.y as f64 + s.height as f64
	};
	let Some(m) = monitors.iter().find(inside).cloned().or_else(|| w.primary_monitor().ok().flatten()) else { return };
	let Ok(size) = w.outer_size() else { return };
	let (p, s) = (m.position(), m.size());
	let x = p.x + (s.width as i32 - size.width as i32) / 2;
	let y = p.y + (s.height as i32 - size.height as i32) / 3;
	let _ = w.set_position(PhysicalPosition::new(x, y));
}

/// 주 창을 앞으로 가져온다. 트레이 아이콘 · 「docket 열기」 · 두 번째 실행이 부른다.
pub fn show_main(app: &AppHandle) {
	if let Some(w) = app.get_webview_window(MAIN) {
		let _ = w.show();
		let _ = w.unminimize();
		let _ = w.set_focus();
	}
}
