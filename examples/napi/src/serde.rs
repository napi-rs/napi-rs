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
