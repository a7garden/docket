//! 산출물 작성법 뽑기. 템플릿 · 참고 자료 · 지난 판을 읽고 작성법 · 어휘 · 형식 · 템플릿 · 이름 규칙을 「만드는 법」 칸에 넣는다.
//!
//! - 이름 규칙 · 템플릿 · 형식은 파일 이름과 확장자만 보면 되므로 앱이 먼저 정한다(local_fill). Claude 를 부르지 않는다.
//!   글을 읽어야 아는 작성법 · 어휘만 Claude 가 맡는다.
//! - 뽑은 값은 빈 칸에만 바로 넣고, 값이 있는 칸은 draft 에 제안으로 둔다. 사용자가 적는 작성 지침(guide)은 건드리지 않는다.
//! - 호출은 quick_call(도구 없음 · 세션 남기지 않음)이고, 모델은 산출물 작성과 같은 구현 모델이다.
//!   글자를 프롬프트에 실어 보내 저장소를 읽지 않으므로 프로젝트 실행 줄에 서지 않는다. 동시에 둘까지만 돈다.
//! - 뽑은 것은 앱 데이터(산출물의 meta.json)에만 둔다. 프로젝트 폴더 · ~/.claude 에는 아무것도 쓰지 않는다.
//!
//! 목차
//! 1. 앱이 정하는 것 (템플릿 · 형식 · 이름 규칙)
//! 2. 재료 모으기
//! 3. 부르기 · 답 읽기 · 합치기
//! 4. 시작 · 제안 적용

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::error::{Error, Result, msg};
use crate::extract;
use crate::model::*;
use crate::runner::{self, emit_deliverable};
use crate::store::Store;

/// 템플릿으로 삼는 형식. Claude 가 그 형식의 스킬로 「복사해 채우는」 쪽을 고를 수 있는 것만 둔다.
pub const TEMPLATE_EXTS: &[&str] = &["hwpx", "docx", "xlsx", "pptx"];
/// 파일 하나 · 전체에서 넘길 글자 상한. 양식은 앞부분에 구성이 다 드러나고, 다 넘기면 호출이 비싸진다.
const PER_FILE: usize = 12_000;
const TOTAL: usize = 40_000;
/// 어휘를 받는 상한. 너무 많으면 쓸 때 프롬프트만 길어진다.
const VOCAB_MAX: usize = 40;

static SLOTS: LazyLock<tokio::sync::Semaphore> = LazyLock::new(|| tokio::sync::Semaphore::new(2));

const SYSTEM: &str = "너는 문서 양식과 견본을 읽고, 같은 종류의 문서를 다시 쓸 사람이 따를 작성법을 정리한다. 한국어로 쓰고, 요청한 JSON 하나만 답한다.";

fn key(s: &str) -> String {
	s.trim().to_lowercase()
}

pub fn is_template(name: &str) -> bool {
	TEMPLATE_EXTS.contains(&extract::ext_of(name).as_str())
}

/* ---------- 1. 앱이 정하는 것 ---------- */

/// 템플릿 · 형식 · 이름 규칙을 파일 이름만 보고 채운다. 빈 칸은 바로 채우고, 값이 다르면 draft 에 둔다.
/// refs 는 refs/ 안 파일 이름이다. 지운 파일을 가리키던 템플릿은 비우고 다른 오피스 파일을 고른다.
pub fn local_fill(d: &mut Deliverable, refs: &[String], project: Option<&Project>) {
	if !d.template.is_empty() && !refs.contains(&d.template) {
		d.template.clear();
	}
	if !d.draft.template.is_empty() && !refs.contains(&d.draft.template) {
		d.draft.template.clear();
	}
	if d.template.is_empty()
		&& let Some(t) = refs.iter().find(|r| is_template(r))
	{
		d.template = t.clone();
	}
	if !d.template.is_empty() {
		let ext = extract::ext_of(&d.template);
		if d.format.is_empty() {
			d.format = ext;
		} else if d.format != ext {
			d.draft.format = ext;
		}
	}

	// 가져온 판의 이름이 그 산출물을 실제로 부르던 이름이라 먼저 보고, 없으면 템플릿 · 자료 이름을 본다.
	let names = d.versions.iter().filter(|v| v.source == "import").map(|v| v.file.clone()).chain(refs.iter().cloned());
	let project_name = project.map(|p| p.name.as_str()).unwrap_or("");
	let Some(rule) = names.into_iter().find_map(|n| crate::naming::infer(&n, &d.title, project_name)) else { return };
	if d.naming.is_empty() {
		let base = project.map(|p| p.naming.trim()).filter(|s| !s.is_empty()).unwrap_or(crate::naming::DEFAULT);
		// 프로젝트 규칙과 같으면 비워 두어 프로젝트 규칙을 따르게 둔다.
		if rule != base {
			d.naming = rule;
		}
	} else if d.naming != rule {
		d.draft.naming = rule;
	}
}

