//! 코어 플러그인: 앱에 들어 있어 파일 없이 늘 목록에 있는 플러그인. 설정 › 플러그인에서 켜고 끄기만 한다.
//!
//! - 커뮤니티 플러그인(plugins/ 폴더에서 읽는 것)보다 앞에 싣는다. 켠 터미널 플러그인이 둘이면 앞의 것을 쓰므로 코어가 먼저 쓰인다.
//! - 권한 허락을 받지 않는다. 허락은 설치한 뒤 파일만 바꿔 권한을 몰래 늘리지 못하게 하려는 것인데(mod.rs missing),
//!   코어의 매니페스트는 앱 안에 있어 파일로 바꿀 수 없다.
//! - 지우거나 같은 id 로 설치하지 못한다 (install.rs).
//! - 2026.10.29 : 「herdr 정의 만들기」로 만들던 plugins/herdr · plugins/herdr.json 을 코어로 옮겼다. 남은 파일은 시작할 때 휴지통으로 옮긴다 (retire).
//!
//! - 메뉴를 기여하는 코어(릴리즈)는 코드 없이 앱이 직접 답한다 (command). 돌려주는 값의 대화 열기(chat)는 코어만 쓴다.
//!
//! 구획: 정의 · 메뉴 · 정리 · 시험

use std::path::{Path, PathBuf};

use super::api::{ChatReply, Reply};
use super::manifest::{self, Contributes, Manifest, Menu};
use super::{dir, terminal};
use crate::error::Result;
use crate::model::{GLOBAL_PID, Settings};
use crate::store::Store;

/* ---------- 정의 ---------- */

const HERDR_NOTE: &str = "켜 둔 herdr 에 이슈마다 새 탭 「#번호 제목」을 만들어 claude --resume 으로 세션을 잇습니다. 그 세션이 이미 떠 있으면 그 탭으로 옮깁니다. herdr 가 꺼져 있으면 Windows 터미널에 띄운 뒤 붙입니다. claude 는 herdr 가 PATH 에서 찾습니다.";

const RELEASE_NOTE: &str = "프로젝트 메뉴에 「릴리즈」를 더합니다. 누르면 그 프로젝트의 새 대화를 열어 Claude 가 릴리즈합니다. 처음에는 저장소를 읽어 릴리즈 절차를 .claude/skills/release/SKILL.md 로 적고 보여 준 뒤 실행하고, 다음부터는 /release 로 그 절차를 그대로 돕니다. 권한 모드는 다른 새 대화와 같습니다.";

/// 릴리즈 절차를 적어 두는 저장소 스킬. 대화에서 /release 로 부르고, 터미널 claude 도 같은 절차를 쓴다.
pub const RELEASE_SKILL: &str = ".claude/skills/release/SKILL.md";

/// 절차가 아직 없을 때 보내는 글. 특정 저장소의 파일 이름을 넣지 않는다 — 어느 저장소에서나 같은 글로 파악하게.
const RELEASE_DISCOVER: &str = "\
이 저장소를 릴리즈해 줘. 아직 적어 둔 릴리즈 절차가 없으니 먼저 파악해서 적고, 그다음 실행해.

1. 저장소를 읽고 릴리즈 절차를 파악해. CI 워크플로(.github/workflows 등)의 릴리즈 조건 · 버전이 적힌 파일(여럿이면 모두) · 변경 기록(CHANGELOG 등)의 꼴 · 태그 이름 규칙 · 기준 가지 · 원격 · 릴리즈 노트를 만드는 스크립트를 본다. README 의 릴리즈 절도 본다.
2. 파악한 절차를 `.claude/skills/release/SKILL.md` 에 Claude Code 스킬로 적어. 머리말에 `name: release` 와 언제 쓰는지 한 줄(description)을 두고, 본문에 점검 → 다음 버전 고르기 → 버전 올리기 → 변경 기록 쓰기 → 커밋 → 태그 → push 순서와 각 단계의 명령 · 고칠 파일을 적는다. 다음 버전은 사용자에게 선택지로 묻고, 태그 · push 처럼 되돌리기 어려운 단계 앞에서는 선택지로 확인받는다는 규칙도 넣는다.
3. 적은 절차를 짧게 보여 주고, 그대로 실행해도 되는지 선택지로 물어.
4. 허락하면 그 절차대로 실행해. 실패하면 멈추고 무엇이 왜 막혔는지 알려 줘.";

/// 앱이 싣는 코어 플러그인. 미리 만들어 둘 플러그인은 여기에 한 줄씩 더한다.
pub fn manifests() -> Vec<Manifest> {
	vec![
		Manifest {
			id: "herdr".into(),
			name: "herdr".into(),
			version: "1.0.0".into(),
			api_version: manifest::API_VERSION,
			description: HERDR_NOTE.into(),
			permissions: vec!["process:herdr".into()],
			contributes: Contributes { terminal: Some(terminal::herdr()), ..Default::default() },
			..Default::default()
		},
		Manifest {
			id: "release".into(),
			name: "릴리즈".into(),
			version: "1.0.0".into(),
			api_version: manifest::API_VERSION,
			description: RELEASE_NOTE.into(),
			contributes: Contributes {
				menus: vec![Menu { place: "project".into(), command: "release".into(), label: "릴리즈".into(), when: String::new() }],
				..Default::default()
			},
			..Default::default()
		},
	]
}

pub fn is_core(id: &str) -> bool {
	manifests().iter().any(|m| m.id == id)
}

/* ---------- 메뉴 ---------- */

