use std::{collections::HashMap, fs};

use napi::bindgen_prelude::*;

use crate::r#enum::Kind;

/// `constructor` option for `struct` requires all fields to be public,
/// otherwise tag impl fn as constructor
/// #[napi(constructor)]
#[napi]
pub struct Animal {
  #[napi(readonly)]
  pub kind: Kind,
  name: String,
}

#[napi]
impl Animal {
  #[napi(constructor)]
  pub fn new(kind: Kind, name: String) -> Self {
    Animal { kind, name }
  }

  #[napi(getter)]
  pub fn get_name(&self) -> &str {
    self.name.as_str()
  }

  #[napi(setter)]
  pub fn set_name(&mut self, name: String) {
    self.name = name;
  }

  #[napi]
  pub fn whoami(&self) -> String {
    match self.kind {
      Kind::Dog => {
        format!("Dog: {}", self.name)
      }
      Kind::Cat => format!("Cat: {}", self.name),
      Kind::Duck => format!("Duck: {}", self.name),
    }
  }
}

#[napi(constructor)]
#[derive(Serialize, Deserialize, Debug)]
struct PackageJson {
  pub name: String,
  pub version: String,
  pub dependencies: Option<HashMap<String, String>>,
  #[serde(rename = "devDependencies")]
  pub dev_dependencies: Option<HashMap<String, String>>,
}

#[napi]
fn read_package_json() -> Result<PackageJson> {
  let raw = fs::read_to_string("package.json")?;
  let p: PackageJson = serde_json::from_str(&raw)?;
  Ok(p)
}
