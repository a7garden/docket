//! 코어 플러그인: 앱에 들어 있어 파일 없이 늘 목록에 있는 플러그인. 설정 › 플러그인에서 켜고 끄기만 한다.
//!
//! - 커뮤니티 플러그인(plugins/ 폴더에서 읽는 것)보다 앞에 싣는다. 켠 터미널 플러그인이 둘이면 앞의 것을 쓰므로 코어가 먼저 쓰인다.
//! - 권한 허락을 받지 않는다. 허락은 설치한 뒤 파일만 바꿔 권한을 몰래 늘리지 못하게 하려는 것인데(mod.rs missing),
//!   코어의 매니페스트는 앱 안에 있어 파일로 바꿀 수 없다.
//! - 지우거나 같은 id 로 설치하지 못한다 (install.rs).
//! - 2026.10.29 : 「herdr 정의 만들기」로 만들던 plugins/herdr · plugins/herdr.json 을 코어로 옮겼다. 남은 파일은 시작할 때 휴지통으로 옮긴다 (retire).
//!
//! 구획: 정의 · 정리 · 시험

use std::path::{Path, PathBuf};

use super::manifest::{self, Contributes, Manifest};
use super::{dir, terminal};
use crate::error::Result;
use crate::model::Settings;
use crate::store::Store;

/* ---------- 정의 ---------- */

const HERDR_NOTE: &str = "켜 둔 herdr 에 이슈마다 새 탭 「#번호 제목」을 만들어 claude --resume 으로 세션을 잇습니다. 그 세션이 이미 떠 있으면 그 탭으로 옮깁니다. herdr 가 꺼져 있으면 Windows 터미널에 띄운 뒤 붙입니다. claude 는 herdr 가 PATH 에서 찾습니다.";

/// 앱이 싣는 코어 플러그인. 미리 만들어 둘 플러그인은 여기에 한 줄씩 더한다.
pub fn manifests() -> Vec<Manifest> {
	vec![Manifest {
		id: "herdr".into(),
		name: "herdr".into(),
		version: "1.0.0".into(),
		api_version: manifest::API_VERSION,
		description: HERDR_NOTE.into(),
		permissions: vec!["process:herdr".into()],
		contributes: Contributes { terminal: Some(terminal::herdr()), ..Default::default() },
		..Default::default()
	}]
}

pub fn is_core(id: &str) -> bool {
	manifests().iter().any(|m| m.id == id)
}

/* ---------- 정리 ---------- */

/// 코어와 id 가 같은 plugins/<id>/ · plugins/<id>.json 을 내용을 따지지 않고 휴지통으로 옮기고, 코어가 쓰지 않는 허락을 지운다.
/// 켜기(enabledPlugins)는 그대로 둔다. id 가 같아 켜 둔 사용자는 코어로 이어진다. 옮기지 못한 것은 오류 글로 돌려준다.
pub fn retire(root: &Path, s: &mut Settings, trash: impl Fn(&Path, &str) -> Result<PathBuf>) -> Vec<String> {
	let mut errors = Vec::new();
	for m in manifests() {
		for p in [dir(root).join(&m.id), dir(root).join(format!("{}.json", m.id))] {
			if p.exists()
				&& let Err(e) = trash(&p, &format!("플러그인-{}", m.id))
			{
				errors.push(format!("{}: {e}", p.display()));
			}
		}
		s.plugin_grants.remove(&m.id);
	}
	errors
}

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
			let problem = manifest::check(&m, false, true, &mut std::collections::HashSet::new());
			assert_eq!(problem, "", "{}", m.id);
		}
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
