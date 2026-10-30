//! 구현 하나를 본 작업트리 밖의 git 워크트리에서 돌린다.
//!
//! - 프로젝트 설정에서 켠 프로젝트만 쓴다. 저장소가 크면 워크트리를 만드는 것 자체가 무거워서 프로젝트마다 고른다.
//! - 켠 프로젝트에서도 구현이 줄을 서야 할 때만 쓴다(runner::wait_turn). 겹치지 않으면 지금처럼 본 작업트리에서 돈다.
//! - 바탕은 HEAD 가 아니라 지금 작업트리다. 커밋하지 않은 변경 · 새 파일까지 임시 인덱스로 찍어 커밋 하나로 만든다.
//!   사용자 인덱스는 건드리지 않는다 — 스테이징해 둔 것이 흐트러지지 않게.
//! - 반영은 사람이 결과 확인 때 누른다. 파일마다 3-way 로 합쳐 보고, 하나라도 충돌하면 아무것도 쓰지 않는다.
//! - 반영하거나 되돌리면 지운다. 구현마다 새로 만든다.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::error::{Error, Result, msg};
use crate::model::{now_ms, short_id};

fn git(dir: &Path) -> Command {
	let mut c = Command::new("git");
	// 한글 파일 이름을 \352... 로 감싸지 않게 한다. 감싸면 경로를 다시 풀어야 한다.
	c.arg("-C").arg(dir).args(["-c", "core.quotepath=false"]);
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
	}
	c
}

fn bytes(mut c: Command) -> Result<Vec<u8>> {
	let o = c.output().map_err(|e| Error::Msg(format!("git 을 실행하지 못했습니다: {e}")))?;
	if !o.status.success() {
		return msg(format!("git: {}", String::from_utf8_lossy(&o.stderr).trim()));
	}
	Ok(o.stdout)
}

fn text(c: Command) -> Result<String> {
	Ok(String::from_utf8_lossy(&bytes(c)?).trim_end().to_string())
}

fn norm(p: &Path) -> String {
	// 실제 경로로 풀어 견준다. git 은 긴 실제 경로를 주므로 정션 · 8.3 짧은 이름으로 연 폴더가 다른 곳으로 보인다.
	let p = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
	p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// 프로젝트 폴더가 git 저장소의 맨 위다. 하위 폴더를 프로젝트로 연 경우는 워크트리 안 상대 경로가 어긋나 쓰지 않는다.
pub fn available(root: &Path) -> bool {
	let mut c = git(root);
	c.args(["rev-parse", "--show-toplevel"]);
	text(c).is_ok_and(|top| norm(Path::new(&top)) == norm(root))
}

/// 저장소 옆 `<이름>.worktrees/<번호>`. 저장소 안에 두면 빌드 · 검색 도구가 사본까지 훑는다.
pub fn dest(root: &Path, number: u32) -> PathBuf {
	let name = root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "repo".into());
	let base = root.parent().unwrap_or(root).join(format!("{name}.worktrees"));
	let mut p = base.join(number.to_string());
	let mut n = 1;
	while p.exists() {
		n += 1;
		p = base.join(format!("{number}-{n}"));
	}
	p
}

/// 지금 작업트리(커밋하지 않은 변경 · 새 파일 포함, .gitignore 는 따른다)를 커밋 하나로 찍는다.
/// 진짜 인덱스를 복사해 쓰므로 git 이 이미 아는 파일은 다시 읽지 않는다 — 처음부터 찍으면 파일을 모두 해시한다.
fn snapshot(root: &Path) -> Result<String> {
	let tmp = std::env::temp_dir().join(format!("docket-index-{}-{}", std::process::id(), short_id()));
	let index = {
		let mut c = git(root);
		c.args(["rev-parse", "--path-format=absolute", "--git-path", "index"]);
		PathBuf::from(text(c)?)
	};
	let run = |args: &[&str]| -> Result<String> {
		let mut c = git(root);
		c.env("GIT_INDEX_FILE", &tmp).args(args);
		text(c)
	};
	let made = (|| {
		if index.is_file() {
			std::fs::copy(&index, &tmp)?;
		} else {
			run(&["read-tree", "HEAD"])?;
		}
		run(&["add", "-A"])?;
		let tree = run(&["write-tree"])?;
		// 사용자 이름 · 메일을 정하지 않은 PC 에서도 찍히게 이 커밋에만 이름을 준다. 브랜치에 올리지 않는 커밋이다.
		run(&["-c", "user.name=docket", "-c", "user.email=docket@localhost", "commit-tree", &tree, "-p", "HEAD", "-m", "docket: 워크트리 바탕 (작업트리 사본)"])
	})();
	let _ = std::fs::remove_file(&tmp);
	made.map_err(|e| Error::Msg(format!("작업트리를 찍지 못했습니다 (커밋이 하나도 없는 저장소는 쓸 수 없습니다): {e}")))
}

