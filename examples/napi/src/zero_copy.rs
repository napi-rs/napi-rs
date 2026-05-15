use napi::bindgen_prelude::*;

#[derive(Deserialize)]
struct LogEntry<'a> {
  #[serde(borrow)]
  timestamp: &'a str,
  #[serde(borrow)]
  level: &'a str,
  #[serde(borrow)]
  message: &'a str,
  #[serde(borrow)]
  tags: Vec<&'a str>,
}

#[napi(object)]
#[derive(Debug)]
pub struct ParsedLog {
  pub timestamp: String,
  pub level: String,
  pub message: String,
  pub tags: Vec<String>,
}

#[napi]
pub fn bench_zero_copy(buffer: Buffer) -> Result<ParsedLog> {
  let entry: LogEntry = serde_json::from_slice(&buffer)?;
  Ok(ParsedLog {
    timestamp: entry.timestamp.to_owned(),
    level: entry.level.to_owned(),
    message: entry.message.to_owned(),
    tags: entry.tags.iter().map(|s| s.to_string()).collect(),
  })
}

#[derive(Deserialize)]
struct LogEntryOwned {
  timestamp: String,
  level: String,
  message: String,
  tags: Vec<String>,
}

#[napi]
pub fn bench_owned_str(input: String) -> Result<ParsedLog> {
  let entry: LogEntryOwned = serde_json::from_str(&input)?;
  Ok(ParsedLog {
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.message,
    tags: entry.tags,
  })
}

#[derive(Deserialize)]
struct LogShape {
  timestamp: String,
  level: String,
  message: String,
  tags: Vec<String>,
}

#[napi]
pub fn bench_direct_log(env: Env, obj: Object) -> Result<ParsedLog> {
  let shape: LogShape = env.from_js_value(obj)?;
  Ok(ParsedLog {
    timestamp: shape.timestamp,
    level: shape.level,
    message: shape.message,
    tags: shape.tags,
  })
}
