use napi::bindgen_prelude::*;

use crate::r#enum::Kind;

#[napi(constructor)]
pub struct Animal {
  #[napi(readonly)]
  pub kind: Kind,
  pub name: String,
}

#[napi]
impl Animal {
  #[napi]
  pub fn new(kind: Kind, name: String) -> Self {
    Animal { kind, name }
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
