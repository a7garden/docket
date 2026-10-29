//! Claude 구독 사용률(5시간 · 7일 창)을 받아 두고 제목 줄에 알린다.
//!
//! claude 는 stream-json 에 `rate_limit_event` 줄을 실행마다 몇 번씩 섞어 보낸다. 앱은 이것을 따로 묻지 않고
//! 모든 실행(계획 · 구현 · 대화 · 제목 짓기 · 색인 카드)이 지나는 runner::exec 의 줄 읽기에서 주워 담는다.
//! 그래서 값은 「마지막으로 claude 를 돌린 때」의 것이다 — 화면이 받은 시각을 함께 보인다.
//!
//! 문서에 없는 출력이라 형식이 바뀔 수 있다. 꺼내지 못하면 조용히 건너뛰고 실행은 그대로 간다.
//! 마지막 값은 usage.json 에 남겨, 앱을 켜고 첫 실행이 돌기 전에도 보인다.
//!
//! 사용률만으로는 무엇이 많이 썼는지 모른다. 그래서 같은 자리(exec)에서 호출마다 토큰 · 비용을 spend.jsonl 장부에
//! 한 줄씩 덧붙인다. 제목 짓기 · 색인 카드 같은 짧은 호출은 이슈 실행 기록이 없어, 이 장부가 아니면 셀 길이 없다.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::model::{Tokens, now_ms};
use crate::store::write_atomic;

/// 장부를 이만큼만 남긴다. 화면은 7일을 보이고, 그보다 오래된 줄은 앱을 켤 때 걷어 낸다.
const KEEP_DAYS: i64 = 90;

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

/// 장부 한 줄 — claude 호출 하나.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SpendLine {
	pub at: i64,
	/// 프로젝트 id. 앱 전체의 호출이면 비어 있다.
	pub project: String,
	/// plan · implement · revert · chat · document · title · card · rerank · judge · learn
	pub kind: String,
	pub model: String,
	pub tokens: Tokens,
	/// claude 가 낸 total_cost_usd. API 요금으로 어림한 값이라 구독 청구액과 다르다.
	pub cost_usd: f64,
}

/// 화면에 보이는 묶음 하나.
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SpendRow {
	/// plan · implement · chat · document · quick
	pub group: String,
	pub calls: u32,
	pub tokens: Tokens,
	pub cost_usd: f64,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Spend {
	pub days: u32,
	pub rows: Vec<SpendRow>,
	pub total: SpendRow,
}

struct State {
	app: AppHandle,
	path: PathBuf,
	last: Mutex<Option<Usage>>,
	spend_path: PathBuf,
	/// 실행 여럿이 함께 덧붙인다. 한 줄이 다른 줄과 섞이지 않게 쓰는 동안 잡는다.
	spend_lock: Mutex<()>,
}

static STATE: OnceLock<State> = OnceLock::new();

/// 앱을 켤 때 한 번 부른다. 부르지 않으면(cargo test 의 exec) record · spend 는 아무것도 하지 않는다.
pub fn init(app: AppHandle, root: &Path) {
	let path = root.join("usage.json");
	let last = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Usage>(&b).ok());
	let spend_path = root.join("spend.jsonl");
	prune(&spend_path, now_ms() - KEEP_DAYS * 86_400_000);
	let _ = STATE.set(State { app, path, last: Mutex::new(last), spend_path, spend_lock: Mutex::new(()) });
}

/// 오래된 줄 · 깨진 줄을 걷어 낸다. 걷을 것이 없으면 파일을 건드리지 않는다.
fn prune(path: &Path, cutoff: i64) {
	let Ok(text) = std::fs::read_to_string(path) else { return };
	let keep: Vec<&str> = text.lines().filter(|l| serde_json::from_str::<SpendLine>(l).is_ok_and(|s| s.at >= cutoff)).collect();
	if keep.len() == text.lines().count() {
		return;
	}
	let mut out = keep.join("\n");
	if !out.is_empty() {
		out.push('\n');
	}
	let _ = write_atomic(path, out.as_bytes());
}

/// 호출 하나가 끝나 result 줄을 받았을 때 부른다. 쓰지 못해도 실행은 그대로 간다.
pub fn spend(project: &str, kind: &str, model: &str, result: &Value) {
	let Some(state) = STATE.get() else { return };
	let line = SpendLine {
		at: now_ms(),
		project: project.to_string(),
		kind: kind.to_string(),
		model: model.to_string(),
		tokens: Tokens::from_result(result),
		cost_usd: result.get("total_cost_usd").and_then(|x| x.as_f64()).unwrap_or(0.0),
	};
	let Ok(mut s) = serde_json::to_string(&line) else { return };
	s.push('\n');
	let Ok(_guard) = state.spend_lock.lock() else { return };
	if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&state.spend_path) {
		let _ = f.write_all(s.as_bytes());
	}
}

