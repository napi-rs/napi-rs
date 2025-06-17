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

#[napi]
struct PackageJsonReader {
  i: Value,
}

#[napi]
impl PackageJsonReader {
  #[napi(constructor)]
  pub fn new() -> Result<Self> {
    let raw = fs::read_to_string("package.json")?;
    Ok(Self {
      i: serde_json::from_str(&raw)?,
    })
  }

  #[napi]
  pub fn read(&self) -> &Value {
    &self.i
  }
}

#[napi(catch_unwind, ts_args_type = "value: bigint")]
pub fn get_bigint_json_value(bigint_json_value: Value) {
  match bigint_json_value {
    Value::Number(n) => {
      if let Some(u) = n.as_u64() {
        assert_eq!(u, 1);
        return;
      }
      if let Some(i) = n.as_i64() {
        assert_eq!(i, -1);
        return;
      }
      unreachable!("should not happen");
    }
    Value::String(s) => {
      assert_eq!(s, "18446744073709551620");
    }
    _ => {
      unreachable!("should not happen");
    }
  }
}
