//! 속도를 잴 때만 켜는 계측. 환경 변수 DOCKET_PERF 를 0 이 아닌 값으로 두고 앱을 켜면 명령마다 걸린 시간을 stderr 에 남긴다.
//! 꺼져 있으면 시각도 읽지 않는다. 화면 쪽 계측(api.ts)도 perf_enabled 로 이 값을 따른다.

use std::sync::OnceLock;
use std::time::Instant;

use serde::Serialize;

pub fn on() -> bool {
	static ON: OnceLock<bool> = OnceLock::new();
	*ON.get_or_init(|| std::env::var("DOCKET_PERF").is_ok_and(|v| !v.trim().is_empty() && v.trim() != "0"))
}

pub fn log(line: std::fmt::Arguments) {
	if on() {
		eprintln!("[perf] {line}");
	}
}

/// 명령 하나를 잰다. 걸린 시간과 화면으로 보낼 JSON 크기를 남긴다 — 크기가 IPC 로 건너가는 비용이다.
pub fn command<T: Serialize, E>(name: &str, key: &str, f: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
	if !on() {
		return f();
	}
	let t = Instant::now();
	let out = f();
	let ms = t.elapsed().as_secs_f64() * 1000.0;
	match &out {
		Ok(v) => {
			let bytes = serde_json::to_vec(v).map(|b| b.len()).unwrap_or(0);
			eprintln!("[perf] {name}({key}) {ms:.1}ms {bytes}B");
		}
		Err(_) => eprintln!("[perf] {name}({key}) {ms:.1}ms 실패"),
	}
	out
}
