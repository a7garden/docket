//! 템플릿 · 참고 자료에서 글자를 뽑는다.
//!
//! Claude 의 Read 도구는 docx · xlsx · pptx · hwpx 를 읽지 못한다. 이 형식들은 zip 안의 XML 이라
//! 글 조각(t) · 문단(p) · 칸(tc) · 행(row) 경계만 따라가면 본문이 나온다. 뽑은 글은 refs/.text/ 에 두고 Claude 가 그것을 읽는다.
//! 서식(글꼴 · 칸 너비)은 따라오지 않는다. 구성과 문구를 따르게 하는 데에는 그만큼이면 된다.

use std::fs::File;
use std::io::Read;
use std::path::Path;

const MAX_CHARS: usize = 300_000;

pub fn ext_of(name: &str) -> String {
	Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// direct: Claude 가 그대로 읽는다 · extract: 앱이 글자를 뽑아 둔다 · none: 읽을 길이 없다
pub fn kind(name: &str) -> &'static str {
	match ext_of(name).as_str() {
		"docx" | "xlsx" | "pptx" | "hwpx" => "extract",
		"md" | "markdown" | "txt" | "csv" | "tsv" | "json" | "yaml" | "yml" | "xml" | "html" | "htm" | "sql" | "pdf" | "png" | "jpg"
		| "jpeg" | "gif" | "webp" | "bmp" => "direct",
		_ => "none",
	}
}

enum Ev<'a> {
	Open(&'a str, &'a str),
	Close(&'a str),
	Empty(&'a str, &'a str),
	Text(&'a str),
}

/// 태그 이름에서 접두사(w: · a: · hp:)를 떼고 넘긴다. 속성 안의 '>' 는 이 형식들이 &gt; 로 적으므로 따로 다루지 않는다.
fn scan(xml: &str, mut f: impl FnMut(Ev)) {
	let mut i = 0;
	while i < xml.len() {
		if xml.as_bytes()[i] == b'<' {
			let Some(end) = xml[i..].find('>').map(|e| i + e) else { break };
			let inner = &xml[i + 1..end];
			i = end + 1;
			if inner.starts_with('?') || inner.starts_with('!') {
				continue;
			}
			let closing = inner.starts_with('/');
			let empty = inner.ends_with('/');
			let body = inner.trim_start_matches('/').trim_end_matches('/');
			let qname = body.split(char::is_whitespace).next().unwrap_or("");
			let local = qname.rsplit(':').next().unwrap_or(qname);
			f(if closing {
				Ev::Close(local)
			} else if empty {
				Ev::Empty(local, body)
			} else {
				Ev::Open(local, body)
			});
		} else {
			let next = xml[i..].find('<').map(|n| i + n).unwrap_or(xml.len());
			f(Ev::Text(&xml[i..next]));
			i = next;
		}
	}
}

fn unescape(s: &str) -> String {
	if !s.contains('&') {
		return s.to_string();
	}
	let mut out = String::with_capacity(s.len());
	let mut rest = s;
	while let Some(p) = rest.find('&') {
		out.push_str(&rest[..p]);
		let r = &rest[p..];
		if let Some(semi) = r.find(';').filter(|&k| k <= 10) {
			let ent = &r[1..semi];
			let ch = match ent {
				"lt" => Some('<'),
				"gt" => Some('>'),
				"amp" => Some('&'),
				"quot" => Some('"'),
				"apos" => Some('\''),
				_ if ent.starts_with("#x") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
				_ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
				_ => None,
			};
			if let Some(c) = ch {
				out.push(c);
				rest = &r[semi + 1..];
				continue;
			}
		}
		out.push('&');
		rest = &r[1..];
	}
	out.push_str(rest);
	out
}

fn attr<'a>(body: &'a str, key: &str) -> Option<&'a str> {
	let pat = format!(" {key}=\"");
	let start = body.find(&pat)? + pat.len();
	let len = body[start..].find('"')?;
	Some(&body[start..start + len])
}

/// docx · pptx · hwpx 의 본문. 표 칸 안의 문단은 빈칸으로 잇고 칸은 탭, 행은 줄로 나눈다.
fn flow_text(xml: &str) -> String {
	let mut out = String::new();
	let mut in_t = false;
	let mut cell = 0usize;
	scan(xml, |ev| match ev {
		Ev::Open("t", _) => in_t = true,
		Ev::Close("t") => in_t = false,
		Ev::Open("tc", _) => cell += 1,
		Ev::Close("tc") => {
			cell = cell.saturating_sub(1);
			out.push('\t');
		}
		Ev::Close("tr") => out.push('\n'),
		Ev::Close("p") => out.push(if cell > 0 { ' ' } else { '\n' }),
		Ev::Empty("tab", _) => out.push('\t'),
		Ev::Empty("br", _) | Ev::Empty("lineBreak", _) => out.push('\n'),
		Ev::Text(s) if in_t => out.push_str(&unescape(s)),
		_ => {}
	});
	out
}

fn entry(zip: &mut zip::ZipArchive<File>, name: &str) -> Option<String> {
	let mut f = zip.by_name(name).ok()?;
	let mut s = String::new();
	f.read_to_string(&mut s).ok()?;
	Some(s)
}

/// 이름 끝의 번호 순서로 고른다. slide10 이 slide2 앞에 오지 않게 한다.
fn numbered(zip: &zip::ZipArchive<File>, prefix: &str, suffix: &str) -> Vec<String> {
	let mut names: Vec<(u32, String)> = zip
		.file_names()
		.filter(|n| n.starts_with(prefix) && n.ends_with(suffix))
		.filter_map(|n| n[prefix.len()..n.len() - suffix.len()].parse::<u32>().ok().map(|k| (k, n.to_string())))
		.collect();
	names.sort();
	names.into_iter().map(|(_, n)| n).collect()
}

