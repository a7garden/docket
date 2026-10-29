//! wasm 플러그인을 Extism 샌드박스에서 돌린다.
//!
//! - 밖으로 나가는 길은 넘겨준 호스트 함수(api.rs, 허락한 권한만)와 허락한 호스트로 가는 HTTP 뿐이다.
//!   WASI 는 켜되 폴더 · 환경 변수 · 표준 출력을 하나도 주지 않는다. TS(Extism js-pdk)로 만든 플러그인이 WASI 를 요구한다.
//! - 허락하지 않은 호스트 함수를 가져다 쓰는 플러그인은 띄우는 단계에서 「모르는 가져오기」로 실패한다.
//! - 컴파일한 것은 파일 시각 · 허락한 권한으로 묶어 둔다. 부를 때마다 새 인스턴스를 만들어, 한 번 부른 상태가 다음 부름에 남지 않는다.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use extism::{CompiledPlugin, Function, Manifest, Plugin, PluginBuilder, Wasm};

/// 한 번 부르는 데 쓸 수 있는 시간. 호스트 함수(docket_run 등)를 기다린 시간도 들어간다.
/// 2026.10.29 : 10 → 30초. 구현이 끝난 뒤 시험을 돌리는 플러그인이 10초 안에 끝나지 않았다.
pub const CALL_LIMIT: Duration = Duration::from_secs(30);
/// 메모리 상한(64KiB 쪽 수). 1024 = 64MiB. js-pdk 의 QuickJS 가 넉넉히 돌고, 잘못 짠 플러그인이 앱 메모리를 다 쓰지는 못한다.
const MEMORY_PAGES: u32 = 1024;

struct Entry {
	key: String,
	compiled: Arc<CompiledPlugin>,
}

fn cache() -> &'static Mutex<HashMap<String, Entry>> {
	static CACHE: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
	CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Extism 의 오류를 사용자가 고칠 수 있는 말로 바꾼다.
fn explain(e: extism::Error, limit: Duration) -> String {
	let text = format!("{e:#}");
	if text.contains("unknown import") {
		let what = text.split("unknown import:").nth(1).unwrap_or("").trim().trim_matches('`').split_whitespace().next().unwrap_or("").to_string();
		return format!("허락받지 않은 기능을 부릅니다 ({what}) · 매니페스트의 permissions 에 적고 다시 허락받으세요");
	}
	if text.contains("timeout") || text.contains("interrupt") {
		return format!("{}초 안에 끝나지 않아 멈췄습니다", limit.as_secs());
	}
	text.chars().take(500).collect()
}

pub fn compile(wasm: Wasm, hosts: &[String], limit: Duration, functions: Vec<Function>) -> Result<CompiledPlugin, String> {
	let m = Manifest::new([wasm]).with_timeout(limit).with_memory_max(MEMORY_PAGES).with_allowed_hosts(hosts.iter().cloned());
	PluginBuilder::new(m).with_wasi(true).with_functions(functions).compile().map_err(|e| explain(e, limit))
}

/// 컴파일한 것에서 새 인스턴스를 띄워 `func` 를 부른다. 입력 · 출력은 JSON 글이다.
pub fn run(compiled: &CompiledPlugin, func: &str, input: &str, limit: Duration) -> Result<String, String> {
	let mut p = Plugin::new_from_compiled(compiled).map_err(|e| explain(e, limit))?;
	if !p.function_exists(func) {
		return Err(format!("{func} 함수를 내보내지 않습니다"));
	}
	p.call::<&str, String>(func, input).map_err(|e| explain(e, limit))
}

/// 플러그인 `id` 의 `path` 를 불러 `func` 를 부른다. `grants` 가 바뀌면 호스트 함수가 달라지므로 다시 컴파일한다.
pub fn call(id: &str, path: &Path, grants: &[String], hosts: &[String], functions: impl FnOnce() -> Vec<Function>, func: &str, input: &str) -> Result<String, String> {
	let modified = std::fs::metadata(path).and_then(|m| m.modified()).map_err(|e| format!("{} 을 읽지 못했습니다: {e}", path.display()))?;
	let key = format!("{}|{modified:?}|{}", path.display(), grants.join(","));
	let cached = cache().lock().ok().and_then(|c| c.get(id).filter(|e| e.key == key).map(|e| e.compiled.clone()));
	let compiled = match cached {
		Some(c) => c,
		None => {
			let c = Arc::new(compile(Wasm::file(path), hosts, CALL_LIMIT, functions())?);
			if let Ok(mut map) = cache().lock() {
				map.insert(id.to_string(), Entry { key, compiled: c.clone() });
			}
			c
		}
	};
	run(&compiled, func, input, CALL_LIMIT)
}

/// 지우거나 다시 설치한 플러그인의 컴파일 결과를 버린다.
pub fn forget(id: &str) {
	if let Ok(mut map) = cache().lock() {
		map.remove(id);
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// 입력을 그대로 출력으로 돌려주는 플러그인
	const ECHO: &str = r#"(module
		(import "extism:host/env" "input_offset" (func $input_offset (result i64)))
		(import "extism:host/env" "input_length" (func $input_length (result i64)))
		(import "extism:host/env" "output_set" (func $output_set (param i64 i64)))
		(func (export "on_command") (result i32)
			(call $output_set (call $input_offset) (call $input_length))
			(i32.const 0)))"#;

	fn wat(s: &str) -> Wasm {
		Wasm::data(wat::parse_str(s).unwrap())
	}

	#[test]
	fn echo_round_trips_json() {
		let c = compile(wat(ECHO), &[], Duration::from_secs(5), Vec::new()).unwrap();
		assert_eq!(run(&c, "on_command", r#"{"command":"open"}"#, Duration::from_secs(5)).unwrap(), r#"{"command":"open"}"#);
		assert!(run(&c, "on_event", "{}", Duration::from_secs(5)).unwrap_err().contains("on_event"));
	}

	#[test]
	fn host_function_without_permission_is_refused() {
		let c = compile(
			wat(r#"(module
				(import "extism:host/user" "docket_notify" (func $n (param i64) (result i64)))
				(func (export "on_event") (result i32) (i32.const 0)))"#),
			&[],
			Duration::from_secs(5),
			Vec::new(),
		);
		let err = c.and_then(|c| run(&c, "on_event", "{}", Duration::from_secs(5))).unwrap_err();
		assert!(err.contains("허락받지 않은 기능") && err.contains("docket_notify"), "{err}");
	}

	#[test]
	fn endless_loop_is_cut_off() {
		let c = compile(wat(r#"(module (func (export "on_event") (result i32) (loop br 0) (i32.const 0)))"#), &[], Duration::from_secs(1), Vec::new()).unwrap();
		let started = std::time::Instant::now();
		let err = run(&c, "on_event", "{}", Duration::from_secs(1)).unwrap_err();
		assert!(started.elapsed() < Duration::from_secs(10), "끊기지 않았다");
		assert!(err.contains("멈췄습니다"), "{err}");
	}
}
