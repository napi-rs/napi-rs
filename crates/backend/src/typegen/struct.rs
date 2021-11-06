use std::cell::RefCell;
use std::collections::HashMap;

use super::{ToTypeDef, TypeDef};
use crate::{ty_to_ts_type, NapiImpl, NapiStruct, NapiStructKind};

thread_local! {
  pub(crate) static TASK_STRUCTS: RefCell<HashMap<String, String>> = Default::default();
  pub(crate) static CLASS_STRUCTS: RefCell<HashMap<String, String>> = Default::default();
}

impl ToTypeDef for NapiStruct {
  fn to_type_def(&self) -> TypeDef {
    CLASS_STRUCTS.with(|c| {
      c.borrow_mut()
        .insert(self.name.to_string(), self.js_name.clone());
    });
    TypeDef {
      kind: String::from(if self.kind == NapiStructKind::Object {
        "interface"
      } else {
        "struct"
      }),
      name: self.js_name.to_owned(),
      def: self.gen_ts_class(),
    }
  }
}

impl ToTypeDef for NapiImpl {
  fn to_type_def(&self) -> TypeDef {
    if let Some(output_type) = &self.task_output_type {
      TASK_STRUCTS.with(|t| {
        t.borrow_mut()
          .insert(self.js_name.clone(), ty_to_ts_type(output_type, false));
      });
    }
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
  fn gen_ts_class(&self) -> String {
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
        let arg = format!("{}: {}", &f.js_name, ty_to_ts_type(&f.ty, false));
        if self.kind == NapiStructKind::Constructor {
          ctor_args.push(arg.clone());
        }
        field_str.push_str(&arg);

        field_str
      })
      .collect::<Vec<_>>()
      .join("\\n");

    if self.kind == NapiStructKind::Constructor {
      format!("{}\\nconstructor({})", def, ctor_args.join(", "))
    } else {
      def
    }
  }
}