fn xlsx_text(zip: &mut zip::ZipArchive<File>) -> String {
	let mut shared = Vec::new();
	if let Some(xml) = entry(zip, "xl/sharedStrings.xml") {
		let (mut cur, mut in_t, mut in_rph) = (String::new(), false, false);
		scan(&xml, |ev| match ev {
			Ev::Open("si", _) => cur.clear(),
			Ev::Close("si") => shared.push(std::mem::take(&mut cur)),
			Ev::Open("rPh", _) => in_rph = true,
			Ev::Close("rPh") => in_rph = false,
			Ev::Open("t", _) => in_t = true,
			Ev::Close("t") => in_t = false,
			Ev::Text(s) if in_t && !in_rph => cur.push_str(&unescape(s)),
			_ => {}
		});
	}
	let mut sheet_names = Vec::new();
	if let Some(xml) = entry(zip, "xl/workbook.xml") {
		scan(&xml, |ev| {
			if let Ev::Empty("sheet", body) | Ev::Open("sheet", body) = ev {
				sheet_names.push(attr(body, "name").map(unescape).unwrap_or_default());
			}
		});
	}
	let mut out = String::new();
	for (i, name) in numbered(zip, "xl/worksheets/sheet", ".xml").iter().enumerate() {
		let Some(xml) = entry(zip, name) else { continue };
		out.push_str(&format!("## {}\n", sheet_names.get(i).cloned().unwrap_or_else(|| format!("시트 {}", i + 1))));
		let (mut kind, mut val, mut in_v, mut in_t, mut row) = (String::new(), String::new(), false, false, String::new());
		scan(&xml, |ev| match ev {
			Ev::Open("c", body) => {
				kind = attr(body, "t").unwrap_or("").to_string();
				val.clear();
			}
			Ev::Close("c") => {
				let shown = if kind == "s" { val.trim().parse::<usize>().ok().and_then(|k| shared.get(k).cloned()).unwrap_or_default() } else { val.clone() };
				row.push_str(shown.replace(['\t', '\n'], " ").trim());
				row.push('\t');
			}
			Ev::Open("v", _) => in_v = true,
			Ev::Close("v") => in_v = false,
			Ev::Open("t", _) => in_t = true,
			Ev::Close("t") => in_t = false,
			Ev::Text(s) if in_v || in_t => val.push_str(&unescape(s)),
			Ev::Close("row") => {
				let line = row.trim_end_matches('\t');
				if !line.trim().is_empty() {
					out.push_str(line);
					out.push('\n');
				}
				row.clear();
			}
			_ => {}
		});
		out.push('\n');
	}
	out
}

/// 빈 줄이 겹겹이 쌓이지 않게 다듬고 너무 길면 자른다.
fn tidy(s: String) -> String {
	let mut out = String::new();
	let mut blank = 0;
	for line in s.lines() {
		let line = line.trim_end();
		if line.trim().is_empty() {
			blank += 1;
			if blank > 1 {
				continue;
			}
		} else {
			blank = 0;
		}
		out.push_str(line);
		out.push('\n');
	}
	if out.chars().count() > MAX_CHARS {
		let cut: String = out.chars().take(MAX_CHARS).collect();
		return format!("{cut}\n\n(이하 생략: 너무 길어 앞부분만 뽑았다)\n");
	}
	out
}

pub fn extract(path: &Path) -> Result<String, String> {
	let file = File::open(path).map_err(|e| e.to_string())?;
	let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("열지 못했습니다: {e}"))?;
	let text = match ext_of(&path.to_string_lossy()).as_str() {
		"docx" => entry(&mut zip, "word/document.xml").map(|x| flow_text(&x)).unwrap_or_default(),
		"hwpx" => numbered(&zip, "Contents/section", ".xml").iter().filter_map(|n| entry(&mut zip, n)).map(|x| flow_text(&x)).collect::<Vec<_>>().join("\n"),
		"pptx" => numbered(&zip, "ppt/slides/slide", ".xml")
			.iter()
			.enumerate()
			.filter_map(|(i, n)| entry(&mut zip, n).map(|x| format!("## 슬라이드 {}\n{}", i + 1, flow_text(&x))))
			.collect::<Vec<_>>()
			.join("\n"),
		"xlsx" => xlsx_text(&mut zip),
		_ => return Err("뽑을 수 없는 형식입니다".into()),
	};
	Ok(tidy(text))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn flow_text_keeps_paragraphs_and_cells() {
		let xml = r#"<w:body><w:p><w:r><w:t>제목 &amp; 개요</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:t>칸1</w:t></w:p></w:tc><w:tc><w:p><w:t>칸2</w:t></w:p></w:tc></w:tr></w:tbl><w:p><w:t xml:space="preserve">끝</w:t><w:br/><w:t>줄</w:t></w:p></w:body>"#;
		assert_eq!(flow_text(xml), "제목 & 개요\n칸1 \t칸2 \t\n끝\n줄\n");
	}
}

#[cfg(test)]
mod sample {
	/// 실제 파일로 확인한다: DOCKET_SAMPLES 에 경로를 ; 로 이어 주고 `cargo test sample -- --ignored --nocapture`
	#[test]
	#[ignore]
	fn extract_samples() {
		for p in std::env::var("DOCKET_SAMPLES").unwrap_or_default().split(';').filter(|s| !s.is_empty()) {
			match super::extract(std::path::Path::new(p)) {
				Ok(t) => println!("== {p}\n{} 글자\n{}\n", t.chars().count(), t.chars().take(300).collect::<String>()),
				Err(e) => println!("== {p}\n실패: {e}\n"),
			}
		}
	}
}
