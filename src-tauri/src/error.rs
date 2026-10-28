use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
	#[error("{0}")]
	Io(#[from] std::io::Error),
	#[error("{0}")]
	Json(#[from] serde_json::Error),
	#[error("{0}")]
	Msg(String),
}

/// 화면에는 문장 하나로 간다. 구조화된 오류는 화면에서 쓸 곳이 없다.
impl Serialize for Error {
	fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
		s.serialize_str(&self.to_string())
	}
}

pub type Result<T> = std::result::Result<T, Error>;

pub fn msg<T>(text: impl Into<String>) -> Result<T> {
	Err(Error::Msg(text.into()))
}
