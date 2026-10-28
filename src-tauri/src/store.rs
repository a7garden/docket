//! 앱 데이터 폴더(%APPDATA%\docket, DOCKET_HOME 으로 바꿀 수 있다)를 읽고 쓴다.
//!
//! ```text
//! docket/
//!   settings.json · projects.json
//!   usage.json                         마지막으로 받은 구독 사용률 (usage.rs)
//!   projects/<pid>/issues/<iid>/       issue.json · note.md · attachments/ · runs/<rid>.jsonl
//!                                      프로젝트 대화도 여기 둔다 (issue.json 의 talk · note.md 없음)
//!   projects/<pid>/deliverables/<did>/ meta.json · v1/<파일> · runs/<rid>.jsonl
//!   projects/<pid>/kb/                 지식베이스 · catalog.json · inbox/ · text/ (kb.rs)
//!   trash/<시각>-<이름>/                  지운 것은 여기로 옮긴다
//!   plugins/<id>.json                     플러그인 정의 (사용자가 쓴다 · plugins.rs)
//! ```
//!
//! 프로젝트 폴더에는 쓰지 않는다. 소스 저장소에 이 앱의 흔적이 남지 않게 하는 것이 이 앱의 약속이다.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::error::{Error, Result, msg};
use crate::model::*;
use crate::{extract, naming};

pub struct Store {
	pub root: PathBuf,
	/// 이슈 · 산출물 · 목록 파일의 읽고-고치고-쓰기를 한 줄로 세운다. 실행 작업과 화면 명령이 같은 파일을 동시에 고친다.
	lock: Mutex<()>,
}

/* ---------- 파일 도우미 ---------- */

fn read_json<T: DeserializeOwned + Default>(path: &Path) -> Result<T> {
	match fs::read(path) {
		Ok(b) => Ok(serde_json::from_slice(&b)?),
		Err(e) if e.kind() == ErrorKind::NotFound => Ok(T::default()),
		Err(e) => Err(e.into()),
	}
}

/// 임시 파일에 쓰고 바꿔 끼운다. 쓰다가 앱이 꺼져도 반쯤 쓴 JSON 이 남지 않는다.
fn write_json<T: Serialize>(path: &Path, v: &T) -> Result<()> {
	write_atomic(path, &serde_json::to_vec_pretty(v)?)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
	if let Some(d) = path.parent() {
		fs::create_dir_all(d)?;
	}
	let mut tmp = path.as_os_str().to_owned();
	tmp.push(".tmp");
	let tmp = PathBuf::from(tmp);
	fs::write(&tmp, bytes)?;
	fs::rename(&tmp, path)?;
	Ok(())
}

/// 경로에 들어갈 id 를 확인한다. 화면에서 온 값으로 데이터 폴더 밖을 가리키지 못하게 한다.
pub fn safe_id(id: &str) -> Result<&str> {
	if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
		Ok(id)
	} else {
		msg(format!("잘못된 id: {id}"))
	}
}

/// 파일 이름에 못 쓰는 글자를 바꾼다. 한글은 그대로 둔다.
pub fn safe_file_name(name: &str, fallback: &str) -> String {
	let cleaned: String = name
		.chars()
		.map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
		.collect();
	let cleaned = cleaned.trim().trim_matches('.').trim();
	let cleaned: String = cleaned.chars().take(80).collect();
	if cleaned.is_empty() { fallback.to_string() } else { cleaned }
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
	fs::create_dir_all(dst)?;
	for entry in fs::read_dir(src)? {
		let entry = entry?;
		let to = dst.join(entry.file_name());
		if entry.file_type()?.is_dir() {
			copy_dir_all(&entry.path(), &to)?;
		} else {
			fs::copy(entry.path(), to)?;
		}
	}
	Ok(())
}

/// 같은 이름이 있으면 " (2)" 를 붙인다.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
	let first = dir.join(name);
	if !first.exists() {
		return first;
	}
	let (stem, ext) = match name.rfind('.') {
		Some(i) if i > 0 => (&name[..i], &name[i..]),
		_ => (name, ""),
	};
	(2..)
		.map(|n| dir.join(format!("{stem} ({n}){ext}")))
		.find(|p| !p.exists())
		.unwrap()
}

pub fn same_path(a: &str, b: &str) -> bool {
	let norm = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_lowercase();
	norm(a) == norm(b)
}

/// 메모 첫 줄을 제목으로 쓴다. 머리표 · 목록 기호 · 이미지 줄은 건너뛴다.
/// 옛 이슈의 제목이고, 제목 모델이 지어 오기 전이나 짓지 못했을 때의 임시 제목이다. 카드가 빈 제목으로 뜨지 않게 하려는 것이다.
pub fn title_of(note: &str) -> String {
	for line in note.lines() {
		let t = line.trim().trim_start_matches('#').trim_start_matches(['-', '*', '>', ' ']).trim();
		if t.is_empty() || t.starts_with("![") || t.starts_with("```") {
			continue;
		}
		return t.chars().take(80).collect();
	}
	String::new()
}

/// 메모를 저장할 때 제목을 맞춘다. 모델이 지은 제목 · 손으로 고친 제목은 첫 줄로 덮지 않는다.
/// 지은 제목은 메모가 잠잠해지면 제목 짓기 순회가 새로 바꾼다.
pub fn note_title(issue: &mut Issue, note: &str) {
	match issue.title_mode {
		TitleMode::FirstLine => issue.title = title_of(note),
		TitleMode::Auto if issue.titled_at == 0 => issue.title = title_of(note),
		_ => {}
	}
}