/// 워크트리를 만들고 바탕 커밋을 돌려준다.
pub fn create(root: &Path, at: &Path) -> Result<String> {
	let base = snapshot(root)?;
	let mut c = git(root);
	c.args(["worktree", "add", "--detach"]).arg(at).arg(&base);
	bytes(c)?;
	Ok(base)
}

/// 바탕에서 바뀐 파일. (A · M · D, 저장소 기준 경로)
pub fn changed(wt: &Path, base: &str) -> Result<Vec<(char, String)>> {
	let mut c = git(wt);
	c.args(["add", "-A"]);
	bytes(c)?;
	let mut c = git(wt);
	c.args(["diff", "--cached", "--name-status", "--no-renames", "-z", base]);
	let out = String::from_utf8_lossy(&bytes(c)?).to_string();
	let parts: Vec<&str> = out.split('\0').filter(|s| !s.is_empty()).collect();
	Ok(parts.chunks(2).filter(|p| p.len() == 2).filter_map(|p| p[0].chars().next().map(|s| (s, p[1].to_string()))).collect())
}

/// 바탕 커밋의 파일을 작업트리에 꺼낼 때의 모양으로 읽는다. autocrlf · 필터를 거쳐야 디스크의 파일과 견줄 수 있다.
fn base_file(root: &Path, base: &str, rel: &str) -> Result<Vec<u8>> {
	let mut c = git(root);
	c.args(["cat-file", "--filters"]).arg(format!("{base}:{rel}"));
	bytes(c)
}

/// 세 판을 합친다. 충돌하면 None.
fn merge3(ours: &[u8], base: &[u8], theirs: &[u8]) -> Result<Option<Vec<u8>>> {
	let dir = std::env::temp_dir().join(format!("docket-merge-{}", short_id()));
	std::fs::create_dir_all(&dir)?;
	let (o, b, t) = (dir.join("ours"), dir.join("base"), dir.join("theirs"));
	std::fs::write(&o, ours)?;
	std::fs::write(&b, base)?;
	std::fs::write(&t, theirs)?;
	let mut c = Command::new("git");
	c.args(["merge-file", "-p"]).arg(&o).arg(&b).arg(&t);
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		c.creation_flags(0x0800_0000);
	}
	let out = c.output();
	let _ = std::fs::remove_dir_all(&dir);
	let out = out?;
	// 종료 코드가 충돌 수다. 음수(오류)도 합치지 못한 것으로 친다.
	Ok((out.status.code() == Some(0)).then_some(out.stdout))
}

pub struct Applied {
	/// 본 작업트리에 쓰거나 지운 파일 (저장소 기준)
	pub files: Vec<String>,
}

/// 워크트리에서 바뀐 파일을 본 작업트리에 옮긴다. 하나라도 합치지 못하면 아무것도 쓰지 않고 그 파일들을 돌려준다.
/// 본 작업트리가 바탕과 같으면 워크트리 것을 그대로, 다르면 3-way 로 합친다 — 그 사이에 본 작업트리에서 끝난 구현을 지키려는 것이다.
pub fn apply(root: &Path, wt: &Path, base: &str) -> Result<std::result::Result<Applied, Vec<String>>> {
	let mut plan: Vec<(String, Option<Vec<u8>>)> = Vec::new();
	let mut conflicts = Vec::new();
	for (st, rel) in changed(wt, base)? {
		let theirs = if st == 'D' { None } else { Some(std::fs::read(wt.join(&rel))?) };
		let base_v = if st == 'A' { None } else { Some(base_file(root, base, &rel)?) };
		let ours = std::fs::read(root.join(&rel)).ok();
		if ours == theirs {
			continue;
		}
		if ours == base_v {
			plan.push((rel, theirs));
			continue;
		}
		match (&ours, &base_v, &theirs) {
			(Some(o), Some(b), Some(t)) => match merge3(o, b, t)? {
				Some(m) => plan.push((rel, Some(m))),
				None => conflicts.push(rel),
			},
			_ => conflicts.push(rel),
		}
	}
	if !conflicts.is_empty() {
		return Ok(Err(conflicts));
	}
	let mut files = Vec::new();
	for (rel, content) in plan {
		let p = root.join(&rel);
		match content {
			Some(b) => {
				if let Some(d) = p.parent() {
					std::fs::create_dir_all(d)?;
				}
				std::fs::write(&p, b)?;
			}
			None => {
				let _ = std::fs::remove_file(&p);
			}
		}
		files.push(rel);
	}
	Ok(Ok(Applied { files }))
}

