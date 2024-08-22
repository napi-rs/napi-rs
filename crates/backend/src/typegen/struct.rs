use std::collections::HashMap;
use std::{cell::RefCell, iter};

use super::{add_alias, ToTypeDef, TypeDef};
use crate::{
  js_doc_from_comments, ty_to_ts_type, NapiImpl, NapiStruct, NapiStructField, NapiStructKind,
};

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
      kind: String::from(match self.kind {
        NapiStructKind::Class(_) => "struct",
        NapiStructKind::Object(_) => "interface",
        NapiStructKind::StructuredEnum(_) => "type",
      }),
      name: self.js_name.to_owned(),
      original_name: Some(self.name.to_string()),
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
        let (resolved_type, is_optional) = ty_to_ts_type(output_type, false, true, false);
        t.borrow_mut().insert(
          self.name.to_string(),
          if resolved_type == "undefined" {
            "void".to_owned()
          } else if is_optional {
            format!("{} | null", resolved_type)
          } else {
            resolved_type
          },
        );
      });
    }

    if let Some(output_type) = &self.iterator_yield_type {
      let next_type = if let Some(ref ty) = self.iterator_next_type {
        ty_to_ts_type(ty, false, false, false).0
      } else {
        "void".to_owned()
      };
      let return_type = if let Some(ref ty) = self.iterator_return_type {
        ty_to_ts_type(ty, false, false, false).0
      } else {
        "void".to_owned()
      };
      Some(TypeDef {
        kind: "impl".to_owned(),
        name: self.js_name.to_owned(),
        original_name: None,
        def: format!(
          "[Symbol.iterator](): Iterator<{}, {}, {}>",
          ty_to_ts_type(output_type, false, true, false).0,
          return_type,
          next_type,
        ),
        js_mod: self.js_mod.to_owned(),
        js_doc: "".to_string(),
      })
    } else {
      Some(TypeDef {
        kind: "impl".to_owned(),
        name: self.js_name.to_owned(),
        original_name: None,
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
}

impl NapiStruct {
  fn gen_field(&self, f: &NapiStructField) -> Option<(String, String)> {
    if f.skip_typescript {
      return None;
    }

    let mut field_str = String::from("");

    if !f.comments.is_empty() {
      field_str.push_str(&js_doc_from_comments(&f.comments))
    }

    if !f.setter {
      field_str.push_str("readonly ")
    }

    let (arg, is_optional) = ty_to_ts_type(&f.ty, false, true, false);
    let arg = f.ts_type.as_ref().map(|ty| ty.to_string()).unwrap_or(arg);

    let arg = match is_optional {
      false => format!("{}: {}", &f.js_name, arg),
      true => match self.use_nullable {
        false => format!("{}?: {}", &f.js_name, arg),
        true => format!("{}: {} | null", &f.js_name, arg),
      },
    };
    field_str.push_str(&arg);
    Some((field_str, arg))
  }

  fn gen_ts_class(&self) -> String {
    match &self.kind {
      NapiStructKind::Class(class) => {
        let mut ctor_args = vec![];
        let def = class
          .fields
          .iter()
          .filter(|f| f.getter)
          .filter_map(|f| {
            self.gen_field(f).map(|(field, arg)| {
              ctor_args.push(arg);
              field
            })
          })
          .collect::<Vec<_>>()
          .join("\\n");
        if class.ctor {
          format!("{}\\nconstructor({})", def, ctor_args.join(", "))
        } else {
          def
        }
      }
      NapiStructKind::Object(object) => object
        .fields
        .iter()
        .filter(|f| f.getter)
        .filter_map(|f| self.gen_field(f).map(|(field, _)| field))
        .collect::<Vec<_>>()
        .join("\\n"),
      NapiStructKind::StructuredEnum(structured_enum) => structured_enum
        .variants
        .iter()
        .map(|variant| {
          let def = iter::once(format!(
            "{}: '{}'",
            structured_enum.discriminant, variant.name
          ))
          .chain(
            variant
              .fields
              .iter()
              .filter(|f| f.getter)
              .filter_map(|f| self.gen_field(f).map(|(field, _)| field)),
          )
          .collect::<Vec<_>>()
          .join(", ");
          format!("  | {{ {} }} ", def)
        })
        .collect::<Vec<_>>()
        .join("\\n"),
    }
  }
}
