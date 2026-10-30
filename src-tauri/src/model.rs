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
	/// 계획 · 구현 · 대화에 쓸 모델. 비우면 CLI 기본 모델이다. 메모에서 고른 모델이 이보다 앞선다.
	/// 산출물 작성은 메모가 없고 결과물을 만들어 쓰는 일이라 구현 모델을 쓴다.
	pub plan_model: String,
	pub impl_model: String,
	pub chat_model: String,
	/// 계획 · 구현 · 대화의 effort(low · medium · high · xhigh · max). 비우면 --effort 를 넘기지 않아 CLI 기본값으로 돈다.
	/// 메모에서 고른 effort 가 이보다 앞서고, 산출물 작성 · 되돌리기는 모델과 같이 구현 effort 를 쓴다.
	pub plan_effort: String,
	pub impl_effort: String,
	pub chat_effort: String,
	/// 2026-10-28 전에는 모델이 하나였다. 읽기만 하고 Store::settings 가 세 칸으로 옮긴다. 쓰던 모델을 잃지 않게 하려는 것이다.
	#[serde(rename = "model", skip_serializing)]
	pub legacy_model: String,
	/// 새 메모에 자동 계획을 켤지
	pub auto_plan: bool,
	/// 메모를 마지막으로 고친 뒤 이만큼 지나면 계획을 시작한다. 쓰다 만 메모로 계획이 돌지 않게 하는 여유다.
	pub auto_plan_delay_sec: u64,
	/// 새 메모의 제목을 지을 모델. 계획 · 구현 모델과 따로 둬 제목에 비싼 모델이 쓰이지 않게 한다. 비우면 첫 줄을 제목으로 쓴다.
	pub title_model: String,
	/// 메모를 마지막으로 고친 뒤 이만큼 지나야 제목을 짓는다. 쓰는 도중에 부르지 않게 하는 여유다.
	pub title_delay_sec: u64,
	/// 끄면 --strict-mcp-config 로 MCP 서버를 하나도 띄우지 않는다. 외부 문서 도구가 몰래 쓰이는 것을 막는다.
	pub use_mcp: bool,
	/// system · dark · light
	pub theme: String,
	/// 켠 플러그인의 id. 정의는 plugins/ 에 있고, 켜고 끄는 것만 여기 둔다. 사용자가 쓴 정의 파일을 앱이 고쳐 쓰지 않게 하려는 것이다.
	pub enabled_plugins: Vec<String>,
	/// 플러그인마다 사용자가 허락한 권한. 매니페스트의 권한이 이보다 넓으면 다시 허락받기 전에는 부르지 않는다 (plugin_host).
	pub plugin_grants: std::collections::BTreeMap<String, Vec<String>>,
	/// 지식베이스의 색인 카드 · 고르기 다듬기 · 자동 갱신 판정에 쓸 모델. 비우면 제목 모델, 그것도 비면 haiku 다.
	/// 파일마다 부르는 호출이라 가벼운 모델을 둔다.
	pub kb_card_model: String,
	/// 대화 · 다시 계획 · 수정 요청 입력칸의 보내기 키. ctrlEnter · enter.
	/// 기본을 Ctrl+Enter 로 둔다. 여러 줄 지시를 쓰다 Enter 한 번에 반쯤 쓴 글이 나가지 않게 하려는 것이다.
	pub send_key: String,
	/// 산출물에 파일을 넣거나 새 산출물을 등록하면 작성법 · 어휘 · 형식 · 템플릿 · 이름 규칙을 뽑는다 (recipe.rs).
	/// 구현 모델로 돌아 비용이 들지만, 손으로 채우지 않아도 다음 판부터 같은 꼴로 쓰게 하려고 켜 둔다.
	pub recipe_auto: bool,
	/// 켤 때와 켜 둔 동안 정해진 간격마다 새 판을 확인한다 (src/lib/updater.ts). 알리기만 하고 설치는 사용자가 고른다.
	pub auto_update_check: bool,
	/// 파일 산출물에서 한컴오피스로 한글 문서를 확인한다(열기 검사 · 정확한 쪽 수 · hwp 변환). 실행마다 DOCKET_HANCOM 으로 넘긴다.
	/// 기본은 끔이다 — 한컴 자동화 보안 모듈이 없으면 띄울 때마다 접근 확인 창이 뜬다. 끄면 rhwp 로 그리고 읽어 본다.
	pub hancom_check: bool,
}