/// 코어 플러그인의 메뉴를 앱이 직접 답한다. 코어에는 wasm 이 없다.
pub fn command(store: &Store, id: &str, command: &str, project_id: &str) -> std::result::Result<Reply, String> {
	match (id, command) {
		("release", "release") => {
			let p = store.project(project_id).map_err(|e| e.to_string())?;
			if project_id == GLOBAL_PID {
				return Err("프로젝트에서만 릴리즈합니다".into());
			}
			Ok(release_reply(Path::new(&p.path)))
		}
		_ => Err(format!("그런 메뉴가 없습니다: {command}")),
	}
}

/// 절차 스킬이 있으면 /release 를, 없으면 파악 · 기록 · 실행을 시키는 글을 새 대화로 보낸다.
fn release_reply(root: &Path) -> Reply {
	let text = if root.join(RELEASE_SKILL).is_file() { "/release".to_string() } else { RELEASE_DISCOVER.to_string() };
	Reply { chat: Some(ChatReply { text }), ..Default::default() }
}

/* ---------- 정리 ---------- */

/// 코어와 id 가 같은 plugins/<id>/ · plugins/<id>.json 을 내용을 따지지 않고 휴지통으로 옮기고, 코어가 쓰지 않는 허락을 지운다.
/// 켜기(enabledPlugins)는 그대로 둔다. id 가 같아 켜 둔 사용자는 코어로 이어진다. 옮기지 못한 것은 오류 글로 돌려준다.
/// 옮기는 것은 디스크에서 코어로 넘어온 id(RETIRED)뿐이다. 처음부터 코어였던 것(릴리즈)과 id 가 같은 커뮤니티 플러그인은 지우지 않고 목록에서 쉬게 둔다.
pub fn retire(root: &Path, s: &mut Settings, trash: impl Fn(&Path, &str) -> Result<PathBuf>) -> Vec<String> {
	let mut errors = Vec::new();
	for id in RETIRED {
		for p in [dir(root).join(id), dir(root).join(format!("{id}.json"))] {
			if p.exists()
				&& let Err(e) = trash(&p, &format!("플러그인-{id}"))
			{
				errors.push(format!("{}: {e}", p.display()));
			}
		}
		s.plugin_grants.remove(*id);
	}
	errors
}

/// 디스크 플러그인이었다가 코어로 옮긴 id
const RETIRED: &[&str] = &["herdr"];

/// 시작할 때 한 번 부른다. 실패해도 앱은 뜬다 — 남은 파일은 목록에서 「같은 id 의 플러그인이 앞에 있습니다」로 쉬고 코어가 쓰인다.
pub fn retire_on_start(store: &Store) {
	let Ok(mut s) = store.settings() else { return };
	let before = s.plugin_grants.len();
	for e in retire(&store.root, &mut s, |p, label| store.trash(p, label)) {
		eprintln!("코어 플러그인과 겹치는 파일을 옮기지 못함: {e}");
	}
	if s.plugin_grants.len() != before
		&& let Err(e) = store.save_settings(&s)
	{
		eprintln!("코어 플러그인의 허락을 지우지 못함: {e}");
	}
}

/* ---------- 시험 ---------- */

#[cfg(test)]
mod tests {
	use super::*;
	use std::cell::RefCell;
	use std::fs;

	#[test]
	fn core_manifests_pass_check() {
		for m in manifests() {
			let problem = manifest::check_core(&m, true, &mut std::collections::HashSet::new());
			assert_eq!(problem, "", "{}", m.id);
		}
	}

	#[test]
	fn release_sends_skill_when_written_else_discovery() {
		let r = std::env::temp_dir().join(format!("docket-release-{}", crate::model::short_id()));
		fs::create_dir_all(&r).unwrap();
		let text = |r: &Path| release_reply(r).chat.unwrap().text;
		let first = text(&r);
		assert!(first.contains(RELEASE_SKILL) && first.contains("선택지"), "절차가 없으면 파악 · 기록을 시킨다");
		fs::create_dir_all(r.join(".claude/skills/release")).unwrap();
		fs::write(r.join(RELEASE_SKILL), "---\nname: release\n---\n").unwrap();
		assert_eq!(text(&r), "/release");
		fs::remove_dir_all(&r).unwrap();
	}

	#[test]
	fn retire_moves_old_herdr_files_and_drops_grants() {
		let r = std::env::temp_dir().join(format!("docket-core-{}", crate::model::short_id()));
		let d = dir(&r);
		fs::create_dir_all(d.join("herdr")).unwrap();
		fs::write(d.join("herdr").join(super::super::MANIFEST), "{}").unwrap();
		fs::write(d.join("herdr.json"), r#"{ "exe": "herdr", "launch": ["손으로 고친 인자"] }"#).unwrap();
		fs::create_dir_all(d.join("other")).unwrap();
		let mut s = Settings {
			enabled_plugins: vec!["herdr".into()],
			plugin_grants: [("herdr".to_string(), vec!["process:herdr".to_string()]), ("other".to_string(), vec![])].into(),
			..Default::default()
		};
		let moved = RefCell::new(Vec::new());
		let errors = retire(&r, &mut s, |p, label| {
			moved.borrow_mut().push(label.to_string());
			if p.is_dir() { fs::remove_dir_all(p)? } else { fs::remove_file(p)? }
			Ok(p.to_path_buf())
		});
		assert!(errors.is_empty());
		assert_eq!(moved.borrow().len(), 2, "손으로 고친 옛 정의도 옮긴다");
		assert!(!d.join("herdr").exists() && !d.join("herdr.json").exists());
		assert!(d.join("other").exists(), "코어와 id 가 다른 것은 건드리지 않는다");
		assert_eq!(s.enabled_plugins, vec!["herdr"], "켜기는 그대로 둔다");
		assert!(!s.plugin_grants.contains_key("herdr") && s.plugin_grants.contains_key("other"));
		fs::remove_dir_all(&r).unwrap();
	}
}
