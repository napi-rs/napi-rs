mod r#enum;
mod r#fn;
mod r#struct;

use once_cell::sync::Lazy;
use quote::ToTokens;
use regex::Regex;
use syn::Type;

#[derive(Default)]
pub struct TypeDef {
  pub kind: String,
  pub name: String,
  pub def: String,
}

impl ToString for TypeDef {
  fn to_string(&self) -> String {
    format!(
      r#"{{"kind": "{}", "name": "{}", "def": "{}"}}"#,
      self.kind, self.name, self.def,
    )
  }
}

pub trait ToTypeDef {
  fn to_type_def(&self) -> TypeDef;
}

pub static VEC_REGEX: Lazy<Regex> = Lazy::new(|| Regex::new(r"^Vec < (.*) >$").unwrap());

pub fn ty_to_ts_type(ty: &Type) -> String {
  match ty {
    Type::Reference(r) => ty_to_ts_type(&r.elem),
    Type::Tuple(tuple) => {
      format!(
        "[{}]",
        tuple
          .elems
          .iter()
          .map(|elem| ty_to_ts_type(elem))
          .collect::<Vec<_>>()
          .join(", ")
      )
    }
    Type::Path(syn::TypePath { qself: None, path }) => {
      str_to_ts_type(path.to_token_stream().to_string().as_str())
    }

    _ => "any".to_owned(),
  }
}

pub fn str_to_ts_type(ty: &str) -> String {
  match ty {
    "i8" | "i16" | "i32" | "i64" | "u8" | "u16" | "u32" => "number".to_owned(),
    "i128" | "isize" | "u64" | "u128" | "usize" => "BigInt".to_owned(),
    "bool" => "boolean".to_owned(),
    "String" | "str" | "char" => "string".to_owned(),
    "Object" => "object".to_owned(),
    // nothing else `& 'lifetime str` could ends with ` str`
    s if s.ends_with(" str") => "string".to_owned(),
    s if s.starts_with("Vec") && VEC_REGEX.is_match(s) => {
      let captures = VEC_REGEX.captures(s).unwrap();
      let inner = captures.get(1).unwrap().as_str();

      format!("Array<{}>", str_to_ts_type(inner))
    }
    s => s.to_owned(),
  }
}