impl Default for Settings {
	fn default() -> Self {
		Self {
			claude_path: String::new(),
			plan_model: String::new(),
			impl_model: String::new(),
			chat_model: String::new(),
			plan_effort: String::new(),
			impl_effort: String::new(),
			chat_effort: String::new(),
			legacy_model: String::new(),
			auto_plan: true,
			auto_plan_delay_sec: 60,
			title_model: "haiku".into(),
			title_delay_sec: 5,
			use_mcp: false,
			theme: "dark".into(),
			enabled_plugins: Vec::new(),
			plugin_grants: Default::default(),
			kb_card_model: String::new(),
			send_key: "ctrlEnter".into(),
			recipe_auto: true,
			auto_update_check: true,
			hancom_check: false,
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
	/// acceptEdits: 편집만 자동 승인하고 명령은 allowed_tools 에 있는 것만 · bypassPermissions: 명령 · 웹 · 스킬까지 모두 허용.
	/// 이름은 옛 값 그대로지만 2026-10-28 부터 「모두 허용」도 --dangerously-skip-permissions 를 쓰지 않는다. 거부 목록이 늘 앞선다.
	pub impl_mode: String,
	/// 구현 때 묻지 않고 허용할 도구 · 명령 (예: Bash(npm test:*))
	pub allowed_tools: Vec<String>,
	/// 어떤 실행에서도 막을 도구 · 명령 · 경로 (예: Bash(git push:*), Edit(config/**)). 허용보다 앞선다.
	pub denied_tools: Vec<String>,
	/// 계획 · 읽기 대화에서 git · svn 의 조회 명령(log · diff · status …)을 쓰게 한다. 이력을 근거로 계획하게 하려는 것이다.
	pub plan_vcs_read: bool,
	/// 계획에 적힌 파일이 겹치지 않는 구현 · 수정 요청 · 되돌리기를 함께 돌린다. 끄면 모두 한 줄로 선다.
	/// 2026.10.29 : 기본 켜짐. 판정이 애매하면(폴더 · 와일드카드 · 빈 목록 · 「모두 허용」) 어차피 한 줄로 서므로 켜 둔다.
	pub parallel_impl: bool,
	/// 줄을 서야 할 구현을 기다리게 하지 않고 git 워크트리에서 돌린다(worktree.rs). parallel_impl 을 켰을 때만 먹는다.
	/// 2026.10.29 : 기본 꺼짐. 저장소가 크면 워크트리를 만드는 것 자체가 무거워서 프로젝트마다 고른다.
	pub worktree: bool,
	/// 산출물 파일을 둘 폴더. 비우면 앱 데이터 폴더에 둔다. 사용자가 고른 폴더라 프로젝트 안이어도 쓴다.
	/// 산출물 네 칸(deliverables_dir · naming · naming_underscore · archive_dir)은 산출물 화면의 설정 창이 save_deliverable_settings 로만 바꾼다.
	/// save_project 는 덮지 않는다 — 프로젝트 설정 창이 들고 있던 옛 값으로 산출물 설정을 지우지 않게 한다.
	pub deliverables_dir: String,
	/// 산출물 파일 이름 기본 규칙. 비우면 naming::DEFAULT
	pub naming: String,
	/// 이름의 빈칸을 _ 로 바꾼다
	pub naming_underscore: bool,
	/// 새 판이 생기면 지난 판 파일을 옮길 하위 폴더 (예: 이전판). 비우면 옮기지 않는다.
	pub archive_dir: String,
	/// 지식베이스. save_project 는 이 칸을 덮지 않는다 — 설정 화면이 들고 있던 옛 값으로 지식베이스 화면의 변경을 지우지 않게 한다.
	pub kb: ProjectKb,
	/// 어휘 사전 설정. 용어 목록은 projects/<pid>/glossary.json 에 따로 둔다. save_project 는 kb 처럼 이 칸도 덮지 않는다.
	pub glossary: ProjectGlossary,
}

/// 산출물 설정 창이 넘기는 값. 뜻은 Project 의 같은 이름 칸과 같다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeliverableSettings {
	pub deliverables_dir: String,
	pub naming: String,
	pub naming_underscore: bool,
	pub archive_dir: String,
}

impl Default for DeliverableSettings {
	fn default() -> Self {
		Self { deliverables_dir: String::new(), naming: String::new(), naming_underscore: true, archive_dir: String::new() }
	}
}

/// 프로젝트 어휘 사전 설정. 끈 채로 시작한다. Claude 를 부르지 않아 비용은 없지만 프롬프트가 길어진다.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectGlossary {
	pub enabled: bool,
	/// 함께 쓸 다른 프로젝트의 id. 복사하지 않고 실행 때마다 그 사전을 읽는다 — 그쪽에서 고친 것이 바로 반영된다.
	pub include: Vec<String>,
}

