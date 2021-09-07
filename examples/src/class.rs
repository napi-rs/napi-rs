use napi::bindgen_prelude::*;

use crate::r#enum::Kind;

#[napi]
pub struct Animal {
  #[napi(readonly)]
  pub kind: Kind,

  pub name: String,

  #[napi(skip)]
  pub hidden_field: String,
}

#[napi]
impl Animal {
  #[napi(constructor)]
  pub fn new(kind: Kind, name: String) -> Self {
    Animal {
      kind,
      name,
      hidden_field: "__HIDDEN__".to_owned(),
    }
  }

  #[napi(setter = kind)]
  pub fn set_kind(&mut self, kind: Kind) {
    self.kind = kind;
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
