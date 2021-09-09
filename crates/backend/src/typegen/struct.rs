use super::{ToTypeDef, TypeDef};
use crate::{ty_to_ts_type, NapiImpl, NapiStruct};

impl ToTypeDef for NapiStruct {
  fn to_type_def(&self) -> TypeDef {
    TypeDef {
      kind: "struct".to_owned(),
      name: self.js_name.to_owned(),
      def: self.gen_ts_class_fields(),
    }
  }
}

impl ToTypeDef for NapiImpl {
  fn to_type_def(&self) -> TypeDef {
    TypeDef {
      kind: "impl".to_owned(),
      name: self.js_name.to_owned(),
      def: self
        .items
        .iter()
        .map(|f| f.to_type_def().def)
        .collect::<Vec<_>>()
        .join("\\n"),
    }
  }
}

impl NapiStruct {
  fn gen_ts_class_fields(&self) -> String {
    let mut ctor_args = vec![];
    let def = self
      .fields
      .iter()
      .filter(|f| f.getter)
      .map(|f| {
        let mut field_str = String::from("");

        if !f.setter {
          field_str.push_str("readonly ")
        }
        let arg = format!("{}: {}", &f.js_name, ty_to_ts_type(&f.ty));
        if self.gen_default_ctor {
          ctor_args.push(arg.clone());
        }
        field_str.push_str(&arg);

        field_str
      })
      .collect::<Vec<_>>()
      .join("\\n");

    if self.gen_default_ctor {
      format!("{}\\nconstructor({})", def, ctor_args.join(", "))
    } else {
      def
    }
  }
}