/// 어휘 사전의 용어 하나.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GlossaryEntry {
	pub term: String,
	pub meaning: String,
	/// 같은 뜻으로 쓰는 다른 말. 지식베이스 찾기에도 덧붙인다.
	pub aliases: Vec<String>,
}

/// glossary.json 의 모양. updated_at 으로 다른 화면이 먼저 저장했는지 가린다.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GlossaryFile {
	pub updated_at: i64,
	pub entries: Vec<GlossaryEntry>,
}

/// 프로젝트 지식베이스 설정. 끈 채로 시작한다 — 카드를 만들 때 문서를 Claude 에 보내고 호출 비용이 들어서다.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectKb {
	pub enabled: bool,
	/// 복사하지 않고 그 자리를 훑는 폴더(전체 경로). 끌어 놓은 파일은 앱 데이터의 kb/inbox/ 에 들어가 여기 적지 않는다.
	pub folders: Vec<String>,
	/// 산출물의 최신 판도 넣는다. 지난 판은 넣지 않는다 — 낡은 문구가 함께 찾아진다.
	pub include_deliverables: bool,
	/// 프롬프트에 붙일 구획 수
	pub top_k: u32,
	/// 로컬로 고른 후보를 Claude 에 한 번 더 넘겨 다시 고른다. 실행마다 호출이 하나 붙는다.
	pub rerank: bool,
	/// 넣지 않을 것. 전체 경로면 그 파일 · 폴더 아래 전부, 아니면 참조 폴더 · 넣은 자료 안의 폴더 · 파일 이름에 그 말이 든 것(「이전판」).
	/// 낡은 문서가 근거로 붙지 않게 사람이 정하는 목록이다. 비어 있으면 모두 넣는다.
	pub exclude: Vec<String>,
	/// 판 묶기에서 옛 판으로 빠졌지만 사람이 「다시 넣기」로 되살린 파일(전체 경로)
	pub keep: Vec<String>,
}

impl Default for ProjectKb {
	fn default() -> Self {
		Self { enabled: false, folders: Vec::new(), include_deliverables: true, top_k: 8, rerank: false, exclude: Vec::new(), keep: Vec::new() }
	}
}

/// 지식베이스에서 찾아 붙인 구획 하나. 실행 기록에는 excerpt 를 비워 남긴다(issue.json 이 커지지 않게).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct KbHit {
	/// 원본 파일
	pub path: String,
	/// 뽑아 둔 글자 사본. Claude 는 이것을 Read 로 연다.
	pub text_path: String,
	/// folder · inbox · deliverable
	pub source: String,
	/// 산출물이면 그 제목
	pub label: String,
	pub section: String,
	/// 카드 요약. 카드가 없으면 비어 있다.
	pub why: String,
	pub excerpt: String,
	pub score: f64,
}