/// 실행 종류를 화면의 묶음으로 모은다. 되돌리기는 구현과 같은 권한 · 모델로 돌아 함께 센다.
fn group_of(kind: &str) -> &'static str {
	match kind {
		"plan" => "plan",
		"implement" | "revert" => "implement",
		"chat" => "chat",
		"document" => "document",
		_ => "quick",
	}
}

const GROUPS: &[&str] = &["plan", "implement", "chat", "document", "quick"];

fn summarize(lines: impl Iterator<Item = SpendLine>, since: i64, days: u32) -> Spend {
	let mut rows: Vec<SpendRow> = GROUPS.iter().map(|g| SpendRow { group: g.to_string(), ..Default::default() }).collect();
	let mut total = SpendRow { group: "total".into(), ..Default::default() };
	for l in lines.filter(|l| l.at >= since) {
		let g = group_of(&l.kind);
		for r in rows.iter_mut().filter(|r| r.group == g).chain(std::iter::once(&mut total)) {
			r.calls += 1;
			r.tokens.add(&l.tokens);
			r.cost_usd += l.cost_usd;
		}
	}
	rows.retain(|r| r.calls > 0);
	Spend { days, rows, total }
}

/// 최근 days 일의 장부를 묶음별로 더한다. 장부가 없으면 빈 묶음이다.
pub fn spend_summary(days: u32) -> Spend {
	let since = now_ms() - days as i64 * 86_400_000;
	let text = STATE.get().and_then(|s| std::fs::read_to_string(&s.spend_path).ok()).unwrap_or_default();
	summarize(text.lines().filter_map(|l| serde_json::from_str::<SpendLine>(l).ok()), since, days)
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
		spend("p", "title", "haiku", &serde_json::json!({ "usage": { "input_tokens": 1 } }));
	}

	/// 장부 묶기: 되돌리기는 구현에, 짧은 호출은 한 묶음에 들고, 기간 밖 줄은 빠지고, 빈 묶음은 보이지 않는다.
	#[test]
	fn spend_groups_kinds_and_skips_old_lines() {
		// 실제 제목 짓기 result 줄에서 옮긴 usage.
		let r = serde_json::json!({ "total_cost_usd": 0.0019, "usage": { "input_tokens": 2, "cache_creation_input_tokens": 9619, "cache_read_input_tokens": 0, "output_tokens": 16 } });
		let t = Tokens::from_result(&r);
		assert_eq!(t, Tokens { input: 2, output: 16, cache_create: 9619, cache_read: 0 });
		assert_eq!(Tokens::from_result(&serde_json::json!({})), Tokens::default());
		let line = |at: i64, kind: &str| SpendLine { at, kind: kind.into(), tokens: t, cost_usd: 0.5, ..Default::default() };
		let s = summarize(vec![line(10, "implement"), line(11, "revert"), line(12, "title"), line(13, "card"), line(1, "plan")].into_iter(), 5, 7);
		assert_eq!(s.rows.iter().map(|r| (r.group.as_str(), r.calls)).collect::<Vec<_>>(), vec![("implement", 2), ("quick", 2)]);
		assert_eq!(s.total.calls, 4);
		assert_eq!(s.total.tokens.cache_create, 4 * 9619);
		assert!((s.total.cost_usd - 2.0).abs() < 1e-9);
	}

	#[test]
	fn prune_drops_old_and_broken_lines() {
		let dir = std::env::temp_dir().join(format!("docket-spend-{}", std::process::id()));
		let _ = std::fs::create_dir_all(&dir);
		let path = dir.join("spend.jsonl");
		let keep = serde_json::to_string(&SpendLine { at: 100, kind: "plan".into(), ..Default::default() }).unwrap();
		let old = serde_json::to_string(&SpendLine { at: 1, kind: "plan".into(), ..Default::default() }).unwrap();
		std::fs::write(&path, format!("{old}\n{{깨진 줄\n{keep}\n")).unwrap();
		prune(&path, 50);
		assert_eq!(std::fs::read_to_string(&path).unwrap(), format!("{keep}\n"));
		let _ = std::fs::remove_dir_all(&dir);
	}
}
