use super::{ToTypeDef, TypeDef};

use crate::{js_doc_from_comments, ty_to_ts_type, typegen::add_alias, NapiConst};

impl ToTypeDef for NapiConst {
  fn to_type_def(&self) -> Option<TypeDef> {
    if self.skip_typescript {
      return None;
    }

    add_alias(self.name.to_string(), self.js_name.to_string());

    Some(TypeDef {
      kind: "const".to_owned(),
      name: self.js_name.to_owned(),
      original_name: Some(self.name.to_string()),
      def: format!(
        "export const {}: {}",
        &self.js_name,
        ty_to_ts_type(&self.type_name, false, false).0
      ),
      js_mod: self.js_mod.to_owned(),
      js_doc: js_doc_from_comments(&self.comments),
    })
  }
}