impl Default for Project {
	fn default() -> Self {
		Self {
			id: String::new(),
			name: String::new(),
			path: String::new(),
			created_at: 0,
			next_number: 1,
			impl_mode: "acceptEdits".into(),
			allowed_tools: Vec::new(),
			denied_tools: DEFAULT_DENY.iter().map(|s| s.to_string()).collect(),
			plan_vcs_read: true,
			parallel_impl: true,
			worktree: false,
			deliverables_dir: String::new(),
			naming: String::new(),
			naming_underscore: true,
			archive_dir: String::new(),
			kb: ProjectKb::default(),
			glossary: ProjectGlossary::default(),
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

/// 이슈 제목을 정하는 방식.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum TitleMode {
	/// 메모 첫 줄. 옛 이슈와 제목 모델을 끈 때다.
	#[default]
	FirstLine,
	/// 제목 모델이 메모를 읽고 짓는다. 지어 오기 전에는 첫 줄을 임시로 쓴다.
	Auto,
	/// 사용자가 손으로 고쳤다. 메모를 바꿔도 덮지 않는다.
	Manual,
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

/// 기본값은 Running 이다. 단계 칸이 없던 때 저장한 작성법 뽑기는 늘 돌고 있었다.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
	Queued,
	#[default]
	Running,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunState {
	pub kind: RunKind,
	pub phase: Phase,
	pub run_id: String,
	pub queued_at: i64,
	/// 줄에서 무엇을 기다리는지 (예: 「파일이 겹쳐 기다림 · #12 · src/App.tsx」). 비면 화면이 기본 문구를 보인다.
	#[serde(default)]
	pub wait_for: String,
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
	/// created · plan · planned · approve · implemented · rework · chat · session · revert · reverted · done · drop · reopen · stop · error · memo
	/// memo 는 프로젝트 대화가 보드에 메모를 등록했을 때다. text 는 `#번호 제목`, 등록에 실패했으면 `실패 · 까닭` 이다.
	/// deliverable 은 완료한 뒤 자동 갱신이 산출물을 고친 결과다. text 는 `제목 · v판 갱신` · `제목 · 건너뜀 · 까닭` · `판정 · …` 이다.
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
	/// result 줄의 usage. 이 기능 전의 기록은 0 이다.
	pub tokens: Tokens,
	pub duration_ms: u64,
	pub num_turns: u32,
	pub model: String,
	/// 이 실행에 넘긴 --effort. 비면 CLI 기본값으로 돌았다. 설정을 바꾼 뒤에도 그때 값을 알 수 있게 남긴다.
	pub effort: String,
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
	/// 지식베이스에서 찾아 프롬프트에 붙인 구획. 무엇을 근거로 줬는지 나중에 볼 수 있게 남긴다.
	pub kb_hits: Vec<KbHit>,
	/// 이 실행이 돈 claude 세션. 이어 붙인 세션에 같은 지식베이스 구획을 다시 보내지 않으려고 남긴다. 이 칸이 생기기 전의 기록은 비어 있다.
	pub session_id: String,
	/// 어휘 사전에서 프롬프트에 붙인 용어 이름. 다른 프로젝트 것이면 `용어 · 프로젝트` 꼴이다.
	pub glossary_terms: Vec<String>,
}

/// claude 한 번 호출이 쓴 토큰. stream-json 끝의 result 줄 `usage` 에서 꺼낸다.
/// 캐시 작성 · 읽기를 따로 두는 까닭: 같은 토큰 수라도 값이 크게 다르고, 어디서 캐시가 깨지는지 봐야 줄일 데를 안다.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Tokens {
	pub input: u64,
	pub output: u64,
	pub cache_create: u64,
	pub cache_read: u64,
}

impl Tokens {
	/// result 줄에서 꺼낸다. 문서에 없는 출력이라 칸이 빠지면 0 으로 둔다.
	pub fn from_result(r: &serde_json::Value) -> Tokens {
		let n = |k: &str| r.get("usage").and_then(|u| u.get(k)).and_then(|x| x.as_u64()).unwrap_or(0);
		Tokens { input: n("input_tokens"), output: n("output_tokens"), cache_create: n("cache_creation_input_tokens"), cache_read: n("cache_read_input_tokens") }
	}

	pub fn add(&mut self, o: &Tokens) {
		self.input += o.input;
		self.output += o.output;
		self.cache_create += o.cache_create;
		self.cache_read += o.cache_read;
	}
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
	/// 이 메모의 계획 · 구현 · 대화에 쓸 모델. 비우면 설정의 실행별 모델을 따른다.
	pub model: String,
	/// 이 메모의 계획 · 구현 · 대화에 쓸 effort. 비우면 설정의 실행별 effort 를 따른다.
	pub effort: String,
	pub title: String,
	/// 제목을 누가 정하는지. 이 칸이 생기기(2026-10-28) 전의 이슈는 기본값 first_line 으로 읽혀 지금처럼 첫 줄을 따른다.
	pub title_mode: TitleMode,
	/// 제목을 지을 때 읽은 메모의 note_updated_at. 이보다 메모가 새로우면 다시 짓는다.
	pub titled_at: i64,
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
	/// 메모 없이 프로젝트에서 바로 연 대화. 보드에 나오지 않고 번호(0)도 받지 않는다.
	/// 세션 잇기 · 첨부 · 터미널 · 바뀐 파일 기록을 이슈 대화와 함께 쓰려고 같은 모델에 둔다.
	pub talk: bool,
	/// 실행 중에 보낸 질문. 실행이 끝나면 한 차례로 묶어 이어 보낸다. 사용자가 중지했으면 보내지 않고 남겨 둔다.
	pub queue: Vec<QueuedChat>,
	/// 이 이슈의 구현이 도는 워크트리. 있으면 수정 요청 · 대화도 그 안에서 돌고, 결과 확인 때 「반영」해야 본 작업트리에 들어간다.
	pub worktree: Option<Worktree>,
}

/// 본 작업트리 밖에서 도는 구현의 자리.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Worktree {
	pub path: String,
	/// 만들 때 찍은 작업트리 사본 커밋. 반영할 때 3-way 의 바탕이다.
	pub base: String,
	pub at: i64,
}

/// 실행이 끝나기를 기다리는 질문 하나. 보낼 때의 「읽기 전용」 여부와 첨부를 따로 든다.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct QueuedChat {
	pub id: String,
	pub text: String,
	pub edit: bool,
	pub images: Vec<String>,
	pub at: i64,
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
	/// 자동 갱신 · 밀린 변경 반영으로 Claude 가 쓴 판이다. 사람이 「검토함」을 누르기 전까지 켜져 있다.
	/// 판은 바로 최신이 된다 — 승인 전까지 앞 판을 최신으로 두면 판 번호 · 파일 이름 규칙까지 바꿔야 해서 표지만 단다.
	pub review: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocJob {
	pub run_id: String,
	pub phase: Phase,
	pub request: String,
	pub queued_at: i64,
	/// 이슈를 완료해 자동 갱신으로 시작했으면 그 이슈. 끝난 결과를 그 이슈의 흐름에 남긴다.
	#[serde(default)]
	pub issue_id: String,
	/// 「밀린 변경 반영」으로 시작했으면 반영하는 이슈들. 새 판이 나오면 이 이슈들을 자동 관리 기록에 catchup 으로 남긴다.
	#[serde(default)]
	pub catch_up: Vec<String>,
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
	/// 이슈를 완료하면 그 코드 변경과 관련 있는지 가려, 있으면 새 판을 쓴다.
	pub auto_update: bool,
	/// 마지막 자동 갱신 결과 한 줄 (`#번호 · v판 갱신` · `#번호 · 건너뜀 · 까닭` …). 목록에 보인다.
	pub auto_last: String,
	/// 자동 관리 기록. 판정 · 작성 결과를 이슈마다 한 줄씩 오래된 것부터 쌓는다(최근 AUTO_LOG_MAX 건).
	/// 이슈 흐름에도 같은 결과가 남지만, 산출물 쪽에서 「이 문서에 어떤 변경이 반영됐는지」를 되짚으려면 여기에 있어야 한다.
	pub auto_log: Vec<AutoEntry>,
	/// 작성법. 템플릿 · 지난 판에서 뽑은 구성 · 문체 · 표기 규칙(마크다운). 사용자가 고칠 수 있고, 쓸 때마다 함께 넘긴다.
	/// guide 와 칸을 나눈 것은 다시 뽑아도 사용자가 적은 지침을 덮지 않게 하려는 것이다.
	pub skill: String,
	/// 이 산출물에서 쓸 말. 프로젝트 어휘 사전과 같은 말이면 이쪽을 따른다.
	pub vocab: Vec<Term>,
	/// 결과 파일 형식(확장자). 비우면 템플릿을 따르고, 템플릿도 없으면 md 다.
	/// 2026.10.29 : 「마크다운으로 받기」(Claude 는 읽기만 하고 앱이 .md 로 저장)를 없앴다. 마크다운도 이 칸의 한 형식으로 Claude 가 파일로 만든다.
	///   옛 meta.json 의 mode 칸은 읽을 때 버려진다.
	pub format: String,
	/// refs/ 안에서 템플릿으로 쓸 파일 이름. 나머지는 참고 자료다.
	pub template: String,
	/// 작성법을 뽑는 중이면 그 실행. 기록은 runs/<run_id>.jsonl 에 남는다. 앱이 닫혀 끊기면 recover_interrupted 가 비운다.
	pub learn: Option<LearnJob>,
	pub learn_error: String,
	/// 마지막으로 끝난 뽑기의 run_id. 끝난 뒤에도 「기록」에서 그 응답을 다시 펼친다 — 답을 못 읽었을 때 까닭을 보는 자리다.
	pub learn_last_run: String,
	/// 마지막으로 뽑은 때 · 뽑기에 든 비용 합(USD). 뽑기는 판을 만들지 않아 runs 에 넣지 않는다 — 알림이 「작성 끝」으로 뜨지 않게.
	pub learned_at: i64,
	pub learn_cost_usd: f64,
	/// 값이 이미 있는 칸에 들어갈 뽑은 값. 사용자가 적용하거나 버리기 전까지 칸은 그대로다.
	pub draft: RecipeDraft,
}

/// 자동 관리 기록은 산출물마다 이만큼만 둔다. 오래된 것은 이슈 흐름에 남아 있다.
pub const AUTO_LOG_MAX: usize = 50;

/// 자동 관리 기록 한 줄. 이슈 하나가 이 산출물에 어떻게 반영됐는지다.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AutoEntry {
	pub at: i64,
	pub issue_id: String,
	pub number: u32,
	/// updated · skipped · unrelated · catchup — 반영이 끝난 것.
	/// busy · failed · stopped · discarded(만든 판을 사람이 버림) — 반영하지 못한 것. 이 이슈는 반영 대기에 남는다.
	pub verdict: String,
	pub reason: String,
	/// updated · catchup 이면 만든 판 번호
	pub version: u32,
}

