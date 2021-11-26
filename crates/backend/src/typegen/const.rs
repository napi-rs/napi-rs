use super::{ToTypeDef, TypeDef};

use crate::{js_doc_from_comments, ty_to_ts_type, NapiConst};

impl ToTypeDef for NapiConst {
  fn to_type_def(&self) -> TypeDef {
    TypeDef {
      kind: "const".to_owned(),
      name: self.js_name.to_owned(),
      def: format!(
        "export const {}: {}",
        &self.js_name,
        ty_to_ts_type(&self.type_name, false).0
      ),
      js_mod: self.js_mod.to_owned(),
      js_doc: js_doc_from_comments(&self.comments),
    }
  }
}
