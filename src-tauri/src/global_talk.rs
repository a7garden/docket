//! 앱 대화 — 어느 프로젝트에도 묶이지 않고 이 앱 자체(플러그인 · 설정 · 기록)를 다루는 대화.
//!
//! 앱 데이터 폴더에서 돈다(Store::global_project). 사용자는 설치한 앱만 쓰므로 소스 저장소는 열지 않는다.
//! 플러그인을 짜는 데 필요한 안내(README 「플러그인」 구획 · 타입 파일)는 빌드할 때 실행 파일에 넣어 첫 프롬프트에 싣는다.
//! 문서를 복사해 두지 않는다 — 같은 안내가 두 곳에 생기면 한쪽이 낡는다.

use std::path::Path;

use crate::model::*;
use crate::store::Store;

const README: &str = include_str!("../../README.md");
const PLUGIN_TYPES: &str = include_str!("../../examples/plugins/docket-plugin.d.ts");

/// issue_prompt 가 남겨 두는 자리. 실행이 Store 를 들고 채운다 — 프롬프트 함수는 Store 를 모른다.
pub const CONTEXT_SLOT: &str = "<<앱 데이터 안내>>";

/// 고칠 수 있게 보낸 차례 전에 남기는 설정 사본 수. 오래된 것부터 지운다.
const BACKUPS_KEEP: usize = 10;

/// README 의 「## 플러그인」부터 다음 같은 단계 머리 전까지.
fn plugin_section() -> &'static str {
	let Some(start) = README.find("\n## 플러그인") else { return "" };
	let rest = &README[start + 1..];
	let end = rest[3..].find("\n## ").map_or(rest.len(), |i| i + 3);
	rest[..end].trim()
}

/// 앱 대화 첫 프롬프트에 싣는 안내. 폴더 구조 · 프로젝트 목록 · 지킬 것 · 플러그인 안내.
pub fn context(store: &Store) -> String {
	let root = store.root.display();
	let mut projects = String::new();
	for p in store.projects().unwrap_or_default() {
		projects.push_str(&format!("- {} — 저장소 {} · 앱 데이터 projects/{}/\n", p.name, p.path, p.id));
	}
	if projects.is_empty() {
		projects.push_str("- (등록한 프로젝트가 없다)\n");
	}
	format!(
		"## 앱 데이터 폴더 ({root})
```text
settings.json · projects.json        앱 설정 · 등록한 프로젝트
projects/<pid>/issues/<iid>/         메모(이슈) · 프로젝트 대화: issue.json · note.md · attachments/ · runs/<실행>.jsonl
projects/<pid>/deliverables/<did>/   산출물
projects/<pid>/kb/ · glossary.json   지식베이스 · 어휘 사전
global/issues/<id>/                  앱 대화 (지금 이 대화도 여기 있다)
global/work/                         앱 대화의 작업 폴더 (빌드 · 시험용)
global/backup/                       고칠 수 있게 보낸 차례 전에 앱이 남긴 설정 사본
plugins/<id>/plugin.json · *.wasm    플러그인
plugins-data/<id>/                   플러그인의 설정 칸 값 · 저장소 · 기록
trash/                               지운 것
```

## 등록한 프로젝트
{projects}
## 지킬 것
- 이 앱의 소스 코드는 여기 없다. 사용자는 설치한 앱을 쓴다. 앱을 고쳐 달라고 하면 플러그인 · 설정으로 할 수 있는 길을 찾고, 없으면 그렇다고 답한다.
- settings.json · projects.json · issue.json 은 앱이 읽고 쓰는 파일이다. 고치기 전에 무엇을 왜 바꾸는지 답에 적는다.
- 실행 중인 이슈(issue.json 에 run 이 있는 것)와 지금 이 대화의 issue.json 은 고치지 않는다. 실행이 끝날 때 앱이 덮어쓴다.
- 플러그인은 plugins/<id>/ 에 만든다. 켜기와 권한 허락은 사용자가 설정 › 플러그인에서 한다. settings.json 의 enabledPlugins · pluginGrants 를 직접 고치지 않는다.
- 코드 플러그인(.wasm)을 빌드하려면 extism-js · binaryen 같은 도구가 이 PC 에 있어야 한다. 없으면 설치 방법을 알려 주고, 코드 없이 되는 기여(terminal · settings)로 되면 그 길도 알린다. 빌드는 global/work/ 에서 한다.
- 커밋 · push · SVN 쓰기 같은 버전 관리 명령을 실행하지 않는다.

## 플러그인 안내
{}

### 타입 (docket-plugin.d.ts)
```ts
{}
```",
		plugin_section(),
		PLUGIN_TYPES.trim()
	)
}

/// 고칠 수 있게 보낸 앱 대화가 돌기 전에 설정 두 파일을 남긴다. 잘못 고쳐도 되돌릴 수 있게 하려는 것이다.
/// 남기지 못해도 실행은 막지 않는다 — 처음 켠 앱처럼 파일이 아직 없을 수도 있다.
pub fn backup(store: &Store, run_id: &str) {
	let dir = store.root.join("global").join("backup");
	let to = dir.join(format!("{}-{run_id}", chrono::Local::now().format("%Y%m%d-%H%M%S")));
	if std::fs::create_dir_all(&to).is_err() {
		return;
	}
	for name in ["settings.json", "projects.json"] {
		let from = store.root.join(name);
		if from.is_file() {
			let _ = std::fs::copy(&from, to.join(name));
		}
	}
	prune(&dir);
}

fn prune(dir: &Path) {
	let Ok(rd) = std::fs::read_dir(dir) else { return };
	let mut names: Vec<_> = rd.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).map(|e| e.path()).collect();
	names.sort();
	let extra = names.len().saturating_sub(BACKUPS_KEEP);
	for p in names.into_iter().take(extra) {
		let _ = std::fs::remove_dir_all(p);
	}
}

/// 앱 대화가 쓰는 작업 폴더를 미리 만든다. 프롬프트가 가리키는 자리가 없으면 Claude 가 헤맨다.
pub fn prepare(store: &Store) {
	let _ = std::fs::create_dir_all(store.project_dir(GLOBAL_PID).join("work"));
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn plugin_section_is_cut_from_readme() {
		let s = plugin_section();
		assert!(s.starts_with("## 플러그인"), "구획 머리를 못 찾았다");
		assert!(!s.contains("\n## 개발"), "다음 구획까지 실었다");
		assert!(s.contains("### 권한"), "하위 구획을 잘랐다");
	}
}
