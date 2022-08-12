mod r#const;
mod r#enum;
mod r#fn;
pub(crate) mod r#struct;

use std::{cell::RefCell, collections::HashMap};

use once_cell::sync::Lazy;
use syn::Type;

#[derive(Default, Debug)]
pub struct TypeDef {
  pub kind: String,
  pub name: String,
  pub original_name: Option<String>,
  pub def: String,
  pub js_mod: Option<String>,
  pub js_doc: String,
}

thread_local! {
  static ALIAS: RefCell<HashMap<String, String>> = Default::default();
}

fn add_alias(name: String, alias: String) {
  ALIAS.with(|aliases| {
    aliases.borrow_mut().insert(name, alias);
  });
}

pub fn js_doc_from_comments(comments: &[String]) -> String {
  if comments.is_empty() {
    return "".to_owned();
  }

  if comments.len() == 1 {
    return format!("/**{} */\n", comments[0]);
  }

  format!(
    "/**\n{} */\n",
    comments
      .iter()
      .map(|c| format!(" *{}\n", c))
      .collect::<Vec<String>>()
      .join("")
  )
}

fn escape_json(src: &str) -> String {
  use std::fmt::Write;
  let mut escaped = String::with_capacity(src.len());
  let mut utf16_buf = [0u16; 2];
  let mut pending_backslash = false;
  for c in src.chars() {
    if pending_backslash {
      match c {
        'b' | 'f' | 'n' | 'r' | 't' | 'u' | '"' => escaped += "\\",
        _ => escaped += "\\\\",
      }
      pending_backslash = false;
    }

    match c {
      '\x08' => escaped += "\\b",
      '\x0c' => escaped += "\\f",
      '\n' => escaped += "\\n",
      '\r' => escaped += "\\r",
      '\t' => escaped += "\\t",
      '"' => escaped += "\\\"",
      '\\' => {
        pending_backslash = true;
      }
      ' ' => escaped += " ",
      c if c.is_ascii_graphic() => escaped.push(c),
      c => {
        let encoded = c.encode_utf16(&mut utf16_buf);
        for utf16 in encoded {
          write!(escaped, "\\u{:04X}", utf16).unwrap();
        }
      }
    }
  }

  // cater for trailing backslash
  if pending_backslash {
    escaped += "\\\\"
  }

  escaped
}

impl ToString for TypeDef {
  fn to_string(&self) -> String {
    let js_mod = if let Some(js_mod) = &self.js_mod {
      format!(", \"js_mod\": \"{}\"", js_mod)
    } else {
      "".to_owned()
    };
    let original_name = if let Some(original_name) = &self.original_name {
      format!(", \"original_name\": \"{}\"", original_name)
    } else {
      "".to_owned()
    };
    format!(
      r#"{{"kind": "{}", "name": "{}", "js_doc": "{}", "def": "{}"{}{}}}"#,
      self.kind,
      self.name,
      escape_json(&self.js_doc),
      escape_json(&self.def),
      original_name,
      js_mod,
    )
  }
}

pub trait ToTypeDef {
  fn to_type_def(&self) -> Option<TypeDef>;
}

