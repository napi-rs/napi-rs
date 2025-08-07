use super::{ToTypeDef, TypeDef};

use crate::{
  ty_to_ts_type,
  typegen::{add_alias, JSDoc},
  NapiType,
};

impl ToTypeDef for NapiType {
  fn to_type_def(&self) -> Option<TypeDef> {
    if self.skip_typescript {
      return None;
    }

    add_alias(self.name.to_string(), self.js_name.to_string());

    Some(TypeDef {
      kind: "type".to_owned(),
      name: self.js_name.to_owned(),
      original_name: Some(self.name.to_string()),
      def: ty_to_ts_type(&self.value, false, false, false).0,
      js_mod: self.js_mod.to_owned(),
      js_doc: JSDoc::new(&self.comments),
    })
  }
}