/// 저장된 산출물에 local_fill 을 걸어 쓴다.
pub fn fill_saved(store: &Store, pid: &str, did: &str) -> Result<DeliverableView> {
	let refs: Vec<String> = store.list_refs(pid, did).into_iter().map(|r| r.name).collect();
	let project = store.project(pid).ok();
	store.update_deliverable(pid, did, |d| {
		local_fill(d, &refs, project.as_ref());
		Ok(())
	})
}

/* ---------- 2. 재료 모으기 ---------- */

/// 읽을 파일 하나. text 가 있으면 앱이 뽑아 둔 글자 사본이다.
struct Source {
	label: String,
	path: PathBuf,
	text: Option<PathBuf>,
}

fn clip(s: &str, n: usize) -> String {
	let s = s.trim();
	if s.chars().count() <= n {
		return s.to_string();
	}
	let mut out: String = s.chars().take(n).collect();
	out.push_str("\n…(뒤는 줄였다)");
	out
}

/// 파일마다 글자를 읽어 하나로 묶는다. 읽은 글자가 하나도 없으면 None 이다.
fn gather(sources: &[Source]) -> Option<String> {
	let mut out = String::new();
	let mut any = false;
	for s in sources {
		let text = match &s.text {
			Some(t) => std::fs::read_to_string(t).map_err(|e| e.to_string()),
			None => extract::text_of(&s.path),
		};
		let left = TOTAL.saturating_sub(out.chars().count());
		match text {
			Ok(t) if !t.trim().is_empty() && left > 500 => {
				out.push_str(&format!("\n### {}\n{}\n", s.label, clip(&t, PER_FILE.min(left))));
				any = true;
			}
			Ok(t) if !t.trim().is_empty() => out.push_str(&format!("\n### {}\n(길이 상한에 걸려 싣지 못했다)\n", s.label)),
			_ => out.push_str(&format!("\n### {}\n(글자를 읽지 못했다. 이름만 참고한다)\n", s.label)),
		}
	}
	any.then_some(out)
}

fn sources(store: &Store, pid: &str, v: &DeliverableView) -> Vec<Source> {
	let refs = Path::new(&v.dir).join("refs");
	let mut out: Vec<Source> = v
		.refs
		.iter()
		.filter(|r| r.kind != "none" && !runner::IMAGE_EXT.contains(&extract::ext_of(&r.name).as_str()))
		.map(|r| Source {
			label: format!("[{}] {}", if r.template { "템플릿" } else { "참고 자료" }, r.name),
			path: refs.join(&r.name),
			text: (!r.text_path.is_empty()).then(|| PathBuf::from(&r.text_path)),
		})
		.collect();
	// 템플릿을 맨 앞에 둔다. 상한에 걸려도 양식은 실리게.
	out.sort_by_key(|s| !s.label.starts_with("[템플릿]"));
	if let Some(last) = v.deliverable.versions.last()
		&& let Ok(path) = store.version_path(pid, &v.deliverable.id, last.n)
	{
		out.push(Source { label: format!("[지난 판 v{}] {}", last.n, last.file), path, text: None });
	}
	out
}

/* ---------- 3. 부르기 · 답 읽기 · 합치기 ---------- */