impl AutoEntry {
	/// 이 결과로 그 이슈의 반영이 끝났는가. 아니면 반영 대기에 남긴다.
	pub fn settled(&self) -> bool {
		matches!(self.verdict.as_str(), "updated" | "skipped" | "unrelated" | "catchup")
	}
}

impl Deliverable {
	pub fn push_auto(&mut self, e: AutoEntry) {
		self.auto_log.push(e);
		let over = self.auto_log.len().saturating_sub(AUTO_LOG_MAX);
		self.auto_log.drain(..over);
	}
}

/// 완료됐지만 아직 이 산출물에 반영되지 않은 이슈. 저장하지 않고 목록을 읽을 때 센다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingIssue {
	pub id: String,
	pub number: u32,
	pub title: String,
	pub done_at: i64,
}

/// 산출물에서 쓸 말 하나. avoid 는 같은 뜻이지만 쓰지 않을 말이다.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Term {
	pub term: String,
	pub avoid: Vec<String>,
	pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct LearnJob {
	pub run_id: String,
	pub started_at: i64,
	/// 뽑기는 동시에 둘까지만 돈다. 자리를 기다리는 동안은 queued 다.
	pub phase: Phase,
}

/// 뽑은 값의 제안. 빈 칸 · 빈 목록이면 제안이 없다.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RecipeDraft {
	pub skill: String,
	/// 지금 어휘에 없는 말만 담는다. 적용하면 덧붙인다.
	pub vocab: Vec<Term>,
	pub format: String,
	pub naming: String,
	pub template: String,
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
	/// Deliverable.template 이 이 파일이다
	pub template: bool,
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
	/// 앱이 쓰는 마크다운 판(직접 쓴 글 · 이슈 정리)의 다음 파일 이름
	pub next_name: String,
	/// 반영 대기 이슈. 자동 갱신을 켜고 판이 있는 산출물만 센다 — 끈 산출물은 손으로 관리하는 문서라 숫자를 쌓지 않는다.
	pub pending: Vec<PendingIssue>,
}
