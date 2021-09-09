use super::{ToTypeDef, TypeDef};
use crate::NapiEnum;

impl ToTypeDef for NapiEnum {
  fn to_type_def(&self) -> TypeDef {
    TypeDef {
      kind: "enum".to_owned(),
      name: self.js_name.to_owned(),
      def: format!(
        r"export enum {js_name} {{ {variants} }}",
        js_name = &self.js_name,
        variants = self.gen_ts_variants()
      ),
    }
  }
}

impl NapiEnum {
  fn gen_ts_variants(&self) -> String {
    self
      .variants
      .iter()
      .map(|v| format!("{} = {}", v.name, v.val))
      .collect::<Vec<_>>()
      .join(", ")
  }
}