/// 모델이 하나뿐이던 옛 설정을 실행별 세 칸으로 옮긴다. 세 칸 중 하나라도 정했으면 옛 값은 버린다.
/// 옛 값은 저장하지 않으므로, 한 번 저장하면 파일에서 빠진다.
fn migrate_settings(mut s: Settings) -> Settings {
	let legacy = std::mem::take(&mut s.legacy_model);
	let legacy = legacy.trim();
	if !legacy.is_empty() && [&s.plan_model, &s.impl_model, &s.chat_model].iter().all(|m| m.trim().is_empty()) {
		s.plan_model = legacy.to_string();
		s.impl_model = legacy.to_string();
		s.chat_model = legacy.to_string();
	}
	s
}

/// 실행이 끝나지 못했을 때 이슈를 마지막으로 안정된 단계로 돌린다.
pub fn settle(issue: &mut Issue, kind: RunKind) {
	issue.status = match kind {
		// 대화는 들어갈 때 단계를 바꾸지 않았으므로 되돌릴 것도 없다.
		RunKind::Chat => issue.status,
		RunKind::Plan if issue.plan.is_some() => Status::Planned,
		RunKind::Plan => Status::Inbox,
		_ if !issue.changes.is_empty() || issue.result.is_some() => Status::Review,
		_ => Status::Planned,
	};
	issue.run = None;
	for r in issue.runs.iter_mut().filter(|r| r.status == "running") {
		r.status = "stopped".into();
		r.ended_at = now_ms();
	}
}

impl Store {
	pub fn open() -> Result<Self> {
		let root = match std::env::var_os("DOCKET_HOME") {
			Some(p) if !p.is_empty() => PathBuf::from(p),
			_ => dirs::data_dir().ok_or_else(|| Error::Msg("데이터 폴더를 찾을 수 없습니다".into()))?.join("docket"),
		};
		fs::create_dir_all(root.join("projects"))?;
		fs::create_dir_all(root.join("trash"))?;
		// 설정 화면의 「폴더 열기」가 처음부터 열리게 만들어 둔다.
		fs::create_dir_all(crate::plugins::dir(&root))?;
		Ok(Self { root, lock: Mutex::new(()) })
	}

