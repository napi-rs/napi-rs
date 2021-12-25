use super::{add_alias, ToTypeDef, TypeDef};
use crate::{js_doc_from_comments, NapiEnum};

impl ToTypeDef for NapiEnum {
  fn to_type_def(&self) -> Option<TypeDef> {
    if self.skip_typescript {
      return None;
    }

    add_alias(self.name.to_string(), self.js_name.to_string());

    Some(TypeDef {
      kind: "enum".to_owned(),
      name: self.js_name.to_owned(),
      original_name: Some(self.name.to_string()),
      def: self.gen_ts_variants(),
      js_doc: js_doc_from_comments(&self.comments),
      js_mod: self.js_mod.to_owned(),
    })
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