fn prompt(v: &DeliverableView, material: &str, known: &[String]) -> String {
	let d = &v.deliverable;
	let names: Vec<&str> = v.refs.iter().map(|r| r.name.as_str()).collect();
	let mut s = format!(
		"아래는 산출물 「{}」 의 템플릿 · 참고 자료 · 지난 판에서 뽑은 글자다. 같은 종류의 문서를 다음에 다시 쓸 사람이 따를 작성법을 정리한다.\n\
		JSON 객체 하나만 답한다. 설명 · 코드 블록 없이.\n\n\
		{{\"skill\": \"…\", \"vocab\": [{{\"term\": \"…\", \"avoid\": [\"…\"], \"note\": \"…\"}}], \"format\": \"…\", \"template\": \"…\"}}\n\n\
		- skill: 마크다운. 「## 구성」(목차 · 절 차례 · 표가 있으면 열 이름) · 「## 담는 것」(절마다 무엇을 쓰는지) · 「## 문체」(말투 · 문장 끝) · 「## 표기」(숫자 · 날짜 · 단위 · 번호 매기기) 를 글에서 확인한 만큼만 쓴다. \
		문서의 사실(값 · 이름 · 날짜)을 옮기지 말고 쓰는 방법만 적는다. 확인하지 못한 절은 뺀다.\n\
		- vocab: 이 문서가 일관되게 쓰는 전문 용어 · 고유 명칭. 같은 것을 다르게 부른 흔적이 있으면 덜 쓰인 쪽을 avoid 에 넣는다. 흔한 낱말은 넣지 않는다. {VOCAB_MAX}개 안쪽. note 는 뜻 한 줄(모르면 빈칸).\n\
		- format: 결과 파일 확장자 하나 (hwpx · docx · xlsx · pptx · md 가운데). 견본이 오피스 파일이면 그 형식이다.\n\
		- template: 아래 파일 가운데 빈칸을 채워 쓰는 양식으로 쓸 파일 이름 하나. 없으면 빈칸.\n\
		  파일: {}\n",
		if d.title.trim().is_empty() { "(제목 없음)" } else { d.title.trim() },
		if names.is_empty() { "(없음)".to_string() } else { names.join(" · ") },
	);
	if !known.is_empty() {
		s.push_str(&format!("- 프로젝트 어휘 사전에 이미 있는 말은 vocab 에 넣지 않는다: {}\n", known.join(" · ")));
	}
	if !d.guide.trim().is_empty() {
		s.push_str(&format!("\n## 사용자가 적은 작성 지침 (참고만 한다. skill 에 옮겨 적지 않는다)\n{}\n", clip(&d.guide, 2000)));
	}
	s.push_str(&format!("\n## 파일 글자\n{material}"));
	s
}

/// Claude 가 뽑은 값.
#[derive(Debug, Default)]
struct Learned {
	skill: String,
	vocab: Vec<Term>,
	format: String,
	template: String,
}

/// avoid 를 배열 대신 「a · b」 글로 답해도 받는다.
fn strings(v: Option<&Value>) -> Vec<String> {
	match v {
		Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
		Some(Value::String(s)) => s.split(['·', ',', '/']).map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect(),
		_ => Vec::new(),
	}
}

fn read_answer(text: &str) -> Option<Learned> {
	let v = crate::kb::json_in(text)?;
	let field = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
	let vocab = v
		.get("vocab")
		.and_then(|x| x.as_array())
		.map(|a| {
			a.iter()
				.filter_map(|t| {
					let term = t.get("term").and_then(|x| x.as_str())?.trim().to_string();
					(!term.is_empty()).then(|| Term { term, avoid: strings(t.get("avoid")), note: t.get("note").and_then(|x| x.as_str()).unwrap_or("").trim().to_string() })
				})
				.take(VOCAB_MAX)
				.collect()
		})
		.unwrap_or_default();
	Some(Learned { skill: field("skill"), vocab, format: field("format").trim_start_matches('.').to_lowercase(), template: field("template") })
}

/// Claude 의 답을 칸에 합친다. known 은 프로젝트 사전에 이미 있는 말(소문자)이다.
fn merge(d: &mut Deliverable, got: Learned, refs: &[String], known: &[String]) {
	if !got.skill.is_empty() {
		if d.skill.trim().is_empty() {
			d.skill = got.skill;
		} else if d.skill.trim() != got.skill.trim() {
			d.draft.skill = got.skill;
		}
	}
	let have: Vec<String> = d.vocab.iter().map(|t| key(&t.term)).collect();
	let mut fresh: Vec<Term> = Vec::new();
	for t in got.vocab {
		let k = key(&t.term);
		if !have.contains(&k) && !known.contains(&k) && !fresh.iter().any(|f| key(&f.term) == k) {
			fresh.push(t);
		}
	}
	if d.vocab.is_empty() {
		d.vocab = fresh;
	} else {
		d.draft.vocab = fresh;
	}
	if !got.template.is_empty() && refs.contains(&got.template) {
		if d.template.is_empty() {
			d.template = got.template;
		} else if d.template != got.template {
			d.draft.template = got.template;
		}
	}
	// 템플릿이 있으면 형식은 템플릿을 따른다(local_fill). Claude 의 짐작으로 엇갈리게 두지 않는다.
	if d.template.is_empty() && !got.format.is_empty() && got.format.chars().all(|c| c.is_ascii_alphanumeric()) {
		if d.format.is_empty() {
			d.format = got.format;
		} else if d.format != got.format {
			d.draft.format = got.format;
		}
	}
}

