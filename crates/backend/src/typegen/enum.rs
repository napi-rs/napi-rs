use super::{add_alias, ToTypeDef, TypeDef};
use crate::{typegen::JSDoc, NapiEnum, NapiEnumValue};

impl ToTypeDef for NapiEnum {
  fn to_type_def(&self) -> Option<TypeDef> {
    if self.skip_typescript {
      return None;
    }

    add_alias(self.name.to_string(), self.js_name.to_string());

    Some(TypeDef {
      kind: if self.is_string_enum {
        "string_enum".to_owned()
      } else {
        "enum".to_owned()
      },
      name: self.js_name.to_owned(),
      original_name: Some(self.name.to_string()),
      def: self.gen_ts_variants(),
      js_doc: JSDoc::new(&self.comments),
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
        let val = match &v.val {
          NapiEnumValue::Number(num) => format!("{num}"),
          NapiEnumValue::String(string) => format!("'{string}'"),
        };
        format!("{}{} = {}", JSDoc::new(&v.comments), v.name, val)
      })
      .collect::<Vec<_>>()
      .join(",\n ")
  }
}