	fn guard(&self) -> MutexGuard<'_, ()> {
		self.lock.lock().unwrap_or_else(|e| e.into_inner())
	}

	/// 지운 것을 휴지통 폴더로 옮긴다. 다른 드라이브면 rename 이 안 되므로 복사한 뒤 지운다.
	pub fn trash(&self, path: &Path, label: &str) -> Result<PathBuf> {
		let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
		let dest = unique_path(&self.root.join("trash"), &format!("{stamp}-{}", safe_file_name(label, "item")));
		if fs::rename(path, &dest).is_err() {
			if path.is_dir() {
				copy_dir_all(path, &dest)?;
				fs::remove_dir_all(path)?;
			} else {
				fs::copy(path, &dest)?;
				fs::remove_file(path)?;
			}
		}
		Ok(dest)
	}

	/* ---------- 설정 ---------- */

	pub fn settings(&self) -> Result<Settings> {
		Ok(migrate_settings(read_json(&self.root.join("settings.json"))?))
	}

	pub fn save_settings(&self, s: &Settings) -> Result<Settings> {
		write_json(&self.root.join("settings.json"), s)?;
		Ok(s.clone())
	}

	/* ---------- 프로젝트 ---------- */

	fn projects_path(&self) -> PathBuf {
		self.root.join("projects.json")
	}

	pub fn projects(&self) -> Result<Vec<Project>> {
		read_json(&self.projects_path())
	}

	pub fn project(&self, id: &str) -> Result<Project> {
		self.projects()?
			.into_iter()
			.find(|p| p.id == id)
			.ok_or_else(|| Error::Msg("프로젝트를 찾을 수 없습니다".into()))
	}

	pub fn add_project(&self, path: &str) -> Result<Project> {
		let dir = PathBuf::from(path);
		if !dir.is_dir() {
			return msg("폴더를 찾을 수 없습니다");
		}
		let _g = self.guard();
		let mut list: Vec<Project> = read_json(&self.projects_path())?;
		if let Some(found) = list.iter().find(|p| same_path(&p.path, path)) {
			return Ok(found.clone());
		}
		let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string());
		let p = Project { id: short_id(), name, path: path.to_string(), created_at: now_ms(), ..Default::default() };
		list.push(p.clone());
		write_json(&self.projects_path(), &list)?;
		Ok(p)
	}

	/// 실행 기록의 「허용 목록에 추가」. 이미 있는 규칙은 다시 넣지 않는다.
	pub fn allow_rules(&self, pid: &str, rules: &[String]) -> Result<Project> {
		let _g = self.guard();
		let mut list: Vec<Project> = read_json(&self.projects_path())?;
		let p = list.iter_mut().find(|p| p.id == pid).ok_or_else(|| Error::Msg("프로젝트를 찾을 수 없습니다".into()))?;
		for r in rules.iter().map(|r| r.trim()).filter(|r| !r.is_empty()) {
			if !p.allowed_tools.iter().any(|x| x == r) {
				p.allowed_tools.push(r.to_string());
			}
		}
		let out = p.clone();
		write_json(&self.projects_path(), &list)?;
		Ok(out)
	}

	/// 이름 · 권한 · 산출물 설정만 바꾼다. 경로와 번호 카운터는 화면에서 온 값으로 덮지 않는다.
	pub fn save_project(&self, input: &Project) -> Result<Project> {
		let dir = input.deliverables_dir.trim();
		if !dir.is_empty() {
			if !Path::new(dir).is_absolute() {
				return msg("산출물 폴더는 전체 경로로 적어 주세요");
			}
			fs::create_dir_all(dir)?;
		}
		let archive = input.archive_dir.trim().trim_matches(['/', '\\']);
		if archive.contains("..") || archive.contains(':') {
			return msg("지난 판 폴더는 산출물 폴더 안의 하위 폴더 이름으로 적어 주세요");
		}
		let _g = self.guard();
		let mut list: Vec<Project> = read_json(&self.projects_path())?;
		let p = list
			.iter_mut()
			.find(|p| p.id == input.id)
			.ok_or_else(|| Error::Msg("프로젝트를 찾을 수 없습니다".into()))?;
		p.name = if input.name.trim().is_empty() { p.name.clone() } else { input.name.trim().to_string() };
		p.impl_mode = if input.impl_mode == "bypassPermissions" { input.impl_mode.clone() } else { "acceptEdits".into() };
		p.allowed_tools = input.allowed_tools.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
		p.denied_tools = input.denied_tools.iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
		p.plan_vcs_read = input.plan_vcs_read;
		p.deliverables_dir = dir.to_string();
		p.naming = input.naming.trim().to_string();
		p.naming_underscore = input.naming_underscore;
		p.archive_dir = archive.to_string();
		let out = p.clone();
		write_json(&self.projects_path(), &list)?;
		Ok(out)
	}

	/// 지식베이스 설정만 바꾼다. 폴더는 전체 경로로, 겹치지 않게 받는다.
	pub fn save_kb(&self, pid: &str, kb: &ProjectKb) -> Result<Project> {
		let mut folders: Vec<String> = Vec::new();
		for f in kb.folders.iter().map(|f| f.trim().trim_end_matches(['/', '\\'])).filter(|f| !f.is_empty()) {
			if !Path::new(f).is_absolute() {
				return msg(format!("참조 폴더는 전체 경로로 적어 주세요: {f}"));
			}
			if !folders.iter().any(|x| same_path(x, f)) {
				folders.push(f.to_string());
			}
		}
		let _g = self.guard();
		let mut list: Vec<Project> = read_json(&self.projects_path())?;
		let p = list.iter_mut().find(|p| p.id == pid).ok_or_else(|| Error::Msg("프로젝트를 찾을 수 없습니다".into()))?;
		p.kb = ProjectKb { folders, top_k: kb.top_k.clamp(1, 30), ..kb.clone() };
		let out = p.clone();
		write_json(&self.projects_path(), &list)?;
		Ok(out)
	}

	pub fn kb_dir(&self, pid: &str) -> PathBuf {
		self.project_dir(pid).join("kb")
	}

	/// 끌어 놓은 파일 · 폴더를 kb/inbox/ 로 복사한다. 폴더는 폴더째 옮긴다. 형식은 가리지 않는다 — 넣을 수 없는 것은 색인이 까닭을 적는다.
	pub fn kb_import(&self, pid: &str, paths: &[String]) -> Result<Vec<String>> {
		let dir = self.kb_dir(safe_id(pid)?).join("inbox");
		fs::create_dir_all(&dir)?;
		let mut names = Vec::new();
		for src in paths.iter().map(Path::new) {
			let name = safe_file_name(&src.file_name().unwrap_or_default().to_string_lossy(), "자료");
			let dest = unique_path(&dir, &name);
			if src.is_dir() {
				copy_dir_all(src, &dest)?;
			} else if src.is_file() {
				fs::copy(src, &dest)?;
			} else {
				continue;
			}
			names.push(dest.file_name().unwrap().to_string_lossy().to_string());
		}
		if names.is_empty() {
			return msg("넣을 파일을 찾지 못했습니다");
		}
		Ok(names)
	}

	/// inbox 안의 파일 · 폴더를 휴지통으로 옮긴다. inbox 밖은 지우지 않는다.
	pub fn kb_inbox_delete(&self, pid: &str, path: &str) -> Result<()> {
		let inbox = self.kb_dir(safe_id(pid)?).join("inbox");
		let target = PathBuf::from(path);
		if !target.starts_with(&inbox) || target == inbox || target.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
			return msg("끌어 놓은 자료만 여기서 지울 수 있습니다");
		}
		if target.exists() {
			let label = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
			self.trash(&target, &format!("kb-{label}"))?;
		}
		Ok(())
	}

	pub fn remove_project(&self, id: &str, delete_data: bool) -> Result<()> {
		safe_id(id)?;
		{
			let _g = self.guard();
			let mut list: Vec<Project> = read_json(&self.projects_path())?;
			list.retain(|p| p.id != id);
			write_json(&self.projects_path(), &list)?;
		}
		let dir = self.project_dir(id);
		if delete_data && dir.exists() {
			self.trash(&dir, &format!("project-{id}"))?;
		}
		Ok(())
	}

	pub fn project_dir(&self, pid: &str) -> PathBuf {
		self.root.join("projects").join(pid)
	}

	/* ---------- 이슈 ---------- */

	pub fn issue_dir(&self, pid: &str, iid: &str) -> PathBuf {
		self.project_dir(pid).join("issues").join(iid)
	}

	fn load_issue(&self, pid: &str, iid: &str) -> Result<Issue> {
		let path = self.issue_dir(safe_id(pid)?, safe_id(iid)?).join("issue.json");
		if !path.exists() {
			return msg("이슈를 찾을 수 없습니다");
		}
		read_json(&path)
	}

	fn write_issue(&self, issue: &Issue) -> Result<()> {
		write_json(&self.issue_dir(&issue.project_id, &issue.id).join("issue.json"), issue)
	}

	pub fn note(&self, pid: &str, iid: &str) -> String {
		fs::read_to_string(self.issue_dir(pid, iid).join("note.md")).unwrap_or_default()
	}

	pub fn attachments(&self, pid: &str, iid: &str) -> Vec<String> {
		let mut names: Vec<String> = fs::read_dir(self.issue_dir(pid, iid).join("attachments"))
			.map(|rd| {
				rd.filter_map(|e| e.ok())
					.filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
					.map(|e| e.file_name().to_string_lossy().to_string())
					.collect()
			})
			.unwrap_or_default();
		names.sort();
		names
	}

	pub fn view(&self, issue: Issue) -> IssueView {
		let note = self.note(&issue.project_id, &issue.id);
		let attachments = self.attachments(&issue.project_id, &issue.id);
		let dir = self.issue_dir(&issue.project_id, &issue.id).to_string_lossy().to_string();
		IssueView { issue, note, attachments, dir }
	}

	pub fn get_issue(&self, pid: &str, iid: &str) -> Result<IssueView> {
		Ok(self.view(self.load_issue(pid, iid)?))
	}

	pub fn raw_issue(&self, pid: &str, iid: &str) -> Result<Issue> {
		self.load_issue(pid, iid)
	}

	/// 보드의 이슈만 돌려준다. 프로젝트 대화는 같은 폴더에 있지만 뺀다 — 보드 · 사이드바 집계 · 자동 계획이 대화를 보지 않게 하는 경계가 여기 하나다.
	pub fn list_issues(&self, pid: &str) -> Result<Vec<IssueView>> {
		let mut out = self.scan(pid, false)?;
		out.sort_by_key(|v| std::cmp::Reverse(v.issue.number));
		Ok(out)
	}

	/// 프로젝트 대화. 번호가 없으니 최근 움직인 순이다.
	pub fn list_talks(&self, pid: &str) -> Result<Vec<IssueView>> {
		let mut out = self.scan(pid, true)?;
		out.sort_by_key(|v| std::cmp::Reverse(v.issue.updated_at));
		Ok(out)
	}

	fn scan(&self, pid: &str, talk: bool) -> Result<Vec<IssueView>> {
		let dir = self.project_dir(safe_id(pid)?).join("issues");
		let mut out = Vec::new();
		let Ok(rd) = fs::read_dir(&dir) else { return Ok(out) };
		for e in rd.filter_map(|e| e.ok()) {
			let path = e.path().join("issue.json");
			if !path.exists() {
				continue;
			}
			match read_json::<Issue>(&path) {
				Ok(issue) if issue.talk == talk => out.push(self.view(issue)),
				Ok(_) => {}
				Err(err) => eprintln!("이슈를 읽지 못함 {}: {err}", path.display()),
			}
		}
		Ok(out)
	}

	/// 메모 없이 여는 프로젝트 대화. 이슈 번호를 쓰지 않는다 — 쓰면 보드 번호에 빈칸이 생긴다.
	/// 화면이 id 를 먼저 정한다. 첫 질문 전에 붙여 넣은 그림이 그 id 의 첨부 폴더에 먼저 들어간다.
	pub fn create_talk(&self, pid: &str, tid: &str) -> Result<IssueView> {
		safe_id(pid)?;
		let id = safe_id(tid)?.to_string();
		self.project(pid)?;
		let issue = {
			let _g = self.guard();
			if self.issue_dir(pid, &id).join("issue.json").exists() {
				return msg("이미 있는 대화입니다");
			}
			let now = now_ms();
			let mut issue = Issue { id, project_id: pid.to_string(), talk: true, created_at: now, updated_at: now, ..Default::default() };
			issue.log("created", "");
			self.write_issue(&issue)?;
			issue
		};
		Ok(self.view(issue))
	}

	/// 화면이 미리 정한 id 를 받는다. 메모를 붙이기 전에 붙여 넣은 이미지가 그 id 의 폴더에 먼저 저장된다.
	/// title_mode 가 auto 여도 첫 줄을 임시 제목으로 넣는다. 지은 제목은 제목 짓기 순회가 나중에 바꾼다.
	/// model 을 비우면 설정의 실행별 모델을 따른다.
	pub fn create_issue(&self, pid: &str, iid: Option<&str>, note: &str, auto_plan: bool, title_mode: TitleMode, model: &str) -> Result<IssueView> {
		safe_id(pid)?;
		let id = match iid {
			Some(i) => safe_id(i)?.to_string(),
			None => short_id(),
		};
		let issue = {
			let _g = self.guard();
			let mut list: Vec<Project> = read_json(&self.projects_path())?;
			let p = list
				.iter_mut()
				.find(|p| p.id == pid)
				.ok_or_else(|| Error::Msg("프로젝트를 찾을 수 없습니다".into()))?;
			let number = p.next_number.max(1);
			p.next_number = number + 1;
			write_json(&self.projects_path(), &list)?;

			if self.issue_dir(pid, &id).join("issue.json").exists() {
				return msg("이미 있는 이슈입니다");
			}
			let now = now_ms();
			let mut issue = Issue {
				id: id.clone(),
				project_id: pid.to_string(),
				number,
				status: Status::Inbox,
				auto_plan,
				model: model.trim().to_string(),
				title: title_of(note),
				title_mode,
				created_at: now,
				updated_at: now,
				note_updated_at: now,
				..Default::default()
			};
			issue.log("created", "");
			write_atomic(&self.issue_dir(pid, &id).join("note.md"), note.as_bytes())?;
			self.write_issue(&issue)?;
			issue
		};
		Ok(self.view(issue))
	}

	pub fn update_issue<F>(&self, pid: &str, iid: &str, f: F) -> Result<IssueView>
	where
		F: FnOnce(&mut Issue) -> Result<()>,
	{
		let issue = {
			let _g = self.guard();
			let mut issue = self.load_issue(pid, iid)?;
			f(&mut issue)?;
			issue.updated_at = now_ms();
			self.write_issue(&issue)?;
			issue
		};
		Ok(self.view(issue))
	}

	pub fn save_note(&self, pid: &str, iid: &str, note: &str) -> Result<IssueView> {
		write_atomic(&self.issue_dir(safe_id(pid)?, safe_id(iid)?).join("note.md"), note.as_bytes())?;
		self.update_issue(pid, iid, |i| {
			note_title(i, note);
			i.note_updated_at = now_ms();
			Ok(())
		})
	}

	pub fn delete_issue(&self, pid: &str, iid: &str) -> Result<()> {
		let issue = self.load_issue(pid, iid)?;
		if issue.run.is_some() {
			return msg("실행 중인 이슈는 지울 수 없습니다. 먼저 중지하세요.");
		}
		self.trash(&self.issue_dir(pid, iid), &format!("issue-{}", issue.number))?;
		Ok(())
	}

	fn attachments_dir(&self, pid: &str, iid: &str) -> Result<PathBuf> {
		Ok(self.issue_dir(safe_id(pid)?, safe_id(iid)?).join("attachments"))
	}

	pub fn save_attachment(&self, pid: &str, iid: &str, bytes: &[u8], ext: &str) -> Result<String> {
		let dir = self.attachments_dir(pid, iid)?;
		fs::create_dir_all(&dir)?;
		let ext: String = ext.chars().filter(|c| c.is_ascii_alphanumeric()).take(5).collect::<String>().to_lowercase();
		let ext = if ext.is_empty() { "png".to_string() } else { ext };
		let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
		let path = unique_path(&dir, &format!("붙여넣기-{stamp}.{ext}"));
		fs::write(&path, bytes)?;
		Ok(path.file_name().unwrap().to_string_lossy().to_string())
	}

	pub fn import_attachments(&self, pid: &str, iid: &str, paths: &[String]) -> Result<Vec<String>> {
		let dir = self.attachments_dir(pid, iid)?;
		fs::create_dir_all(&dir)?;
		let mut names = Vec::new();
		for src in paths {
			let src = Path::new(src);
			if !src.is_file() {
				continue;
			}
			let name = safe_file_name(&src.file_name().unwrap_or_default().to_string_lossy(), "첨부");
			let dest = unique_path(&dir, &name);
			fs::copy(src, &dest)?;
			names.push(dest.file_name().unwrap().to_string_lossy().to_string());
		}
		Ok(names)
	}

	pub fn delete_attachment(&self, pid: &str, iid: &str, name: &str) -> Result<()> {
		let path = self.attachments_dir(pid, iid)?.join(safe_file_name(name, "_"));
		if path.is_file() {
			self.trash(&path, name)?;
		}
		Ok(())
	}

	pub fn issue_run_log(&self, pid: &str, iid: &str, run_id: &str) -> Result<PathBuf> {
		Ok(self.issue_dir(safe_id(pid)?, safe_id(iid)?).join("runs").join(format!("{}.jsonl", safe_id(run_id)?)))
	}

	/* ---------- 산출물 ---------- */
	//
	// 산출물의 정보(meta.json) · 템플릿(refs/) · 실행 기록(runs/)은 앱 데이터에 둔다.
	// 판 파일은 프로젝트에 산출물 폴더를 정했으면 그 폴더(+하위 폴더)에, 아니면 앱 데이터의 v<n>/ 에 둔다.

	pub fn deliverable_dir(&self, pid: &str, did: &str) -> PathBuf {
		self.project_dir(pid).join("deliverables").join(did)
	}

	pub fn refs_dir(&self, pid: &str, did: &str) -> PathBuf {
		self.deliverable_dir(pid, did).join("refs")
	}

	fn load_deliverable(&self, pid: &str, did: &str) -> Result<Deliverable> {
		let path = self.deliverable_dir(safe_id(pid)?, safe_id(did)?).join("meta.json");
		if !path.exists() {
			return msg("산출물을 찾을 수 없습니다");
		}
		read_json(&path)
	}

	fn write_deliverable(&self, d: &Deliverable) -> Result<()> {
		write_json(&self.deliverable_dir(&d.project_id, &d.id).join("meta.json"), d)
	}

	fn next_n(d: &Deliverable) -> u32 {
		d.versions.iter().map(|v| v.n).max().unwrap_or(0) + 1
	}

	/// 새 판이 놓일 폴더. 하위 폴더에 `..` 가 있으면 무시한다. 산출물 폴더 밖으로 나가지 않게 한다.
	fn output_dir(&self, p: Option<&Project>, d: &Deliverable, n: u32) -> PathBuf {
		match p.filter(|p| !p.deliverables_dir.trim().is_empty()) {
			Some(p) => {
				let base = PathBuf::from(p.deliverables_dir.trim());
				let sub = d.subdir.trim().trim_matches(['/', '\\']);
				if sub.is_empty() || sub.split(['/', '\\']).any(|c| c == ".." || c.contains(':')) { base } else { base.join(sub) }
			}
			None => self.deliverable_dir(&d.project_id, &d.id).join(format!("v{n}")),
		}
	}

	pub fn file_name_for(p: Option<&Project>, d: &Deliverable, n: u32, ext: &str) -> String {
		let pattern = if d.naming.trim().is_empty() { p.map(|p| p.naming.as_str()).unwrap_or("") } else { d.naming.as_str() };
		let ctx = naming::Ctx { title: &d.title, project: p.map(|p| p.name.as_str()).unwrap_or(""), n };
		naming::apply(pattern, &ctx, ext, p.map(|p| p.naming_underscore).unwrap_or(true))
	}

	fn resolve(&self, d: &Deliverable, v: &Version) -> PathBuf {
		if v.path.is_empty() {
			self.deliverable_dir(&d.project_id, &d.id).join(format!("v{}", v.n)).join(&v.file)
		} else {
			PathBuf::from(&v.path)
		}
	}

	pub fn list_refs(&self, pid: &str, did: &str) -> Vec<RefFile> {
		let dir = self.refs_dir(pid, did);
		let mut out: Vec<RefFile> = fs::read_dir(&dir)
			.map(|rd| {
				rd.filter_map(|e| e.ok())
					.filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
					.map(|e| {
						let name = e.file_name().to_string_lossy().to_string();
						let kind = extract::kind(&name);
						let text = dir.join(".text").join(format!("{name}.txt"));
						RefFile {
							size: e.metadata().map(|m| m.len()).unwrap_or(0),
							kind: kind.into(),
							text_path: if kind == "extract" && text.is_file() { text.to_string_lossy().to_string() } else { String::new() },
							name,
						}
					})
					.collect()
			})
			.unwrap_or_default();
		out.sort_by(|a, b| a.name.cmp(&b.name));
		out
	}

	pub fn dview(&self, d: Deliverable) -> DeliverableView {
		let p = self.project(&d.project_id).ok();
		let n = Self::next_n(&d);
		DeliverableView {
			dir: self.deliverable_dir(&d.project_id, &d.id).to_string_lossy().to_string(),
			refs: self.list_refs(&d.project_id, &d.id),
			output_dir: self.output_dir(p.as_ref(), &d, n).to_string_lossy().to_string(),
			next_name: Self::file_name_for(p.as_ref(), &d, n, "md"),
			deliverable: d,
		}
	}

	pub fn get_deliverable(&self, pid: &str, did: &str) -> Result<DeliverableView> {
		Ok(self.dview(self.load_deliverable(pid, did)?))
	}

	pub fn list_deliverables(&self, pid: &str) -> Result<Vec<DeliverableView>> {
		let dir = self.project_dir(safe_id(pid)?).join("deliverables");
		let mut out = Vec::new();
		let Ok(rd) = fs::read_dir(&dir) else { return Ok(out) };
		for e in rd.filter_map(|e| e.ok()) {
			let path = e.path().join("meta.json");
			if let Ok(d) = read_json::<Deliverable>(&path)
				&& !d.id.is_empty()
			{
				out.push(self.dview(d));
			}
		}
		out.sort_by_key(|v| std::cmp::Reverse(v.deliverable.updated_at));
		Ok(out)
	}

	pub fn create_deliverable(&self, pid: &str, title: &str, issue_id: &str) -> Result<Deliverable> {
		safe_id(pid)?;
		let now = now_ms();
		let d = Deliverable {
			id: short_id(),
			project_id: pid.to_string(),
			title: title.trim().to_string(),
			issue_id: issue_id.to_string(),
			created_at: now,
			updated_at: now,
			mode: "md".into(),
			..Default::default()
		};
		let _g = self.guard();
		self.write_deliverable(&d)?;
		Ok(d)
	}

	pub fn update_deliverable<F>(&self, pid: &str, did: &str, f: F) -> Result<DeliverableView>
	where
		F: FnOnce(&mut Deliverable) -> Result<()>,
	{
		let d = {
			let _g = self.guard();
			let mut d = self.load_deliverable(pid, did)?;
			f(&mut d)?;
			d.updated_at = now_ms();
			self.write_deliverable(&d)?;
			d
		};
		Ok(self.dview(d))
	}

	/// 템플릿 · 참고 자료를 넣는다. 오피스 문서는 글자를 뽑아 .text/ 에 둔다. 뽑지 못해도 원본은 남긴다.
	pub fn import_refs(&self, pid: &str, did: &str, paths: &[String]) -> Result<Vec<String>> {
		let dir = self.refs_dir(safe_id(pid)?, safe_id(did)?);
		fs::create_dir_all(dir.join(".text"))?;
		let mut names = Vec::new();
		for src in paths.iter().map(Path::new).filter(|p| p.is_file()) {
			let name = safe_file_name(&src.file_name().unwrap_or_default().to_string_lossy(), "자료");
			let dest = unique_path(&dir, &name);
			fs::copy(src, &dest)?;
			let name = dest.file_name().unwrap().to_string_lossy().to_string();
			if extract::kind(&name) == "extract"
				&& let Ok(text) = extract::extract(&dest)
			{
				write_atomic(&dir.join(".text").join(format!("{name}.txt")), text.as_bytes())?;
			}
			names.push(name);
		}
		if names.is_empty() {
			return msg("넣을 파일이 없습니다. 폴더는 넣지 않습니다.");
		}
		Ok(names)
	}

	pub fn delete_ref(&self, pid: &str, did: &str, name: &str) -> Result<()> {
		let dir = self.refs_dir(safe_id(pid)?, safe_id(did)?);
		let name = safe_file_name(name, "_");
		let path = dir.join(&name);
		if path.is_file() {
			self.trash(&path, &name)?;
		}
		let _ = fs::remove_file(dir.join(".text").join(format!("{name}.txt")));
		Ok(())
	}

	/// 새 판이 생길 때 지난 판 파일을 보관 폴더로 옮긴다. 산출물 폴더에 바로 놓인 판만 옮긴다.
	fn archive_previous(p: Option<&Project>, d: &mut Deliverable, out_dir: &Path) -> Result<()> {
		let Some(p) = p else { return Ok(()) };
		let archive = p.archive_dir.trim().trim_matches(['/', '\\']);
		if archive.is_empty() || archive.contains("..") || p.deliverables_dir.trim().is_empty() {
			return Ok(());
		}
		let Some(prev) = d.versions.last_mut() else { return Ok(()) };
		let cur = PathBuf::from(&prev.path);
		if prev.path.is_empty() || !cur.is_file() || cur.parent() != Some(out_dir) {
			return Ok(());
		}
		let dest_dir = out_dir.join(archive);
		fs::create_dir_all(&dest_dir)?;
		let dest = unique_path(&dest_dir, &prev.file);
		fs::rename(&cur, &dest)?;
		prev.path = dest.to_string_lossy().to_string();
		Ok(())
	}

	fn push_version(d: &mut Deliverable, n: u32, path: &Path, source: &str, note: &str) {
		d.versions.push(Version {
			n,
			file: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
			added_at: now_ms(),
			note: note.to_string(),
			size: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
			source: source.into(),
			path: path.to_string_lossy().to_string(),
		});
	}

	/// 가져온 파일은 받은 이름 그대로 둔다. 받은 파일 이름을 바꾸면 보낸 쪽과 이름이 어긋난다.
	pub fn add_version_file(&self, pid: &str, did: &str, src: &Path, source: &str, note: &str) -> Result<DeliverableView> {
		if !src.is_file() {
			return msg(format!("파일을 찾을 수 없습니다: {}", src.display()));
		}
		let p = self.project(pid).ok();
		self.update_deliverable(pid, did, |d| {
			let n = Self::next_n(d);
			let dir = self.output_dir(p.as_ref(), d, n);
			fs::create_dir_all(&dir)?;
			Self::archive_previous(p.as_ref(), d, &dir)?;
			let dest = unique_path(&dir, &safe_file_name(&src.file_name().unwrap_or_default().to_string_lossy(), "파일"));
			fs::copy(src, &dest)?;
			Self::push_version(d, n, &dest, source, note);
			Ok(())
		})
	}

	/// 앱이 쓰는 판(Claude 마크다운 · 직접 쓴 글 · 이슈 정리)은 이름 규칙을 따른다.
	pub fn add_version_text(&self, pid: &str, did: &str, content: &str, source: &str, note: &str) -> Result<DeliverableView> {
		let p = self.project(pid).ok();
		self.update_deliverable(pid, did, |d| {
			let n = Self::next_n(d);
			let dir = self.output_dir(p.as_ref(), d, n);
			fs::create_dir_all(&dir)?;
			Self::archive_previous(p.as_ref(), d, &dir)?;
			let dest = unique_path(&dir, &Self::file_name_for(p.as_ref(), d, n, "md"));
			write_atomic(&dest, content.as_bytes())?;
			Self::push_version(d, n, &dest, source, note);
			Ok(())
		})
	}

	/// Claude 가 파일로 만든 판을 등록한다. 파일은 이미 제자리에 있다.
	pub fn add_version_existing(&self, pid: &str, did: &str, path: &Path, source: &str, note: &str) -> Result<DeliverableView> {
		let p = self.project(pid).ok();
		self.update_deliverable(pid, did, |d| {
			let n = Self::next_n(d);
			if let Some(dir) = path.parent() {
				Self::archive_previous(p.as_ref(), d, dir)?;
			}
			Self::push_version(d, n, path, source, note);
			Ok(())
		})
	}

	/// Claude 에게 파일로 만들게 할 때 놓을 폴더와 이름(확장자 없이)을 정한다.
	pub fn plan_file_output(&self, pid: &str, did: &str) -> Result<(PathBuf, String)> {
		let p = self.project(pid).ok();
		let d = self.load_deliverable(pid, did)?;
		let n = Self::next_n(&d);
		let dir = self.output_dir(p.as_ref(), &d, n);
		fs::create_dir_all(&dir)?;
		Ok((dir, Self::file_name_for(p.as_ref(), &d, n, "")))
	}

	/// 마지막 판을 그 자리에서 고친다. 판을 올리지 않는 작은 손질용이다.
	pub fn overwrite_latest_text(&self, pid: &str, did: &str, content: &str) -> Result<DeliverableView> {
		self.update_deliverable(pid, did, |d| {
			let v = d.versions.last().cloned().ok_or_else(|| Error::Msg("판이 없습니다".into()))?;
			write_atomic(&self.resolve(d, &v), content.as_bytes())?;
			if let Some(last) = d.versions.last_mut() {
				last.size = content.len() as u64;
			}
			Ok(())
		})
	}

	pub fn version_path(&self, pid: &str, did: &str, n: u32) -> Result<PathBuf> {
		let d = self.load_deliverable(pid, did)?;
		let v = d.versions.iter().find(|v| v.n == n).ok_or_else(|| Error::Msg("그 판이 없습니다".into()))?;
		Ok(self.resolve(&d, v))
	}

	/// 앱 데이터의 정보 · 템플릿만 휴지통으로 옮긴다. 산출물 폴더에 둔 판 파일은 사용자 파일이라 그대로 둔다.
	pub fn delete_deliverable(&self, pid: &str, did: &str) -> Result<()> {
		let d = self.load_deliverable(pid, did)?;
		if d.job.is_some() {
			return msg("작성 중인 산출물은 지울 수 없습니다. 먼저 중지하세요.");
		}
		self.trash(&self.deliverable_dir(pid, did), &format!("deliverable-{}", d.title))?;
		Ok(())
	}

	pub fn deliverable_run_log(&self, pid: &str, did: &str, run_id: &str) -> Result<PathBuf> {
		Ok(self.deliverable_dir(safe_id(pid)?, safe_id(did)?).join("runs").join(format!("{}.jsonl", safe_id(run_id)?)))
	}

	/* ---------- 시작할 때 ---------- */

	/// 앱이 닫혀 끊긴 실행을 정리한다. 남겨 두면 그 이슈가 영원히 「실행 중」으로 보인다.
	pub fn recover_interrupted(&self) -> Result<()> {
		for p in self.projects()? {
			// 대화도 끊길 수 있다. 빠뜨리면 그 대화가 영원히 실행 중으로 남는다.
			for v in self.scan(&p.id, false)?.into_iter().chain(self.scan(&p.id, true)?) {
				if let Some(run) = v.issue.run.clone() {
					self.update_issue(&p.id, &v.issue.id, |i| {
						settle(i, run.kind);
						// 끊긴 대화는 이슈를 실패로 띄우지 않는다. 대화 탭에 중지로 남는 것으로 충분하다.
						if run.kind == RunKind::Chat {
							return Ok(());
						}
						i.error = "앱이 닫혀 실행이 끊겼습니다".into();
						i.log("stop", "앱 종료");
						Ok(())
					})?;
				}
			}
			for v in self.list_deliverables(&p.id)? {
				if v.deliverable.job.is_some() {
					self.update_deliverable(&p.id, &v.deliverable.id, |d| {
						d.job = None;
						d.error = "앱이 닫혀 작성이 끊겼습니다".into();
						for r in d.runs.iter_mut().filter(|r| r.status == "running") {
							r.status = "stopped".into();
						}
						Ok(())
					})?;
				}
			}
			self.sweep_orphans(&p.id);
		}
		Ok(())
	}

	/// 메모를 붙이지 않고 닫은 작성창이 남긴 첨부 폴더를 하루 뒤에 치운다.
	fn sweep_orphans(&self, pid: &str) {
		let Ok(rd) = fs::read_dir(self.project_dir(pid).join("issues")) else { return };
		let day = std::time::Duration::from_secs(86_400);
		for e in rd.filter_map(|e| e.ok()) {
			let dir = e.path();
			if dir.join("issue.json").exists() {
				continue;
			}
			let old = e.metadata().and_then(|m| m.modified()).map(|t| t.elapsed().unwrap_or_default() > day).unwrap_or(false);
			if old {
				let _ = fs::remove_dir_all(&dir);
			}
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// 옛 설정의 모델 하나가 세 칸으로 옮겨지고, 다시 쓸 때는 옛 칸이 남지 않는다.
	#[test]
	fn legacy_model_moves_to_run_models() {
		let s = migrate_settings(serde_json::from_str(r#"{"model":"opus"}"#).unwrap());
		assert_eq!((s.plan_model.as_str(), s.impl_model.as_str(), s.chat_model.as_str()), ("opus", "opus", "opus"));
		let out = serde_json::to_value(&s).unwrap();
		assert!(out.get("model").is_none(), "옛 칸이 다시 저장됐다: {out}");

		let s = migrate_settings(serde_json::from_str(r#"{"model":"opus","implModel":"sonnet"}"#).unwrap());
		assert_eq!((s.plan_model.as_str(), s.impl_model.as_str()), ("", "sonnet"), "새 칸을 정했는데 옛 값으로 덮었다");
	}

	/// 산출물 폴더 · 이름 규칙 · 지난 판 옮기기 · 템플릿 넣기를 한 번에 본다. 프로젝트 폴더에는 아무것도 생기면 안 된다.
	#[test]
	fn versions_follow_naming_and_archive() {
		let base = std::env::temp_dir().join(format!("docket-store-{}", short_id()));
		let (home, proj, out) = (base.join("home"), base.join("proj"), base.join("out"));
		for d in [home.join("projects"), home.join("trash"), proj.clone()] {
			fs::create_dir_all(d).unwrap();
		}
		let store = Store { root: home, lock: Mutex::new(()) };
		let p = store.add_project(&proj.to_string_lossy()).unwrap();
		store
			.save_project(&Project {
				deliverables_dir: out.to_string_lossy().into(),
				naming: "{제목}_v{판}".into(),
				naming_underscore: true,
				archive_dir: "이전판".into(),
				..p.clone()
			})
			.unwrap();
		let d = store.create_deliverable(&p.id, "함수 설명서", "").unwrap();
		store.add_version_text(&p.id, &d.id, "# 1", "editor", "").unwrap();
		let v = store.add_version_text(&p.id, &d.id, "# 2", "editor", "").unwrap();

		assert!(out.join("함수_설명서_v2.md").is_file());
		assert!(out.join("이전판").join("함수_설명서_v1.md").is_file());
		assert!(!out.join("함수_설명서_v1.md").exists());
		assert_eq!(v.next_name, "함수_설명서_v3.md");
		assert_eq!(fs::read_to_string(store.version_path(&p.id, &d.id, 1).unwrap()).unwrap(), "# 1");

		let tpl = base.join("양식.txt");
		fs::write(&tpl, "양식").unwrap();
		store.import_refs(&p.id, &d.id, &[tpl.to_string_lossy().into()]).unwrap();
		let refs = store.list_refs(&p.id, &d.id);
		assert_eq!((refs.len(), refs[0].kind.as_str()), (1, "direct"));

		assert_eq!(fs::read_dir(&proj).unwrap().count(), 0, "프로젝트 폴더에 무언가 생겼다");
		let _ = fs::remove_dir_all(&base);
	}

	/// 메모를 고칠 때 제목: 옛 이슈는 첫 줄을 따르고, 지은 제목 · 손으로 고친 제목은 그대로 둔다. 짓기 전에는 첫 줄을 임시로 쓴다.
	#[test]
	fn note_title_keeps_named_titles() {
		let note = "# 새 첫 줄\n본문";
		let mut i = Issue { title: "옛 제목".into(), ..Default::default() };
		note_title(&mut i, note);
		assert_eq!(i.title, "새 첫 줄");

		let mut i = Issue { title: "임시".into(), title_mode: TitleMode::Auto, ..Default::default() };
		note_title(&mut i, note);
		assert_eq!(i.title, "새 첫 줄", "짓기 전에는 첫 줄을 따른다");
		i.title = "지은 제목".into();
		i.titled_at = 1;
		note_title(&mut i, note);
		assert_eq!(i.title, "지은 제목");

		let mut i = Issue { title: "고친 제목".into(), title_mode: TitleMode::Manual, ..Default::default() };
		note_title(&mut i, note);
		assert_eq!(i.title, "고친 제목");
	}
}
