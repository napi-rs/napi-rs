mod r#const;
mod r#enum;
mod r#fn;
pub(crate) mod r#struct;

use std::{cell::RefCell, collections::HashMap, env};

use once_cell::sync::Lazy;
use syn::Type;

pub static NAPI_RS_CLI_VERSION: Lazy<semver::Version> = Lazy::new(|| {
  let version = env::var("CARGO_CFG_NAPI_RS_CLI_VERSION").unwrap_or_else(|_| "0.0.0".to_string());
  semver::Version::parse(&version).unwrap_or_else(|_| semver::Version::new(0, 0, 0))
});

pub static NAPI_RS_CLI_VERSION_WITH_SHARED_CRATES_FIX: Lazy<semver::Version> =
  Lazy::new(|| semver::Version::new(2, 15, 1));

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
    let pkg_name = std::env::var("CARGO_PKG_NAME").expect("CARGO_PKG_NAME is not set");
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
    // TODO: remove this in v3
    // This is a workaround for lower version of @napi-rs/cli
    // See https://github.com/napi-rs/napi-rs/pull/1531
    let prefix = if *NAPI_RS_CLI_VERSION >= *NAPI_RS_CLI_VERSION_WITH_SHARED_CRATES_FIX {
      format!("{}:", pkg_name)
    } else {
      "".to_string()
    };
    format!(
      r#"{}{{"kind": "{}", "name": "{}", "js_doc": "{}", "def": "{}"{}{}}}"#,
      prefix,
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

/// Mapping from `rust_type` to (`ts_type`, `is_ts_function_type_notation`, `is_ts_union_type`)
static KNOWN_TYPES: Lazy<HashMap<&'static str, (&'static str, bool, bool)>> = Lazy::new(|| {
  let mut map = HashMap::default();
  map.extend(crate::PRIMITIVE_TYPES.iter().cloned());
  map.extend([
    ("JsObject", ("object", false, false)),
    ("Object", ("object", false, false)),
    ("Array", ("unknown[]", false, false)),
    ("Value", ("any", false, false)),
    ("Map", ("Record<string, any>", false, false)),
    ("HashMap", ("Record<{}, {}>", false, false)),
    ("ArrayBuffer", ("ArrayBuffer", false, false)),
    ("JsArrayBuffer", ("ArrayBuffer", false, false)),
    ("Int8Array", ("Int8Array", false, false)),
    ("Uint8Array", ("Uint8Array", false, false)),
    ("Uint8ClampedArray", ("Uint8ClampedArray", false, false)),
    ("Int16Array", ("Int16Array", false, false)),
    ("Uint16Array", ("Uint16Array", false, false)),
    ("Int32Array", ("Int32Array", false, false)),
    ("Uint32Array", ("Uint32Array", false, false)),
    ("Float32Array", ("Float32Array", false, false)),
    ("Float64Array", ("Float64Array", false, false)),
    ("BigInt64Array", ("BigInt64Array", false, false)),
    ("BigUint64Array", ("BigUint64Array", false, false)),
    ("DataView", ("DataView", false, false)),
    ("DateTime", ("Date", false, false)),
    ("NaiveDateTime", ("Date", false ,false)),
    ("Date", ("Date", false, false)),
    ("JsDate", ("Date", false, false)),
    ("JsBuffer", ("Buffer", false, false)),
    ("Buffer", ("Buffer", false, false)),
    ("Vec", ("Array<{}>", false, false)),
    ("Result", ("Error | {}", false, true)),
    ("Error", ("Error", false, false)),
    ("JsError", ("Error", false, false)),
    ("JsTypeError", ("TypeError", false, false)),
    ("JsRangeError", ("RangeError", false, false)),
    ("ClassInstance", ("{}", false, false)),
    ("Function", ("({}) => {}", true, false)),
    ("FunctionRef", ("({}) => {}", true, false)),
    ("Either", ("{} | {}", false, true)),
    ("Either3", ("{} | {} | {}", false, true)),
    ("Either4", ("{} | {} | {} | {}", false, true)),
    ("Either5", ("{} | {} | {} | {} | {}", false, true)),
    ("Either6", ("{} | {} | {} | {} | {} | {}", false, true)),
    ("Either7", ("{} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either8", ("{} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either9", ("{} | {} | {} | {} | {} | {} | {} | {} | {}",false, true)),
    ("Either10", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either11", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either12", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either13", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either14", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either15", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either16", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either17", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either18", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either19", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either20", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either21", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either22", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either23", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either24", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either25", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("Either26", ("{} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}", false, true)),
    ("external", ("object", false, false)),
    ("Promise", ("Promise<{}>", false, false)),
    ("AbortSignal", ("AbortSignal", false, false)),
    ("JsGlobal", ("typeof global", false, false)),
    ("External", ("ExternalObject<{}>", false, false)),
    ("unknown", ("unknown", false, false)),
    ("Unknown", ("unknown", false, false)),
    ("JsUnknown", ("unknown", false, false)),
    ("This", ("this", false, false)),
    ("Rc", ("{}", false, false)),
    ("Arc", ("{}", false, false)),
    ("Mutex", ("{}", false, false)),
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

fn is_ts_union_type(rust_ty: &str) -> bool {
  KNOWN_TYPES
    .get(rust_ty)
    .map(|&(_, _, is_union_type)| is_union_type)
    .unwrap_or(false)
}

const TSFN_RUST_TY: &str = "ThreadsafeFunction";
const FUNCTION_TY: &str = "Function";
const FUNCTION_REF_TY: &str = "FunctionRef";

fn is_generic_function_type(rust_ty: &str) -> bool {
  rust_ty == TSFN_RUST_TY || rust_ty == FUNCTION_TY || rust_ty == FUNCTION_REF_TY
}

fn is_ts_function_type_notation(ty: &Type) -> bool {
  match ty {
    Type::Path(syn::TypePath { qself: None, path }) => {
      if let Some(syn::PathSegment { ident, .. }) = path.segments.last() {
        let rust_ty = ident.to_string();
        return KNOWN_TYPES
          .get(&*rust_ty)
          .map(|&(_, is_fn, _)| is_fn)
          .unwrap_or(false);
      }

      false
    }
    _ => false,
  }
}

// return (type, is_optional)
pub fn ty_to_ts_type(
  ty: &Type,
  is_return_ty: bool,
  is_struct_field: bool,
  convert_tuple_to_variadic: bool,
) -> (String, bool) {
  match ty {
    Type::Reference(r) => ty_to_ts_type(&r.elem, is_return_ty, is_struct_field, false),
    Type::Tuple(tuple) => {
      if tuple.elems.is_empty() {
        if convert_tuple_to_variadic {
          if is_return_ty {
            ("void".to_owned(), false)
          } else {
            ("".to_owned(), false)
          }
        } else {
          ("undefined".to_owned(), false)
        }
      } else if convert_tuple_to_variadic {
        let variadic = &tuple
          .elems
          .iter()
          .enumerate()
          .map(|(i, arg)| {
            let (ts_type, is_optional) = ty_to_ts_type(arg, false, false, false);
            r#fn::FnArg {
              arg: format!("arg{}", i),
              ts_type,
              is_optional,
            }
          })
          .collect::<r#fn::FnArgList>();
        (format!("{}", variadic), false)
      } else {
        (
          format!(
            "[{}]",
            tuple
              .elems
              .iter()
              .map(|elem| ty_to_ts_type(elem, false, false, false).0)
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
        let is_ts_union_type = is_ts_union_type(&rust_ty);
        let args = if let syn::PathArguments::AngleBracketed(arguments) = arguments {
          arguments
            .args
            .iter()
            .enumerate()
            .filter_map(|(index, arg)| match arg {
              syn::GenericArgument::Type(generic_ty) => Some(ty_to_ts_type(
                generic_ty,
                index == 1 && is_generic_function_type(&rust_ty),
                false,
                is_generic_function_type(&rust_ty),
              ))
              .map(|(mut ty, is_optional)| {
                if is_ts_union_type && is_ts_function_type_notation(generic_ty) {
                  ty = format!("({})", ty);
                }
                (ty, is_optional)
              }),
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
        } else if let Some(&(known_ty, _, _)) = KNOWN_TYPES.get(rust_ty.as_str()) {
          if rust_ty == "()" && is_return_ty {
            ts_ty = Some(("void".to_owned(), false));
          } else if known_ty.contains("{}") {
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
        } else if rust_ty == TSFN_RUST_TY {
          let fatal_tsfn = match args.get(1) {
            Some((arg, _)) => arg == "Fatal",
            _ => false,
          };
          let args = args.first().map(|(arg, _)| arg).unwrap();
          ts_ty = if fatal_tsfn {
            Some((format!("({}) => any", args), false))
          } else {
            Some((format!("(err: Error | null, {}) => any", args), false))
          };
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

      let (ty, is_optional) = ts_ty.unwrap_or_else(|| ("any".to_owned(), false));
      (
        (convert_tuple_to_variadic && !is_return_ty)
          .then(|| format!("arg: {ty}"))
          .unwrap_or(ty),
        is_optional,
      )
    }
    Type::Group(g) => ty_to_ts_type(&g.elem, is_return_ty, is_struct_field, false),
    Type::Array(a) => {
      let (element_type, is_optional) =
        ty_to_ts_type(&a.elem, is_return_ty, is_struct_field, false);
      (format!("{}[]", element_type), is_optional)
    }
    Type::Paren(p) => {
      let (element_type, is_optional) =
        ty_to_ts_type(&p.elem, is_return_ty, is_struct_field, false);
      (element_type, is_optional)
    }
    _ => ("any".to_owned(), false),
  }
}
