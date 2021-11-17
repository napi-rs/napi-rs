use super::{ToTypeDef, TypeDef};

use crate::{ty_to_ts_type, NapiConst};

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
    }
  }
}
