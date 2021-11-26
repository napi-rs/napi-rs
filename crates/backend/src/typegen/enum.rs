use super::{ToTypeDef, TypeDef};
use crate::{js_doc_from_comments, NapiEnum};

impl ToTypeDef for NapiEnum {
  fn to_type_def(&self) -> TypeDef {
    TypeDef {
      kind: "enum".to_owned(),
      name: self.js_name.to_owned(),
      def: self.gen_ts_variants(),
      js_doc: js_doc_from_comments(&self.comments),
      js_mod: self.js_mod.to_owned(),
    }
  }
}

impl NapiEnum {
  fn gen_ts_variants(&self) -> String {
    self
      .variants
      .iter()
      .map(|v| {
        format!(
          "{}{} = {}",
          js_doc_from_comments(&v.comments),
          v.name,
          v.val,
        )
      })
      .collect::<Vec<_>>()
      .join(",\n ")
  }
}