async fn learn(app: &AppHandle, pid: &str, did: &str) -> Result<()> {
	let store = app.state::<Store>();
	let settings = store.settings()?;
	let project = store.project(pid)?;
	let view = fill_saved(&store, pid, did)?;
	emit_deliverable(app, &view);

	let srcs = sources(&store, pid, &view);
	let material = tokio::task::spawn_blocking(move || gather(&srcs)).await.map_err(|e| Error::Msg(e.to_string()))?;
	let Some(material) = material else {
		return msg("템플릿 · 참고 자료 · 판에서 글자를 읽지 못해 작성법을 뽑지 못했습니다. 이름 규칙 · 형식 · 템플릿만 정했습니다.");
	};
	// 사전이 꺼져 있으면 작성 때 붙지 않으므로, 그 말도 이 산출물 어휘로 받아 둔다.
	let known: Vec<String> =
		if project.glossary.enabled { crate::glossary::merged(&store, &project).into_iter().map(|m| key(&m.entry.term)).filter(|k| !k.is_empty()).collect() } else { Vec::new() };
	let exe = runner::resolve_claude(&settings.claude_path).ok_or_else(|| Error::Msg("claude 실행 파일을 찾지 못했습니다. 설정에서 경로를 지정하세요.".into()))?;
	let dir = PathBuf::from(&view.dir);
	let model = runner::pick_model(&settings, "", RunKind::Document).to_string();
	let (answer, cost) = runner::quick_call(exe, (pid, "learn"), &model, SYSTEM, prompt(&view, &material, &known), &dir, dir.join("learn.last.jsonl"), 300)
		.await
		.ok_or_else(|| Error::Msg("작성법 뽑기 호출이 실패했습니다. 산출물 폴더의 learn.last.jsonl 에 응답이 남아 있습니다.".into()))?;
	let got = read_answer(&answer);
	let read = got.is_some();
	let refs: Vec<String> = store.list_refs(pid, did).into_iter().map(|r| r.name).collect();
	let v = store.update_deliverable(pid, did, |d| {
		d.learn_cost_usd += cost;
		if let Some(got) = got {
			merge(d, got, &refs, &known);
			d.learned_at = now_ms();
		}
		Ok(())
	})?;
	emit_deliverable(app, &v);
	if !read {
		return msg("작성법 답을 읽지 못했습니다. 산출물 폴더의 learn.last.jsonl 을 보세요.");
	}
	Ok(())
}

/* ---------- 4. 시작 · 제안 적용 ---------- */

/// 뽑기를 뒤에서 돌린다. 이미 뽑는 중이면 그대로 둔다.
pub fn start(app: &AppHandle, pid: &str, did: &str) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	let run_id = short_id();
	let view = store.update_deliverable(pid, did, |d| {
		if d.learn.is_some() {
			return msg("이미 작성법을 뽑는 중입니다");
		}
		d.learn = Some(LearnJob { run_id: run_id.clone(), started_at: now_ms() });
		d.learn_error.clear();
		d.draft = RecipeDraft::default();
		Ok(())
	})?;
	emit_deliverable(app, &view);
	let (app, pid, did) = (app.clone(), pid.to_string(), did.to_string());
	tauri::async_runtime::spawn(async move {
		let res = {
			let _permit = SLOTS.acquire().await;
			learn(&app, &pid, &did).await
		};
		let err = res.err().map(|e| e.to_string()).unwrap_or_default();
		if let Ok(v) = app.state::<Store>().update_deliverable(&pid, &did, |d| {
			// 그사이 다시 뽑기를 시작했으면 그쪽 상태를 지우지 않는다.
			if d.learn.as_ref().is_some_and(|j| j.run_id == run_id) {
				d.learn = None;
				d.learn_error = err;
			}
			Ok(())
		}) {
			emit_deliverable(&app, &v);
		}
	});
	Ok(view)
}

/// 파일을 넣거나 산출물을 등록한 뒤 부른다. 템플릿 · 형식 · 이름 규칙은 늘 채우고, 설정이 켜져 있고 learn 이면 작성법도 뽑는다.
pub fn after_files(app: &AppHandle, pid: &str, did: &str, learn: bool) -> Result<DeliverableView> {
	let store = app.state::<Store>();
	let v = fill_saved(&store, pid, did)?;
	if learn && store.settings().map(|s| s.recipe_auto).unwrap_or(false) && v.deliverable.learn.is_none() {
		return start(app, pid, did);
	}
	emit_deliverable(app, &v);
	Ok(v)
}

