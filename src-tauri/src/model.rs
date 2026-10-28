//! 앱 데이터 모델. 전부 앱 데이터 폴더의 JSON 으로 저장되고, 프로젝트 폴더에는 아무것도 쓰지 않는다.

use serde::{Deserialize, Serialize};

pub fn now_ms() -> i64 {
	chrono::Utc::now().timestamp_millis()
}

pub fn short_id() -> String {
	uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

/* ---------- 설정 ---------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
	/// 비우면 PATH 와 npm 전역 폴더에서 찾는다
	pub claude_path: String,
	/// 비우면 CLI 기본 모델
	pub model: String,
	/// 새 메모에 자동 계획을 켤지
	pub auto_plan: bool,
	/// 메모를 마지막으로 고친 뒤 이만큼 지나면 계획을 시작한다. 쓰다 만 메모로 계획이 돌지 않게 하는 여유다.
	pub auto_plan_delay_sec: u64,
	/// 끄면 --strict-mcp-config 로 MCP 서버를 하나도 띄우지 않는다. 외부 문서 도구가 몰래 쓰이는 것을 막는다.
	pub use_mcp: bool,
	/// system · dark · light
	pub theme: String,
	/// 켠 플러그인의 id. 정의는 plugins/*.json 에 있고, 켜고 끄는 것만 여기 둔다. 사용자가 쓴 정의 파일을 앱이 고쳐 쓰지 않게 하려는 것이다.
	pub enabled_plugins: Vec<String>,
}

impl Default for Settings {
	fn default() -> Self {
		Self {
			claude_path: String::new(),
			model: String::new(),
			auto_plan: true,
			auto_plan_delay_sec: 60,
			use_mcp: false,
			theme: "dark".into(),
			enabled_plugins: Vec::new(),
		}
	}
}

/* ---------- 프로젝트 ---------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Project {
	pub id: String,
	pub name: String,
	pub path: String,
	pub created_at: i64,
	pub next_number: u32,
	/// 비우면 전역 설정을 따른다
	pub model: String,
	/// acceptEdits: 편집만 자동 승인하고 명령은 allowed_tools 에 있는 것만 · bypassPermissions: 명령 · 웹 · 스킬까지 모두 허용.
	/// 이름은 옛 값 그대로지만 2026-10-28 부터 「모두 허용」도 --dangerously-skip-permissions 를 쓰지 않는다. 거부 목록이 늘 앞선다.
	pub impl_mode: String,
	/// 구현 때 묻지 않고 허용할 도구 · 명령 (예: Bash(npm test:*))
	pub allowed_tools: Vec<String>,
	/// 어떤 실행에서도 막을 도구 · 명령 · 경로 (예: Bash(git push:*), Edit(config/**)). 허용보다 앞선다.
	pub denied_tools: Vec<String>,
	/// 계획 · 읽기 대화에서 git · svn 의 조회 명령(log · diff · status …)을 쓰게 한다. 이력을 근거로 계획하게 하려는 것이다.
	pub plan_vcs_read: bool,
	/// 산출물 파일을 둘 폴더. 비우면 앱 데이터 폴더에 둔다. 사용자가 고른 폴더라 프로젝트 안이어도 쓴다.
	pub deliverables_dir: String,
	/// 산출물 파일 이름 기본 규칙. 비우면 naming::DEFAULT
	pub naming: String,
	/// 이름의 빈칸을 _ 로 바꾼다
	pub naming_underscore: bool,
	/// 새 판이 생기면 지난 판 파일을 옮길 하위 폴더 (예: 이전판). 비우면 옮기지 않는다.
	pub archive_dir: String,
}

impl Default for Project {
	fn default() -> Self {
		Self {
			id: String::new(),
			name: String::new(),
			path: String::new(),
			created_at: 0,
			next_number: 1,
			model: String::new(),
			impl_mode: "acceptEdits".into(),
			allowed_tools: Vec::new(),
			denied_tools: DEFAULT_DENY.iter().map(|s| s.to_string()).collect(),
			plan_vcs_read: true,
			deliverables_dir: String::new(),
			naming: String::new(),
			naming_underscore: true,
			archive_dir: String::new(),
		}
	}
}

/// 새 프로젝트와, 이 칸이 생기기 전에 등록한 프로젝트의 거부 목록. 프롬프트로도 금하지만 권한으로 한 번 더 막는다.
pub const DEFAULT_DENY: &[&str] = &[
	"Bash(git push:*)",
	"Bash(git commit:*)",
	"Bash(git reset --hard:*)",
	"Bash(git clean:*)",
	"Bash(rm -rf:*)",
	"Bash(svn commit:*)",
	"Bash(svn ci:*)",
	"Bash(svn revert:*)",
];

/* ---------- 이슈 ---------- */

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Status {
	#[default]
	Inbox,
	Planning,
	Planned,
	Implementing,
	Review,
	Done,
	Dropped,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RunKind {
	Plan,
	Implement,
	Document,
	/// 이슈 세션에 질문 하나를 이어 붙인다. 이슈의 단계는 바꾸지 않는다.
	Chat,
	/// 이 이슈에서 바꾼 것을 Claude 에게 거꾸로 되돌리게 한다.
	Revert,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
	Queued,
	Running,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunState {
	pub kind: RunKind,
	pub phase: Phase,
	pub run_id: String,
	pub queued_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanFile {
	pub path: String,
	pub change: String,
}

/// 계획의 한 단계. 화면은 이것을 순서대로 세워 보여 준다. 없으면(옛 계획) plan 마크다운만 보인다.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanStep {
	pub title: String,
	pub detail: String,
	pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct QuestionOption {
	pub label: String,
	pub description: String,
	pub recommended: bool,
}

/// Claude 가 사용자에게 묻는 것. 선택지를 주면 화면이 고르게 하고, 없으면 글로 답하게 한다.
/// 2026-10-28 전의 계획은 질문이 문자열 하나였다. 그것도 읽혀야 옛 이슈가 열린다.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default, from = "QuestionIn")]
pub struct Question {
	pub header: String,
	pub question: String,
	pub options: Vec<QuestionOption>,
	pub multi: bool,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum QuestionIn {
	Text(String),
	Full {
		#[serde(default)]
		header: String,
		#[serde(default)]
		question: String,
		#[serde(default)]
		options: Vec<QuestionOption>,
		#[serde(default)]
		multi: bool,
	},
}

impl From<QuestionIn> for Question {
	fn from(q: QuestionIn) -> Self {
		match q {
			QuestionIn::Text(question) => Question { question, ..Default::default() },
			QuestionIn::Full { header, question, options, multi } => Question { header, question, options, multi },
		}
	}
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Plan {
	pub title: String,
	pub summary: String,
	pub plan: String,
	pub steps: Vec<PlanStep>,
	pub files: Vec<PlanFile>,
	pub risks: Vec<String>,
	pub questions: Vec<Question>,
	pub created_at: i64,
	pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Changed {
	pub path: String,
	pub what: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ImplResult {
	pub summary: String,
	pub changed: Vec<Changed>,
	pub verification: String,
	pub followups: Vec<String>,
	/// 화면이 바뀐 구현에서 Claude 가 찍은 결과 화면. path 는 이슈 폴더 기준(`shots/<실행>/<이름>`)이다.
	pub screenshots: Vec<Shot>,
	pub created_at: i64,
	pub run_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Shot {
	pub path: String,
	pub caption: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Hunk {
	pub old_start: u32,
	pub old_lines: u32,
	pub new_start: u32,
	pub new_lines: u32,
	pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct FileChange {
	pub path: String,
	pub rel: String,
	/// edit · create · update
	pub kind: String,
	pub hunks: Vec<Hunk>,
	pub run_id: String,
	pub at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct HistoryEntry {
	pub at: i64,
	/// created · plan · planned · approve · implemented · rework · chat · session · revert · reverted · done · drop · reopen · stop · error
	pub kind: String,
	pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RunRecord {
	pub id: String,
	pub kind: String,
	pub started_at: i64,
	pub ended_at: i64,
	/// running · ok · error · stopped
	pub status: String,
	pub cost_usd: f64,
	pub duration_ms: u64,
	pub num_turns: u32,
	pub model: String,
	pub error: String,
	/// 대화 실행에서 사용자가 보낸 글. stream-json 은 표준 입력으로 넣은 글을 되돌려 주지 않아 따로 남긴다.
	pub prompt: String,
	/// 대화에 함께 보낸 첨부 이름(이슈의 attachments/ 안). 말풍선에 그림을 다시 보이려고 남긴다.
	pub images: Vec<String>,
	/// 이 실행이 돈 권한. 나중에 「그때 무엇이 열려 있었나」를 설정이 바뀐 뒤에도 알 수 있게 실행마다 남긴다.
	pub mode: String,
	pub allowed: Vec<String>,
	pub denied_rules: Vec<String>,
	/// Claude 가 실행하려 한 명령(Bash · PowerShell). 막힌 것도 들어 있다.
	pub commands: Vec<String>,
	pub denials: Vec<Denial>,
}

/// 권한 때문에 막힌 도구 호출 한 건.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Denial {
	pub tool: String,
	/// 명령이면 명령 글, 파일 도구면 경로
	pub target: String,
	/// rule: 거부 규칙에 걸림 · ask: 허용 목록에 없어 물어야 했으나 물을 곳이 없어 거부됨
	pub reason: String,
	/// 허용 목록에 넣으면 다음부터 통과할 규칙 후보
	pub suggest: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Issue {
	pub id: String,
	pub project_id: String,
	pub number: u32,
	pub status: Status,
	pub auto_plan: bool,
	pub title: String,
	pub created_at: i64,
	pub updated_at: i64,
	pub note_updated_at: i64,
	pub plan: Option<Plan>,
	pub result: Option<ImplResult>,
	pub changes: Vec<FileChange>,
	/// 계획과 구현을 한 Claude 세션으로 잇는다. 구현이 계획 때 읽은 코드를 다시 읽지 않게 한다.
	pub session_id: String,
	pub run: Option<RunState>,
	pub runs: Vec<RunRecord>,
	pub history: Vec<HistoryEntry>,
	pub error: String,
}

impl Issue {
	pub fn log(&mut self, kind: &str, text: impl Into<String>) {
		self.history.push(HistoryEntry { at: now_ms(), kind: kind.into(), text: text.into() });
	}
}

/// 화면에 보내는 이슈. 본문 · 첨부 · 폴더 경로를 함께 싣는다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueView {
	#[serde(flatten)]
	pub issue: Issue,
	pub note: String,
	pub attachments: Vec<String>,
	pub dir: String,
}

/* ---------- 산출물 ---------- */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Version {
	pub n: u32,
	pub file: String,
	pub added_at: i64,
	pub note: String,
	pub size: u64,
	/// import · editor · claude · issue
	pub source: String,
	/// 파일의 절대 경로. 비어 있으면 옛 자리(앱 데이터의 v<n>/<file>)다.
	pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocJob {
	pub run_id: String,
	pub phase: Phase,
	pub request: String,
	pub queued_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Deliverable {
	pub id: String,
	pub project_id: String,
	pub title: String,
	pub note: String,
	pub issue_id: String,
	pub created_at: i64,
	pub updated_at: i64,
	pub versions: Vec<Version>,
	pub job: Option<DocJob>,
	pub error: String,
	pub runs: Vec<RunRecord>,
	/// 작성 지침. Claude 에게 쓰게 할 때마다 함께 넘긴다.
	pub guide: String,
	/// 파일 이름 규칙. 비우면 프로젝트 기본 규칙
	pub naming: String,
	/// 프로젝트 산출물 폴더 안의 하위 폴더
	pub subdir: String,
	/// md: 마크다운으로 받아 앱이 저장 · file: Claude 가 템플릿 형식대로 파일을 만든다
	pub mode: String,
}

/// 템플릿 · 참고 자료 한 건. kind 는 extract::kind 의 값이다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefFile {
	pub name: String,
	pub size: u64,
	pub kind: String,
	/// 글자를 뽑아 둔 파일. 뽑지 못했으면 비어 있다.
	pub text_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliverableView {
	#[serde(flatten)]
	pub deliverable: Deliverable,
	pub dir: String,
	pub refs: Vec<RefFile>,
	/// 새 판이 놓일 폴더
	pub output_dir: String,
	/// 마크다운으로 받을 때 다음 판의 파일 이름
	pub next_name: String,
}
