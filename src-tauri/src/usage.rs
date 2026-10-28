//! Claude 구독 사용률(5시간 · 7일 창)을 받아 두고 제목 줄에 알린다.
//!
//! claude 는 stream-json 에 `rate_limit_event` 줄을 실행마다 몇 번씩 섞어 보낸다. 앱은 이것을 따로 묻지 않고
//! 모든 실행(계획 · 구현 · 대화 · 제목 짓기 · 색인 카드)이 지나는 runner::exec 의 줄 읽기에서 주워 담는다.
//! 그래서 값은 「마지막으로 claude 를 돌린 때」의 것이다 — 화면이 받은 시각을 함께 보인다.
//!
//! 문서에 없는 출력이라 형식이 바뀔 수 있다. 꺼내지 못하면 조용히 건너뛰고 실행은 그대로 간다.
//! 마지막 값은 usage.json 에 남겨, 앱을 켜고 첫 실행이 돌기 전에도 보인다.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::model::now_ms;
use crate::store::write_atomic;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct UsageWindow {
	/// claude 가 붙인 창 이름 그대로 — five_hour · seven_day · seven_day_opus …
	pub key: String,
	/// 쓴 비율 0~1.
	pub utilization: f64,
	/// 창이 다시 차는 시각(유닉스 초). 모르면 0.
	pub resets_at: i64,
	/// allowed · allowed_warning · rejected …
	pub status: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Usage {
	pub windows: Vec<UsageWindow>,
	/// 전체 판정. rejected 면 지금은 한도에 걸려 있다.
	pub status: String,
	/// 한도를 넘어 추가 사용분으로 돌고 있는지.
	pub overage: bool,
	/// 이 값을 받은 시각(ms).
	pub seen_at: i64,
}

struct State {
	app: AppHandle,
	path: PathBuf,
	last: Mutex<Option<Usage>>,
}

static STATE: OnceLock<State> = OnceLock::new();

/// 앱을 켤 때 한 번 부른다. 부르지 않으면(cargo test 의 exec) record 는 아무것도 하지 않는다.
pub fn init(app: AppHandle, root: &Path) {
	let path = root.join("usage.json");
	let last = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Usage>(&b).ok());
	let _ = STATE.set(State { app, path, last: Mutex::new(last) });
}

pub fn get() -> Option<Usage> {
	STATE.get().and_then(|s| s.last.lock().ok()?.clone())
}

/// `rate_limit_event` 줄 하나를 받는다. 값이 바뀌었을 때만 저장하고 알린다 — 같은 실행 안에서 같은 값이 되풀이해 온다.
pub fn record(v: &Value) {
	let Some(state) = STATE.get() else { return };
	let Some(mut u) = parse(v) else { return };
	{
		let Ok(mut last) = state.last.lock() else { return };
		if last.as_ref().is_some_and(|l| l.windows == u.windows && l.status == u.status && l.overage == u.overage) {
			return;
		}
		u.seen_at = now_ms();
		*last = Some(u.clone());
	}
	// 실행 여럿이 함께 부르므로 잠금을 푼 뒤에 쓰고 알린다.
	if let Ok(b) = serde_json::to_vec_pretty(&u) {
		let _ = write_atomic(&state.path, &b);
	}
	let _ = state.app.emit("docket://usage", &u);
}

/// rate_limit_info 에서 창별 사용률을 꺼낸다. 하나라도 빠진 창은 건너뛰고, 꺼낸 창이 없으면 None.
pub fn parse(v: &Value) -> Option<Usage> {
	let info = v.get("rate_limit_info")?;
	let mut windows: Vec<UsageWindow> = info
		.get("unifiedWindows")
		.and_then(|w| w.as_object())
		.map(|m| {
			m.iter()
				.filter_map(|(key, w)| {
					Some(UsageWindow {
						key: key.clone(),
						utilization: w.get("utilization")?.as_f64()?,
						resets_at: w.get("resetsAt").and_then(|x| x.as_i64()).unwrap_or(0),
						status: w.get("status").and_then(|x| x.as_str()).unwrap_or("").to_string(),
					})
				})
				.collect()
		})
		.unwrap_or_default();
	if windows.is_empty() {
		return None;
	}
	// 짧은 창이 앞에 오게 한다. 맵 순서는 claude 가 보낸 순서와 다를 수 있다.
	windows.sort_by_key(|w| (w.key != "five_hour", w.key.clone()));
	Some(Usage {
		windows,
		status: info.get("status").and_then(|x| x.as_str()).unwrap_or("").to_string(),
		overage: info.get("isUsingOverage").and_then(|x| x.as_bool()).unwrap_or(false),
		seen_at: 0,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_rate_limit_event() {
		// 실제 실행 기록에서 옮긴 줄.
		let line = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1793184600,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,"unifiedWindows":{"seven_day":{"utilization":0.32,"resetsAt":1793300400,"status":"allowed"},"five_hour":{"utilization":0.09,"resetsAt":1793184600,"status":"allowed"}}},"uuid":"24a38dea","session_id":"d8900c66"}"#;
		let u = parse(&serde_json::from_str(line).unwrap()).unwrap();
		assert_eq!(u.status, "allowed");
		assert!(!u.overage);
		assert_eq!(u.windows.len(), 2);
		assert_eq!(u.windows[0], UsageWindow { key: "five_hour".into(), utilization: 0.09, resets_at: 1793184600, status: "allowed".into() });
		assert_eq!(u.windows[1].key, "seven_day");
		assert_eq!(u.windows[1].utilization, 0.32);
	}

	#[test]
	fn skips_unknown_shapes() {
		assert!(parse(&serde_json::json!({ "type": "rate_limit_event" })).is_none());
		assert!(parse(&serde_json::json!({ "rate_limit_info": { "status": "allowed" } })).is_none());
		let u = parse(&serde_json::json!({ "rate_limit_info": { "unifiedWindows": { "five_hour": { "resetsAt": 1 }, "seven_day": { "utilization": 0.5 } } } })).unwrap();
		assert_eq!(u.windows.len(), 1);
		assert_eq!(u.windows[0].key, "seven_day");
	}

	#[test]
	fn record_without_init_is_quiet() {
		record(&serde_json::json!({ "rate_limit_info": { "unifiedWindows": { "five_hour": { "utilization": 0.1 } } } }));
	}
}
