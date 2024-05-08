use napi::bindgen_prelude::*;
use serde_json::{Map, Value};
use std::fs;

#[napi(object)]
#[derive(Serialize, Deserialize, Debug)]
/// This is an interface for package.json
struct PackageJson {
  pub name: String,
  /// The version of the package
  pub version: String,
  pub dependencies: Option<Map<String, Value>>,
  #[serde(rename = "devDependencies")]
  pub dev_dependencies: Option<Map<String, Value>>,
}

#[napi]
fn read_package_json() -> Result<PackageJson> {
  let raw = fs::read_to_string("package.json")?;
  let p: PackageJson = serde_json::from_str(&raw)?;
  Ok(p)
}

#[napi]
fn get_package_json_name(package_json: PackageJson) -> String {
  package_json.name
}

#[napi]
fn test_serde_roundtrip(data: Value) -> Value {
  data
}

#[napi]
fn test_serde_big_number_precision(number: String) -> Value {
  let data = format!("{{\"number\":{}}}", number);
  serde_json::from_str(&data).unwrap()
}

#[derive(Serialize, Debug, Deserialize)]
struct BytesObject {
  #[serde(with = "serde_bytes")]
  code: Vec<u8>,
}

#[napi]
fn test_serde_buffer_bytes(obj: Object, env: Env) -> napi::Result<usize> {
  let obj: BytesObject = env.from_js_value(obj)?;
  Ok(obj.code.len())
}