static KNOWN_TYPES: Lazy<HashMap<&'static str, &'static str>> = Lazy::new(|| {
  let mut map = HashMap::default();
  map.extend([
    ("JsUndefined", "undefined"),
    ("()", "undefined"),
    ("Undefined", "undefined"),
    ("JsNumber", "number"),
    ("i8", "number"),
    ("i16", "number"),
    ("i32", "number"),
    ("i64", "number"),
    ("f64", "number"),
    ("u8", "number"),
    ("u16", "number"),
    ("u32", "number"),
    ("u64", "bigint"),
    ("i64n", "bigint"),
    ("u128", "bigint"),
    ("i128", "bigint"),
    ("usize", "bigint"),
    ("isize", "bigint"),
    ("JsBigInt", "bigint"),
    ("BigInt", "bigint"),
    ("JsBoolean", "boolean"),
    ("bool", "boolean"),
    ("JsString", "string"),
    ("String", "string"),
    ("str", "string"),
    ("Latin1String", "string"),
    ("Utf16String", "string"),
    ("char", "string"),
    ("JsObject", "object"),
    ("Object", "object"),
    ("Array", "unknown[]"),
    ("Value", "any"),
    ("Map", "Record<string, any>"),
    ("HashMap", "Record<{}, {}>"),
    ("ArrayBuffer", "ArrayBuffer"),
    ("Int8Array", "Int8Array"),
    ("Uint8Array", "Uint8Array"),
    ("Uint8ClampedArray", "Uint8ClampedArray"),
    ("Int16Array", "Int16Array"),
    ("Uint16Array", "Uint16Array"),
    ("Int32Array", "Int32Array"),
    ("Uint32Array", "Uint32Array"),
    ("Float32Array", "Float32Array"),
    ("Float64Array", "Float64Array"),
    ("BigInt64Array", "BigInt64Array"),
    ("BigUint64Array", "BigUint64Array"),
    ("DataView", "DataView"),
    ("DateTime", "Date"),
    ("Date", "Date"),
    ("JsDate", "Date"),
    ("JsBuffer", "Buffer"),
    ("Buffer", "Buffer"),
    ("Vec", "Array<{}>"),
    ("Result", "Error | {}"),
    ("ClassInstance", "{}"),
    ("Either", "{} | {}"),
    ("Either3", "{} | {} | {}"),
    ("Either4", "{} | {} | {} | {}"),
    ("Either5", "{} | {} | {} | {} | {}"),
    ("Either6", "{} | {} | {} | {} | {} | {}"),
    ("Either7", "{} | {} | {} | {} | {} | {} | {}"),
    ("Either8", "{} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either9", "{} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either10", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either11", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either12", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either13", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either14", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either15", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either16", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either17", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either18", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either19", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either20", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either21", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either22", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either23", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either24", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either25", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Either26", "{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}"),
    ("Null", "null"),
    ("JsNull", "null"),
    ("null", "null"),
    ("Symbol", "symbol"),
    ("JsSymbol", "symbol"),
    ("external", "object"),
    ("AbortSignal", "AbortSignal"),
    ("JsFunction", "(...args: any[]) => any"),
    ("JsGlobal", "typeof global"),
    ("External", "ExternalObject<{}>"),
    ("unknown", "unknown"),
    ("Unknown", "unknown"),
    ("JsUnknown", "unknown"),
    ("This", "this")
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

pub fn ty_to_ts_type(ty: &Type, is_return_ty: bool, is_struct_field: bool) -> (String, bool) {
  match ty {
    Type::Reference(r) => ty_to_ts_type(&r.elem, is_return_ty, is_struct_field),
    Type::Tuple(tuple) => {
      if tuple.elems.is_empty() {
        ("undefined".to_owned(), false)
      } else {
        (
          format!(
            "[{}]",
            tuple
              .elems
              .iter()
              .map(|elem| ty_to_ts_type(elem, false, false).0)
              .collect::<Vec<_>>()
              .join(", ")
          ),
          false,
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
              syn::GenericArgument::Type(generic_ty) => {
                Some(ty_to_ts_type(generic_ty, false, false))
              }
              _ => None,
            })
            .collect::<Vec<_>>()
        } else {
          vec![]
        };

        if rust_ty == "Result" && is_return_ty {
          ts_ty = Some(args.first().unwrap().to_owned());
        } else if rust_ty == "Option" {
          ts_ty = args.first().map(|(arg, _)| {
            (
              if is_struct_field {
                arg.to_string()
              } else if is_return_ty {
                format!("{} | null", arg)
              } else {
                format!("{} | undefined | null", arg)
              },
              true,
            )
          });
        } else if rust_ty == "AsyncTask" {
          ts_ty = r#struct::TASK_STRUCTS.with(|t| {
            let (output_type, _) = args.first().unwrap().to_owned();
            if let Some(o) = t.borrow().get(&output_type) {
              Some((format!("Promise<{}>", o), false))
            } else {
              Some(("Promise<unknown>".to_owned(), false))
            }
          });
        } else if rust_ty == "Reference" || rust_ty == "WeakReference" {
          ts_ty = r#struct::TASK_STRUCTS.with(|t| {
            // Reference<T> => T
            if let Some(arg) = args.first() {
              let (output_type, _) = arg.to_owned();
              if let Some(o) = t.borrow().get(&output_type) {
                Some((o.to_owned(), false))
              } else {
                Some((output_type, false))
              }
            } else {
              // Not NAPI-RS `Reference`
              Some((rust_ty, false))
            }
          });
        } else if let Some(&known_ty) = KNOWN_TYPES.get(rust_ty.as_str()) {
          if known_ty.contains("{}") {
            ts_ty = Some((
              fill_ty(known_ty, args.into_iter().map(|(arg, _)| arg).collect()),
              false,
            ));
          } else {
            ts_ty = Some((known_ty.to_owned(), false));
          }
        } else if let Some(t) = crate::typegen::r#struct::CLASS_STRUCTS
          .with(|c| c.borrow_mut().get(rust_ty.as_str()).cloned())
        {
          ts_ty = Some((t, false));
        } else if rust_ty == "Promise" {
          ts_ty = Some((
            format!("Promise<{}>", args.first().map(|(arg, _)| arg).unwrap()),
            false,
          ));
        } else {
          // there should be runtime registered type in else
          let type_alias = ALIAS.with(|aliases| {
            aliases
              .borrow()
              .get(rust_ty.as_str())
              .map(|a| (a.to_owned(), false))
          });
          ts_ty = type_alias.or(Some((rust_ty, false)));
        }
      }

      ts_ty.unwrap_or_else(|| ("any".to_owned(), false))
    }
    Type::Group(g) => ty_to_ts_type(&g.elem, is_return_ty, is_struct_field),
    Type::Array(a) => {
      let (element_type, is_optional) = ty_to_ts_type(&a.elem, is_return_ty, is_struct_field);
      (format!("{}[]", element_type), is_optional)
    }
    _ => ("any".to_owned(), false),
  }
}
