use std::cell::RefCell;
use std::collections::HashMap;

use super::{add_alias, ToTypeDef, TypeDef};
use crate::{js_doc_from_comments, ty_to_ts_type, NapiImpl, NapiStruct, NapiStructKind};

thread_local! {
  pub(crate) static TASK_STRUCTS: RefCell<HashMap<String, String>> = Default::default();
  pub(crate) static CLASS_STRUCTS: RefCell<HashMap<String, String>> = Default::default();
}

impl ToTypeDef for NapiStruct {
  fn to_type_def(&self) -> Option<TypeDef> {
    CLASS_STRUCTS.with(|c| {
      c.borrow_mut()
        .insert(self.name.to_string(), self.js_name.clone());
    });
    add_alias(self.name.to_string(), self.js_name.to_string());

    Some(TypeDef {
      kind: String::from(if self.kind == NapiStructKind::Object {
        "interface"
      } else {
        "struct"
      }),
      name: self.js_name.to_owned(),
      def: self.gen_ts_class(),
      js_mod: self.js_mod.to_owned(),
      js_doc: js_doc_from_comments(&self.comments),
    })
  }
}

impl ToTypeDef for NapiImpl {
  fn to_type_def(&self) -> Option<TypeDef> {
    if let Some(output_type) = &self.task_output_type {
      TASK_STRUCTS.with(|t| {
        t.borrow_mut()
          .insert(self.js_name.clone(), ty_to_ts_type(output_type, false).0);
      });
    }

    Some(TypeDef {
      kind: "impl".to_owned(),
      name: self.js_name.to_owned(),
      def: self
        .items
        .iter()
        .filter_map(|f| {
          if f.skip_typescript {
            None
          } else {
            Some(format!(
              "{}{}",
              js_doc_from_comments(&f.comments),
              f.to_type_def()
                .map_or(String::default(), |type_def| type_def.def)
            ))
          }
        })
        .collect::<Vec<_>>()
        .join("\\n"),
      js_mod: self.js_mod.to_owned(),
      js_doc: "".to_string(),
    })
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

        if f.skip_typescript {
          return field_str;
        }

        if !f.comments.is_empty() {
          field_str.push_str(&js_doc_from_comments(&f.comments))
        }

        if !f.setter {
          field_str.push_str("readonly ")
        }
        let (arg, is_optional) = ty_to_ts_type(&f.ty, false);
        let sep = if is_optional { "?" } else { "" };
        let arg = format!("{}{}: {}", &f.js_name, sep, arg);
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
