mod r#enum;
mod r#fn;
pub(crate) mod r#struct;

use std::collections::HashMap;

use once_cell::sync::Lazy;
use syn::Type;

#[derive(Default)]
pub struct TypeDef {
  pub kind: String,
  pub name: String,
  pub def: String,
}

impl ToString for TypeDef {
  fn to_string(&self) -> String {
    format!(
      r#"{{"kind": "{}", "name": "{}", "def": "{}"}}"#,
      self.kind, self.name, self.def,
    )
  }
}

pub trait ToTypeDef {
  fn to_type_def(&self) -> TypeDef;
}

static KNOWN_TYPES: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
  let mut map = HashMap::default();
  map.extend([
    ("()", "undefined"),
    ("i8", "number"),
    ("i16", "number"),
    ("i32", "number"),
    ("i64", "number"),
    ("f64", "number"),
    ("u8", "number"),
    ("u16", "number"),
    ("u32", "number"),
    ("u64", "BigInt"),
    ("u128", "BigInt"),
    ("i128", "BigInt"),
    ("usize", "BigInt"),
    ("isize", "BigInt"),
    ("BigInt", "BigInt"),
    ("bool", "boolean"),
    ("String", "string"),
    ("str", "string"),
    ("Latin1String", "string"),
    ("Utf16String", "string"),
    ("char", "string"),
    ("Object", "object"),
    ("Value", "any"),
    ("Map", "Record<string, any>"),
    ("HashMap", "Record<{}, {}>"),
    ("ArrayBuffer", "ArrayBuffer"),
    ("DataView", "DataView"),
    ("Date", "Date"),
    ("Buffer", "Buffer"),
    // TODO: Vec<u8> should be Buffer, now is Array<number>
    ("Vec", "Array<{}>"),
    ("Option", "{} | null"),
    ("Result", "Error | {}"),
    ("Either", "{} | {}"),
    ("Either3", "{} | {} | {}"),
    ("Either4", "{} | {} | {} | {}"),
    ("Either5", "{} | {} | {} | {} | {}"),
    ("unknown", "unknown"),
    ("null", "null"),
    ("symbol", "symbol"),
    ("external", "object"),
    ("AbortSignal", "AbortSignal"),
    ("Function", "(...args: any[]) => any"),
  ]);

  map
});

fn fill_ty(template: &str, args: Vec<String>) -> String {
  let matches = template.match_indices("{}").collect::<Vec<_>>();
  if args.len() != matches.len() {
    return String::from("any");
  }

  let mut ret = String::from("");
  let mut prev = 0;
  matches.into_iter().zip(args).for_each(|((index, _), arg)| {
    ret.push_str(&template[prev..index]);
    ret.push_str(&arg);
    prev = index + 2;
  });

  ret.push_str(&template[prev..]);
  ret
}

pub fn ty_to_ts_type(ty: &Type, is_return_ty: bool) -> String {
  match ty {
    Type::Reference(r) => ty_to_ts_type(&r.elem, is_return_ty),
    Type::Tuple(tuple) => {
      if tuple.elems.is_empty() {
        "undefined".to_owned()
      } else {
        format!(
          "[{}]",
          tuple
            .elems
            .iter()
            .map(|elem| ty_to_ts_type(elem, false))
            .collect::<Vec<_>>()
            .join(", ")
        )
      }
    }
    Type::Path(syn::TypePath { qself: None, path }) => {
      let mut ts_ty = None;

      if let Some(syn::PathSegment { ident, arguments }) = path.segments.last() {
        let rust_ty = ident.to_string();
        let args = if let syn::PathArguments::AngleBracketed(arguments) = arguments {
          arguments
            .args
            .iter()
            .filter_map(|arg| match arg {
              syn::GenericArgument::Type(generic_ty) => Some(ty_to_ts_type(generic_ty, false)),
              _ => None,
            })
            .collect::<Vec<_>>()
        } else {
          vec![]
        };

        if rust_ty == "Result" && is_return_ty {
          ts_ty = Some(args.first().unwrap().to_owned());
        } else if rust_ty == "AsyncTask" {
          ts_ty = r#struct::TASK_STRUCTS.with(|t| {
            let output_type = args.first().unwrap().to_owned();
            if let Some(o) = t.borrow().get(&output_type) {
              Some(format!("Promise<{}>", o))
            } else {
              Some("Promise<unknown>".to_owned())
            }
          });
        } else if let Some(&known_ty) = KNOWN_TYPES.get(rust_ty.as_str()) {
          if known_ty.contains("{}") {
            ts_ty = Some(fill_ty(known_ty, args));
          } else {
            ts_ty = Some(known_ty.to_owned());
          }
        } else {
          // there should be runtime registered type in else
          ts_ty = Some(rust_ty);
        }
      }

      ts_ty.unwrap_or_else(|| "any".to_owned())
    }

    _ => "any".to_owned(),
  }
}