/// 워크트리를 지운다. git 이 못 지우면(파일이 잠겨 있는 등) 폴더를 지우고 기록만 정리한다.
pub fn remove(root: &Path, wt: &Path) {
	let mut c = git(root);
	c.args(["worktree", "remove", "--force"]).arg(wt);
	if bytes(c).is_err() {
		let _ = std::fs::remove_dir_all(wt);
		let mut c = git(root);
		c.args(["worktree", "prune"]);
		let _ = bytes(c);
	}
	// 마지막 워크트리였으면 `<이름>.worktrees` 도 치운다. 비어 있지 않으면 지워지지 않는다.
	if let Some(parent) = wt.parent() {
		let _ = std::fs::remove_dir(parent);
	}
}

/// 이슈에 적어 두는 워크트리. 반영 · 되돌리기 때 이것으로 찾는다.
pub fn record(path: &Path, base: String) -> crate::model::Worktree {
	crate::model::Worktree { path: path.to_string_lossy().to_string(), base, at: now_ms() }
}

#[cfg(test)]
mod tests {
	use super::*;

	fn sh(dir: &Path, args: &[&str]) {
		let mut c = git(dir);
		c.args(args);
		bytes(c).unwrap();
	}

	/// 같은 폴더를 다른 경로(정션 · 8.3 짧은 이름)로 열어도 저장소 맨 위로 본다.
	#[cfg(windows)]
	#[test]
	fn available_sees_through_other_paths() {
		let base = std::env::temp_dir().join(format!("docket-wt-{}", short_id()));
		let root = base.join("repo");
		std::fs::create_dir_all(&root).unwrap();
		sh(&root, &["init", "-q"]);
		let link = base.join("link");
		let made = std::process::Command::new("cmd").args(["/c", "mklink", "/J"]).arg(&link).arg(&root).output().unwrap();
		assert!(made.status.success());
		assert!(available(&root));
		assert!(available(&link));
		std::fs::remove_dir(&link).ok();
		std::fs::remove_dir_all(&base).ok();
	}

	/// 커밋하지 않은 변경까지 바탕에 들고, 그 사이 본 작업트리에서 바뀐 것은 합쳐 지키며, 충돌하면 아무것도 쓰지 않는다.
	#[test]
	fn create_apply_remove() {
		let root = std::env::temp_dir().join(format!("docket-wt-{}", short_id())).join("repo");
		std::fs::create_dir_all(&root).unwrap();
		sh(&root, &["init", "-q"]);
		sh(&root, &["config", "core.autocrlf", "false"]);
		std::fs::write(root.join("a.txt"), "1\n2\n3\n4\n5\n").unwrap();
		std::fs::write(root.join("c.txt"), "c\n").unwrap();
		sh(&root, &["add", "-A"]);
		sh(&root, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
		// 커밋하지 않은 변경과 새 파일
		std::fs::write(root.join("c.txt"), "c2\n").unwrap();
		std::fs::write(root.join("new.txt"), "new\n").unwrap();
		assert!(available(&root));

		let at = dest(&root, 7);
		let base = create(&root, &at).unwrap();
		assert_eq!(std::fs::read_to_string(at.join("c.txt")).unwrap(), "c2\n", "커밋하지 않은 변경이 바탕에 든다");
		assert!(at.join("new.txt").is_file(), "새 파일도 든다");
		let staged = { let mut c = git(&root); c.args(["diff", "--cached", "--name-only"]); text(c).unwrap() };
		assert!(staged.is_empty(), "사용자 인덱스를 건드렸다");

		// 워크트리: a 의 첫 줄 · 새 파일 · 지우기. 본 작업트리: a 의 끝 줄 (그 사이 끝난 다른 구현)
		std::fs::write(at.join("a.txt"), "1x\n2\n3\n4\n5\n").unwrap();
		std::fs::write(at.join("b.txt"), "b\n").unwrap();
		std::fs::remove_file(at.join("new.txt")).unwrap();
		std::fs::write(root.join("a.txt"), "1\n2\n3\n4\n5x\n").unwrap();
		let done = apply(&root, &at, &base).unwrap().ok().unwrap();
		assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "1x\n2\n3\n4\n5x\n", "두 수정이 합쳐진다");
		assert_eq!(std::fs::read_to_string(root.join("b.txt")).unwrap(), "b\n");
		assert!(!root.join("new.txt").exists());
		assert_eq!(done.files.len(), 3);

		// 같은 줄을 서로 다르게 고치면 충돌 — 아무것도 쓰지 않는다
		std::fs::write(at.join("c.txt"), "wt\n").unwrap();
		std::fs::write(at.join("d.txt"), "d\n").unwrap();
		std::fs::write(root.join("c.txt"), "main\n").unwrap();
		assert_eq!(apply(&root, &at, &base).unwrap().err(), Some(vec!["c.txt".to_string()]));
		assert!(!root.join("d.txt").exists(), "충돌이 있으면 다른 파일도 쓰지 않는다");

		remove(&root, &at);
		assert!(!at.exists());
		let _ = std::fs::remove_dir_all(root.parent().unwrap());
	}
}
