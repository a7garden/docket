//! 산출물 파일 이름 규칙. 프로젝트마다 기본 규칙을 두고 산출물마다 바꿀 수 있다.
//!
//! 쓸 수 있는 자리표: {제목} {판} {날짜} {시각} {프로젝트}
//! 예: `{제목}_v{판}_{날짜}` → `함수_설명서_v3_20261028.md`

use crate::store::safe_file_name;

pub const DEFAULT: &str = "{제목}_v{판}_{날짜}";

pub struct Ctx<'a> {
	pub title: &'a str,
	pub project: &'a str,
	pub n: u32,
}

/// 확장자는 규칙 밖에서 붙인다. 같은 규칙으로 .md 와 .hwpx 를 모두 만든다.
pub fn apply(pattern: &str, ctx: &Ctx, ext: &str, underscore: bool) -> String {
	let pattern = if pattern.trim().is_empty() { DEFAULT } else { pattern.trim() };
	let now = chrono::Local::now();
	let title = if ctx.title.trim().is_empty() { "산출물" } else { ctx.title.trim() };
	let mut name = pattern
		.replace("{제목}", title)
		.replace("{판}", &ctx.n.to_string())
		.replace("{날짜}", &now.format("%Y%m%d").to_string())
		.replace("{시각}", &now.format("%H%M").to_string())
		.replace("{프로젝트}", ctx.project.trim());
	if underscore {
		name = name.split_whitespace().collect::<Vec<_>>().join("_");
	}
	let name = safe_file_name(&name, "산출물");
	let ext = ext.trim_start_matches('.');
	if ext.is_empty() { name } else { format!("{name}.{ext}") }
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn fills_tokens_and_replaces_spaces() {
		let ctx = Ctx { title: "함수 설명서", project: "calc", n: 3 };
		let name = apply("{제목}_v{판}", &ctx, "md", true);
		assert_eq!(name, "함수_설명서_v3.md");
		assert_eq!(apply("{프로젝트} {제목}", &ctx, "", false), "calc 함수 설명서");
		assert!(apply("", &ctx, "hwpx", true).starts_with("함수_설명서_v3_"));
	}
}