/// 제안 하나를 적용하거나 버린다. field: skill · vocab · format · naming · template · all
pub fn apply_draft(d: &mut Deliverable, field: &str, apply: bool) -> Result<()> {
	let fields: &[&str] = if field == "all" { &["skill", "vocab", "format", "naming", "template"] } else { std::slice::from_ref(&field) };
	for f in fields {
		let dr = &mut d.draft;
		match *f {
			"skill" if apply && !dr.skill.is_empty() => d.skill = std::mem::take(&mut dr.skill),
			"skill" => dr.skill.clear(),
			"vocab" if apply => d.vocab.append(&mut dr.vocab),
			"vocab" => dr.vocab.clear(),
			"format" if apply && !dr.format.is_empty() => d.format = std::mem::take(&mut dr.format),
			"format" => dr.format.clear(),
			"naming" if apply && !dr.naming.is_empty() => d.naming = std::mem::take(&mut dr.naming),
			"naming" => dr.naming.clear(),
			"template" if apply && !dr.template.is_empty() => {
				d.template = std::mem::take(&mut dr.template);
				// 템플릿을 바꾸면 형식도 따라간다.
				d.format = extract::ext_of(&d.template);
				dr.format.clear();
			}
			"template" => dr.template.clear(),
			other => return msg(format!("모르는 칸입니다: {other}")),
		}
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn t(term: &str) -> Term {
		Term { term: term.into(), ..Default::default() }
	}

	#[test]
	fn local_fill_picks_template_format_and_naming() {
		let mut d = Deliverable { title: "요구사항".into(), ..Default::default() };
		let refs = vec!["메모.txt".to_string(), "요구사항_v3_20261001.hwpx".to_string()];
		local_fill(&mut d, &refs, None);
		assert_eq!(d.template, "요구사항_v3_20261001.hwpx");
		assert_eq!(d.format, "hwpx");
		// 기본 규칙과 같으면 비워 둔다
		assert_eq!(d.naming, "");

		// 값이 있는 칸은 제안으로 둔다
		let mut d = Deliverable { title: "요구사항".into(), naming: "{제목}".into(), format: "docx".into(), ..Default::default() };
		local_fill(&mut d, &["요구사항 v2.hwpx".to_string()], None);
		assert_eq!(d.naming, "{제목}");
		assert_eq!(d.draft.naming, "{제목} v{판}");
		assert_eq!(d.draft.format, "hwpx");

		// 지운 템플릿은 비운다
		let mut d = Deliverable { template: "없음.docx".into(), ..Default::default() };
		local_fill(&mut d, &["메모.txt".to_string()], None);
		assert_eq!(d.template, "");
	}

	#[test]
	fn answer_is_read_and_merged_without_overwriting() {
		let a = read_answer("```json\n{\"skill\":\"## 구성\\n1. 개요\",\"vocab\":[{\"term\":\"사전검토\",\"avoid\":\"사전 검토 · 사검\"},{\"term\":\"회신\"},{\"term\":\" \"}],\"format\":\".DOCX\",\"template\":\"양식.docx\"}\n```").unwrap();
		assert_eq!(a.vocab.len(), 2);
		assert_eq!(a.vocab[0].avoid, vec!["사전 검토", "사검"]);
		assert_eq!(a.format, "docx");

		let refs = vec!["양식.docx".to_string()];
		let mut d = Deliverable::default();
		merge(&mut d, a, &refs, &["회신".into()]);
		assert!(d.skill.starts_with("## 구성"));
		assert_eq!(d.vocab, vec![Term { term: "사전검토".into(), avoid: vec!["사전 검토".into(), "사검".into()], note: String::new() }]);
		assert_eq!(d.template, "양식.docx");
		// 템플릿이 정해졌으면 형식은 Claude 답으로 정하지 않는다
		assert_eq!(d.format, "");

		let mut d = Deliverable { skill: "내 작성법".into(), vocab: vec![t("사전검토")], ..Default::default() };
		merge(&mut d, Learned { skill: "새 작성법".into(), vocab: vec![t("사전검토"), t("재해위험성")], ..Default::default() }, &[], &[]);
		assert_eq!(d.skill, "내 작성법");
		assert_eq!(d.draft.skill, "새 작성법");
		assert_eq!(d.draft.vocab, vec![t("재해위험성")]);

		apply_draft(&mut d, "all", true).unwrap();
		assert_eq!(d.skill, "새 작성법");
		assert_eq!(d.vocab.len(), 2);
		assert!(d.draft.skill.is_empty() && d.draft.vocab.is_empty());
		assert!(apply_draft(&mut d, "모름", true).is_err());
	}
}
