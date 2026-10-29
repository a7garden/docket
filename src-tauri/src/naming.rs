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

/// 8자리 날짜(19xx · 20xx, 달 · 날이 말이 되는 것)인지.
fn is_date(c: &[char], i: usize) -> bool {
	let Some(s) = c.get(i..i + 8) else { return false };
	if !s.iter().all(|x| x.is_ascii_digit()) || !matches!((s[0], s[1]), ('1', '9') | ('2', '0')) {
		return false;
	}
	let num = |a: usize| (s[a] as u32 - '0' as u32) * 10 + (s[a + 1] as u32 - '0' as u32);
	(1..=12).contains(&num(4)) && (1..=31).contains(&num(6))
}

/// 4자리 시각(HHMM)인지.
fn is_time(c: &[char], i: usize) -> bool {
	let Some(s) = c.get(i..i + 4) else { return false };
	if !s.iter().all(|x| x.is_ascii_digit()) {
		return false;
	}
	let num = |a: usize| (s[a] as u32 - '0' as u32) * 10 + (s[a + 1] as u32 - '0' as u32);
	num(0) < 24 && num(2) < 60
}

fn digit_at(c: &[char], i: usize) -> bool {
	c.get(i).is_some_and(|x| x.is_ascii_digit())
}

/// 받은 파일 이름에서 규칙을 거꾸로 짐작한다. 예: `요구사항_v3_20261001.hwpx` → `{제목}_v{판}_{날짜}`.
/// 판 · 날짜 자리가 하나도 없으면 규칙이라 할 것이 없어 None 이다.
/// 제목은 산출물 제목이 이름에 그대로 있으면 그것, 아니면 자리표를 걷고 남은 글이 한 덩어리일 때만 그것으로 본다.
/// 덩어리가 여럿이면 어디가 제목인지 알 수 없어 짐작하지 않는다 — 틀린 규칙을 넣는 것보다 비워 두는 편이 낫다.
pub fn infer(file_name: &str, title: &str, project: &str) -> Option<String> {
	let stem = std::path::Path::new(file_name).file_stem()?.to_string_lossy().to_string();
	let c: Vec<char> = stem.chars().collect();
	let mut toks: Vec<(usize, usize, String)> = Vec::new();
	let mut i = 0;
	while i < c.len() {
		let edge = i == 0 || !c[i - 1].is_alphanumeric();
		if edge && is_date(&c, i) && !digit_at(&c, i + 8) {
			toks.push((i, i + 8, "{날짜}".into()));
			i += 8;
			if c.get(i).is_some_and(|x| matches!(x, '_' | '-' | ' ')) && is_time(&c, i + 1) && !digit_at(&c, i + 5) {
				toks.push((i + 1, i + 5, "{시각}".into()));
				i += 5;
			}
			continue;
		}
		if edge && matches!(c[i], 'v' | 'V') && digit_at(&c, i + 1) {
			let mut j = i + 1;
			while digit_at(&c, j) {
				j += 1;
			}
			if j == c.len() || !c[j].is_alphanumeric() {
				toks.push((i, j, format!("{}{{판}}", c[i])));
				i = j;
				continue;
			}
		}
		i += 1;
	}
	if toks.is_empty() {
		return None;
	}

	// (자리표인가, 글) 조각으로 나눈다
	let mut pieces: Vec<(bool, String)> = Vec::new();
	let mut last = 0;
	for (s, e, t) in toks {
		pieces.push((false, c[last..s].iter().collect()));
		pieces.push((true, t));
		last = e;
	}
	pieces.push((false, c[last..].iter().collect()));

	let project = project.trim();
	if !project.is_empty() {
		for p in pieces.iter_mut().filter(|p| !p.0) {
			p.1 = p.1.replace(project, "{프로젝트}");
		}
	}
	let title = title.trim();
	let variants = [title.to_string(), title.split_whitespace().collect::<Vec<_>>().join("_")];
	let mut titled = false;
	'outer: for p in pieces.iter_mut().filter(|p| !p.0) {
		for t in variants.iter().filter(|t| !t.is_empty()) {
			if p.1.contains(t.as_str()) {
				p.1 = p.1.replacen(t.as_str(), "{제목}", 1);
				titled = true;
				break 'outer;
			}
		}
	}
	if !titled {
		let core = |s: &str| s.trim_matches(|x: char| "_- .".contains(x)).to_string();
		let cands: Vec<usize> = pieces
			.iter()
			.enumerate()
			.filter(|(_, p)| !p.0 && { let k = core(&p.1); !k.is_empty() && !k.contains('{') })
			.map(|(i, _)| i)
			.collect();
		let [only] = cands[..] else { return None };
		let k = core(&pieces[only].1);
		pieces[only].1 = pieces[only].1.replacen(&k, "{제목}", 1);
	}
	Some(pieces.into_iter().map(|p| p.1).collect())
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

	#[test]
	fn infers_rules_from_file_names() {
		assert_eq!(infer("요구사항_v3_20261001.hwpx", "", "calc").as_deref(), Some("{제목}_v{판}_{날짜}"));
		assert_eq!(infer("calc_함수 설명서_20261028_1430.md", "함수 설명서", "calc").as_deref(), Some("{프로젝트}_{제목}_{날짜}_{시각}"));
		assert_eq!(infer("테이블 정의서 V2.xlsx", "", "").as_deref(), Some("{제목} V{판}"));
		// 제목 안의 숫자는 날짜 · 판으로 보지 않는다
		assert_eq!(infer("2026 연차보고_v2.docx", "", "").as_deref(), Some("{제목}_v{판}"));
		// 판 · 날짜가 없거나 제목 덩어리가 여럿이면 짐작하지 않는다
		assert_eq!(infer("회의록.docx", "회의록", ""), None);
		assert_eq!(infer("가_v1_나_20261001.md", "", ""), None);
		assert_eq!(infer("보고서_20261399.md", "", ""), None);
	}
}
