use crate::{NapiMod, ToTypeDef, TypeDef};

impl ToTypeDef for NapiMod {
  fn to_type_def(&self) -> TypeDef {
    TypeDef {
      kind: "mod".to_owned(),
      name: self.js_name.clone(),
      def: "".to_owned(),
      js_mod: None,
      js_doc: "".to_owned(),
    }
  }
}
