//! 일반 대화 — 어느 프로젝트에도 묶이지 않은 대화. 터미널에서 아무 폴더에서나 연 claude 처럼 묻고 답한다.
//!
//! 2026.11.09 : 앱 데이터 폴더에서 이 앱(플러그인 · 설정 · 기록)을 다루던 「앱 대화」를 일반 대화로 바꿨다.
//! 사용자가 바란 것은 앱에 대한 질문이 아니라 경로에 매이지 않는 평범한 대화였다. 그래서 빈 작업 폴더(global/work/)에서 돌고,
//! 앱 데이터 안내 · 플러그인 문서 · 설정 백업을 싣지 않는다. 남는 것은 메모를 남길 보드를 고르는 데 필요한 프로젝트 이름뿐이다.

use crate::store::Store;

/// issue_prompt 가 남겨 두는 자리. 실행이 Store 를 들고 채운다 — 프롬프트 함수는 Store 를 모른다.
pub const CONTEXT_SLOT: &str = "<<등록한 프로젝트>>";

/// 메모 블록의 `@<프로젝트 이름>` 에 적을 수 있는 이름. 보관한 프로젝트는 등록되지 않으므로 뺀다(runner::register_memos).
pub fn context(store: &Store) -> String {
	let names: Vec<String> = store.active_projects().unwrap_or_default().into_iter().map(|p| format!("- {}", p.name)).collect();
	let list = if names.is_empty() { "- (등록한 프로젝트가 없다 — 메모를 남길 수 없다)".to_string() } else { names.join("\n") };
	format!("### 등록한 프로젝트\n{list}")
}
