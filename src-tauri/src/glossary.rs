//! 어휘 사전. 프로젝트마다 용어 · 뜻 · 비슷한 말을 적어 두면 계획 · 대화 · 구현 · 산출물 작성 때 프롬프트에 붙인다.
//!
//! - 용어 목록은 projects/<pid>/glossary.json 에, 켜기와 함께 쓸 프로젝트는 Project.glossary 에 둔다.
//! - 다른 프로젝트의 사전은 복사하지 않고 실행 때마다 읽는다. 참조는 한 단계만 따라간다 — 서로 참조해도 돌고 돌지 않게.
//! - 같은 용어가 여럿이면 이 프로젝트의 것이 앞서고, 다른 프로젝트끼리는 고른 차례가 앞선다.
//! - 찾기 없이 사전 전체를 넘긴다. Claude 가 메모에 없는 용어를 코드에서 만나도 알게 하려는 것이다.
//!   상한을 넘으면 메모 · 질문에 나온 용어를 먼저 넣는다.
//!
//! 목차
//! 1. 합치기
//! 2. 프롬프트 블록 · 찾는 말 넓히기
//! 3. 화면에 보내는 모양

use serde::Serialize;

use crate::error::Result;
use crate::model::*;
use crate::store::Store;

/// 프롬프트에 붙이는 용어 블록의 상한(글자). 계획 형식 · 규칙을 가리지 않게 한다.
const BLOCK_MAX: usize = 8_000;

/* ---------- 1. 합치기 ---------- */

/// 합친 용어 하나. from 은 다른 프로젝트 것일 때 그 이름이다. 이 프로젝트 것이면 비어 있다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Merged {
	#[serde(flatten)]
	pub entry: GlossaryEntry,
	pub from: String,
}

fn key(s: &str) -> String {
	s.trim().to_lowercase()
}

/// 이 프로젝트 사전과 함께 쓰는 다른 프로젝트 사전을 합친다. 지워진 프로젝트는 건너뛴다.
pub fn merged(store: &Store, p: &Project) -> Vec<Merged> {
	let mut out: Vec<Merged> = store.glossary(&p.id).entries.into_iter().map(|entry| Merged { entry, from: String::new() }).collect();
	if p.glossary.include.is_empty() {
		return out;
	}
	let projects = store.projects().unwrap_or_default();
	for id in &p.glossary.include {
		let Some(other) = projects.iter().find(|x| &x.id == id && x.id != p.id) else { continue };
		for entry in store.glossary(id).entries {
			if !out.iter().any(|m| key(&m.entry.term) == key(&entry.term)) {
				out.push(Merged { entry, from: other.name.clone() });
			}
		}
	}
	out
}

/// query 에 용어나 비슷한 말이 나오는지. 한글은 조사가 붙으므로 낱말 단위가 아니라 글자 포함으로 본다.
fn mentioned(m: &Merged, query: &str) -> bool {
	std::iter::once(&m.entry.term).chain(m.entry.aliases.iter()).map(|s| key(s)).any(|s| !s.is_empty() && query.contains(&s))
}

/* ---------- 2. 프롬프트 블록 · 찾는 말 넓히기 ---------- */

fn line(m: &Merged) -> String {
	let mut s = format!("- **{}**", m.entry.term.trim());
	if !m.entry.meaning.trim().is_empty() {
		s.push_str(&format!(" — {}", m.entry.meaning.trim().replace('\n', " ")));
	}
	if !m.entry.aliases.is_empty() {
		s.push_str(&format!(" (비슷한 말: {})", m.entry.aliases.join(" · ")));
	}
	if !m.from.is_empty() {
		s.push_str(&format!(" [「{}」 사전]", m.from));
	}
	s.push('\n');
	s
}

/// 프롬프트에 붙이는 용어 블록과 붙인 용어 이름. 비어 있으면 빈 글이다.
/// 상한을 넘으면 query 에 나온 용어를 먼저 넣고 나머지는 적힌 차례로 채운다.
pub fn prompt_block(list: &[Merged], query: &str) -> (String, Vec<String>) {
	if list.is_empty() {
		return (String::new(), Vec::new());
	}
	let q = key(query);
	let (hit, rest): (Vec<&Merged>, Vec<&Merged>) = list.iter().partition(|m| mentioned(m, &q));
	let mut s = String::from(
		"## 이 프로젝트의 용어\n\
		사용자가 적어 둔 어휘 사전이다. 메모 · 코드 · 문서의 말을 이 뜻으로 읽고, 답에서도 이 용어를 쓴다. 「비슷한 말」은 같은 것을 가리키는 다른 표현이다.\n\n",
	);
	let mut used = Vec::new();
	let mut left = 0;
	for m in hit.into_iter().chain(rest) {
		let one = line(m);
		if s.chars().count() + one.chars().count() > BLOCK_MAX {
			left += 1;
			continue;
		}
		s.push_str(&one);
		used.push(if m.from.is_empty() { m.entry.term.trim().to_string() } else { format!("{} · {}", m.entry.term.trim(), m.from) });
	}
	if left > 0 {
		s.push_str(&format!("\n(사전이 길어 {left}개는 넣지 못했다)\n"));
	}
	(s, used)
}

/// 지식베이스 찾기에 쓸 말. query 에 나온 용어의 이름과 비슷한 말을 덧붙인다 — 문서가 다른 말로 적었어도 찾게 한다.
pub fn expand_query(list: &[Merged], query: &str) -> String {
	let q = key(query);
	let mut extra: Vec<&str> = Vec::new();
	for m in list.iter().filter(|m| mentioned(m, &q)) {
		extra.push(m.entry.term.trim());
		extra.extend(m.entry.aliases.iter().map(|a| a.trim()));
	}
	if extra.is_empty() { query.to_string() } else { format!("{query}\n{}", extra.join(" ")) }
}

/* ---------- 3. 화면에 보내는 모양 ---------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OtherProject {
	pub id: String,
	pub name: String,
	pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlossaryView {
	pub glossary: ProjectGlossary,
	/// 저장할 때 돌려받아 다른 화면이 먼저 저장했는지 가린다
	pub updated_at: i64,
	pub entries: Vec<GlossaryEntry>,
	/// 고를 수 있는 다른 프로젝트 (이름 · 용어 수)
	pub others: Vec<OtherProject>,
	/// 다른 프로젝트에서 함께 쓰는 용어. 이 프로젝트에 같은 용어가 있어 가려진 것은 빠진다.
	pub shared: Vec<Merged>,
}

pub fn view(store: &Store, pid: &str) -> Result<GlossaryView> {
	let p = store.project(pid)?;
	let file = store.glossary(pid);
	let others = store
		.projects()?
		.into_iter()
		.filter(|x| x.id != pid)
		.map(|x| OtherProject { count: store.glossary(&x.id).entries.len(), id: x.id, name: x.name })
		.collect();
	let shared = merged(store, &p).into_iter().filter(|m| !m.from.is_empty()).collect();
	Ok(GlossaryView { glossary: p.glossary, updated_at: file.updated_at, entries: file.entries, others, shared })
}

#[cfg(test)]
mod tests {
	use super::*;

	fn m(term: &str, aliases: &[&str], from: &str) -> Merged {
		Merged { entry: GlossaryEntry { term: term.into(), meaning: "뜻".into(), aliases: aliases.iter().map(|a| a.to_string()).collect() }, from: from.into() }
	}

	#[test]
	fn mentioned_terms_come_first_and_aliases_expand_query() {
		let list = vec![m("사전검토", &[], ""), m("회신", &["결과 통보"], "다른")];
		let (block, used) = prompt_block(&list, "결과 통보 화면을 고친다");
		assert_eq!(used, vec!["회신 · 다른".to_string(), "사전검토".to_string()]);
		assert!(block.contains("[「다른」 사전]"));
		let q = expand_query(&list, "회신을 보낸다");
		assert!(q.contains("결과 통보"));
		assert_eq!(expand_query(&list, "상관없는 말"), "상관없는 말");
	}

	#[test]
	fn block_respects_limit() {
		let long = "가".repeat(900);
		let list: Vec<Merged> = (0..20).map(|i| Merged { entry: GlossaryEntry { term: format!("용어{i}"), meaning: long.clone(), aliases: vec![] }, from: String::new() }).collect();
		let (block, used) = prompt_block(&list, "");
		assert!(block.chars().count() <= BLOCK_MAX + 40);
		assert!(used.len() < 20);
		assert!(block.contains("넣지 못했다"));
	}
}
