use std::{
  cell::RefCell,
  collections::HashMap,
  fmt::{self, Display, Formatter},
  sync::LazyLock,
};

mod r#const;
mod r#enum;
mod r#fn;
pub(crate) mod r#struct;
mod r#type;

use syn::{PathSegment, Type, TypePath, TypeSlice};

#[derive(Default, Debug)]
pub struct TypeDef {
  pub kind: String,
  pub name: String,
  pub original_name: Option<String>,
  pub def: String,
  pub js_mod: Option<String>,
  pub js_doc: JSDoc,
}

thread_local! {
  static ALIAS: RefCell<HashMap<String, String>> = Default::default();
}

fn add_alias(name: String, alias: String) {
  ALIAS.with(|aliases| {
    aliases.borrow_mut().insert(name, alias);
  });
}

fn escape_json(src: &str) -> String {
  use std::fmt::Write;
  let mut escaped = String::with_capacity(src.len());
  let mut utf16_buf = [0u16; 2];

  for c in src.chars() {
    match c {
      '\x08' => escaped += "\\b",
      '\x0c' => escaped += "\\f",
      '\n' => escaped += "\\n",
      '\r' => escaped += "\\r",
      '\t' => escaped += "\\t",
      '"' => escaped += "\\\"",
      '\\' => escaped += "\\\\",
      ' ' => escaped += " ",
      c if c.is_ascii_graphic() => escaped.push(c),
      c => {
        let encoded = c.encode_utf16(&mut utf16_buf);
        for utf16 in encoded {
          write!(escaped, "\\u{utf16:04X}").unwrap();
        }
      }
    }
  }

  escaped
}

#[derive(Default, Debug)]
pub struct JSDoc {
  blocks: Vec<Vec<String>>,
}

impl JSDoc {
  pub fn new<I, S>(initial_lines: I) -> JSDoc
  where
    I: IntoIterator<Item = S>,
    S: Into<String>,
  {
    let block = Self::cleanup_lines(initial_lines);
    if block.is_empty() {
      return Self { blocks: vec![] };
    }

    Self {
      blocks: vec![block],
    }
  }

  pub fn add_block<I, S>(&mut self, lines: I)
  where
    I: IntoIterator<Item = S>,
    S: Into<String>,
  {
    let v: Vec<String> = Self::cleanup_lines(lines);

    if !v.is_empty() {
      self.blocks.push(v);
    }
  }

  fn cleanup_lines<I, S>(lines: I) -> Vec<String>
  where
    I: IntoIterator<Item = S>,
    S: Into<String>,
  {
    let raw: Vec<String> = lines.into_iter().map(Into::into).collect();

    if let (Some(first_non_blank), Some(last_non_blank)) = (
      raw.iter().position(|l| !l.trim().is_empty()),
      raw.iter().rposition(|l| !l.trim().is_empty()),
    ) {
      // Find the minimum indentation level (excluding empty lines)
      let min_indent = raw[first_non_blank..=last_non_blank]
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);

      raw[first_non_blank..=last_non_blank]
        .iter()
        .map(|l| {
          if l.trim().is_empty() {
            String::new()
          } else if l.len() >= min_indent {
            l[min_indent..].to_owned()
          } else {
            l.to_owned()
          }
        })
        .collect()
    } else {
      Vec::new()
    }
  }
}

impl Display for JSDoc {
  fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
    if self.blocks.is_empty() {
      return Ok(());
    }

    if self.blocks.len() == 1 && self.blocks[0].len() == 1 {
      return writeln!(f, "/** {} */", self.blocks[0][0]);
    }

    writeln!(f, "/**")?;
    for (i, block) in self.blocks.iter().enumerate() {
      for line in block {
        writeln!(f, " * {line}")?;
      }
      if i + 1 != self.blocks.len() {
        writeln!(f, " *")?;
      }
    }
    writeln!(f, " */")
  }
}

impl Display for TypeDef {
  fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
    let js_mod = if let Some(js_mod) = &self.js_mod {
      format!(", \"js_mod\": \"{js_mod}\"")
    } else {
      "".to_string()
    };
    let original_name = if let Some(original_name) = &self.original_name {
      format!(", \"original_name\": \"{original_name}\"")
    } else {
      "".to_string()
    };

    write!(
      f,
      r#"{{"kind": "{}", "name": "{}", "js_doc": "{}", "def": "{}"{}{}}}"#,
      self.kind,
      self.name,
      escape_json(&self.js_doc.to_string()),
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
static KNOWN_TYPES: LazyLock<HashMap<&'static str, (&'static str, bool, bool)>> = LazyLock::new(
  || {
    let mut map = HashMap::default();
    map.extend(crate::PRIMITIVE_TYPES.iter().cloned());
    map.extend([
    ("JsObject", ("object", false, false)),
    ("Object", ("object", false, false)),
    ("ObjectRef", ("object", false, false)),
    ("Array", ("unknown[]", false, false)),
    ("Value", ("any", false, false)),
    ("Map", ("Record<string, any>", false, false)),
    ("HashMap", ("Record<{}, {}>", false, false)),
    ("BTreeMap", ("Record<{}, {}>", false, false)),
    ("IndexMap", ("Record<{}, {}>", false, false)),
    ("HashSet", ("Set<{}>", false, false)),
    ("BTreeSet", ("Set<{}>", false, false)),
    ("IndexSet", ("Set<{}>", false, false)),
    ("ArrayBuffer", ("ArrayBuffer", false, false)),
    ("JsArrayBuffer", ("ArrayBuffer", false, false)),
    ("Int8Array", ("Int8Array", false, false)),
    ("Uint8Array", ("Uint8Array", false, false)),
    ("Uint8ClampedArray", ("Uint8ClampedArray", false, false)),
    ("Uint8ClampedSlice", ("Uint8ClampedArray", false, false)),
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
    ("BufferSlice", ("Buffer", false, false)),
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
    ("ReadableStream", ("ReadableStream<{}>", false, false)),
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
    ("Promise", ("Promise<{}>", false, false)),
    ("PromiseRaw", ("Promise<{}>", false, false)),
    ("AbortSignal", ("AbortSignal", false, false)),
    ("JsGlobal", ("typeof global", false, false)),
    ("JsExternal", ("object", false, false)),
    ("external", ("object", false, false)),
    ("External", ("ExternalObject<{}>", false, false)),
    ("ExternalRef", ("ExternalObject<{}>", false, false)),
    ("unknown", ("unknown", false, false)),
    ("Unknown", ("unknown", false, false)),
    ("UnknownRef", ("unknown", false, false)),
    ("UnknownReturnValue", ("unknown", false, false)),
    ("JsUnknown", ("unknown", false, false)),
    ("This", ("this", false, false)),
    ("Rc", ("{}", false, false)),
    ("Arc", ("{}", false, false)),
    ("Mutex", ("{}", false, false)),
  ]);

    map
  },
);

static KNOWN_TYPES_IGNORE_ARG: LazyLock<HashMap<&'static str, Vec<usize>>> = LazyLock::new(|| {
  [
    ("HashMap", vec![2]),  // HashMap<K, V, S> is same with HashMap<K, V>
    ("HashSet", vec![1]),  // HashSet<T, S> is same with HashSet<T>
    ("IndexMap", vec![2]), // IndexMap<K, V, S> is same with IndexMap<K, V>
    ("IndexSet", vec![1]), // IndexSet<T, S> is same with HashSet<T>
  ]
  .into()
});

/// Formats a JavaScript property name, adding quotes if it contains special characters
/// or starts with a digit that would make it an invalid identifier.
pub fn format_js_property_name(js_name: &str) -> String {
  let needs_quotes: bool = js_name.chars().next().is_some_and(|c| c.is_ascii_digit())
    || js_name.contains("-")
    || js_name.contains(":")
    || js_name.contains(" ")
    || js_name.contains(".")
    || js_name.contains("[")
    || js_name.contains("]")
    || js_name.contains("@")
    || js_name.contains("#")
    || js_name.contains("$")
    || js_name.contains("%")
    || js_name.contains("^")
    || js_name.contains("&")
    || js_name.contains("*")
    || js_name.contains("(")
    || js_name.contains(")")
    || js_name.contains("+")
    || js_name.contains("=")
    || js_name.contains("{")
    || js_name.contains("}")
    || js_name.contains("|")
    || js_name.contains("\\")
    || js_name.contains(";")
    || js_name.contains("'")
    || js_name.contains("\"")
    || js_name.contains("<")
    || js_name.contains(">")
    || js_name.contains(",")
    || js_name.contains("?")
    || js_name.contains("/")
    || js_name.contains("~")
    || js_name.contains("`")
    || js_name.contains("!");

  if needs_quotes {
    format!("'{js_name}'")
  } else {
    js_name.to_string()
  }
}

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
const FUNCTION_ARG_TY: &str = "FnArgs";
const FUNCTION_REF_TY: &str = "FunctionRef";

fn is_generic_function_type(rust_ty: &str) -> bool {
  rust_ty == TSFN_RUST_TY
    || rust_ty == FUNCTION_TY
    || rust_ty == FUNCTION_ARG_TY
    || rust_ty == FUNCTION_REF_TY
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
              arg: format!("arg{i}"),
              ts_type,
              is_optional,
            }
          })
          .collect::<r#fn::FnArgList>();
        (format!("{variadic}"), false)
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
      let mut is_passthrough_type = false;
      let ts_ty = if let Some(syn::PathSegment { ident, arguments }) = path.segments.last() {
        let rust_ty = ident.to_string();
        let is_ts_union_type = is_ts_union_type(&rust_ty);
        let mut is_function_with_lifetime = false;
        let args = if let syn::PathArguments::AngleBracketed(arguments) = arguments {
          arguments
            .args
            .iter()
            .enumerate()
            .filter_map(|(index, arg)| match arg {
              syn::GenericArgument::Type(generic_ty) => {
                let mut is_return_type = false;
                if index == 1 && is_generic_function_type(&rust_ty) {
                  is_return_type = true;
                }
                // if Type is Function, first argument is lifetime and second is params, third is return type
                // so we need to judge is_function_with_lifetime and set is_return_type
                // if not and just keep the origin's logic
                if is_function_with_lifetime {
                  is_return_type = index != 1;
                }
                Some(ty_to_ts_type(
                  generic_ty,
                  is_return_type,
                  false,
                  // index == 2 is for ThreadsafeFunction with ErrorStrategy
                  is_generic_function_type(&rust_ty),
                ))
                .map(|(mut ty, is_optional)| {
                  if is_ts_union_type && is_ts_function_type_notation(generic_ty) {
                    ty = format!("({ty})");
                  }
                  (ty, is_optional)
                })
              }
              // const Generic for `ThreadsafeFunction` generic
              syn::GenericArgument::Const(syn::Expr::Lit(syn::ExprLit {
                lit: syn::Lit::Bool(bo),
                ..
              })) => Some((bo.value.to_string(), false)),
              syn::GenericArgument::Lifetime(_) => {
                if index == 0 && is_generic_function_type(&rust_ty) {
                  is_function_with_lifetime = true;
                }
                None
              }
              _ => None,
            })
            .collect::<Vec<_>>()
        } else {
          vec![]
        };

        if rust_ty == "Result" && is_return_ty {
          Some(args.first().unwrap().to_owned())
        } else if rust_ty == "Option" {
          args.first().map(|(arg, _)| {
            (
              if is_struct_field {
                arg.to_string()
              } else if is_return_ty {
                format!("{arg} | null")
              } else {
                format!("{arg} | undefined | null")
              },
              true,
            )
          })
        } else if rust_ty == "AsyncTask" {
          r#struct::TASK_STRUCTS.with(|t| {
            let (output_type, _) = args.first().unwrap().to_owned();
            if let Some(o) = t.borrow().get(&output_type) {
              Some((format!("Promise<{o}>"), false))
            } else {
              Some(("Promise<unknown>".to_owned(), false))
            }
          })
        } else if rust_ty == "Reference" || rust_ty == "WeakReference" {
          r#struct::TASK_STRUCTS.with(|t| {
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
          })
        } else if rust_ty == "AsyncBlock" {
          if let Some(arg) = args.first() {
            Some((format!("Promise<{}>", arg.0), false))
          } else {
            // Not NAPI-RS `AsyncBlock`
            Some((rust_ty, false))
          }
        } else if rust_ty == "FnArgs" {
          is_passthrough_type = true;
          Some(args.first().unwrap().to_owned())
        } else if let Some(&(known_ty, _, _)) = KNOWN_TYPES.get(rust_ty.as_str()) {
          if rust_ty == "()" && is_return_ty {
            Some(("void".to_owned(), false))
          } else if known_ty.contains("{}") {
            let args = args.into_iter().map(|(arg, _)| arg);
            if rust_ty.starts_with("Either") {
              let union_args = args.fold(vec![], |mut acc, cur| {
                if !acc.contains(&cur) {
                  acc.push(cur);
                }
                acc
              });
              // EitherN has the same ts types, like Either<f64, u32> -> number
              if union_args.len() == 1 {
                Some((union_args[0].to_owned(), false))
              } else {
                Some((fill_ty(known_ty, union_args), false))
              }
            } else {
              let mut filtered_args =
                if let Some(arg_indices) = KNOWN_TYPES_IGNORE_ARG.get(rust_ty.as_str()) {
                  args
                    .enumerate()
                    .filter(|(i, _)| !arg_indices.contains(i))
                    .map(|(_, arg)| arg)
                    .collect::<Vec<_>>()
                } else {
                  args.collect::<Vec<_>>()
                };
              if rust_ty.starts_with("Function") && filtered_args.is_empty() {
                filtered_args = vec!["arg?: unknown".to_owned(), "unknown".to_owned()];
              }

              Some((fill_ty(known_ty, filtered_args), false))
            }
          } else {
            Some((known_ty.to_owned(), false))
          }
        } else if let Some(t) = crate::typegen::r#struct::CLASS_STRUCTS
          .with(|c| c.borrow_mut().get(rust_ty.as_str()).cloned())
        {
          Some((t, false))
        } else if rust_ty == TSFN_RUST_TY {
          let handled_tsfn = match args.get(4) {
            Some((arg, _)) => arg == "true",
            _ => true,
          };
          let fn_args = args
            .get(2)
            .or_else(|| args.first())
            .map(|(arg, _)| {
              // If the argument is just a type without parameter names (e.g., "string"),
              // we need to add a parameter name for function signatures
              if arg.contains(':') || arg.is_empty() {
                // Already has parameter names or is empty
                arg.clone()
              } else {
                // Single type without parameter name, add one
                format!("arg: {arg}")
              }
            })
            .unwrap();
          let return_ty = args
            .get(1)
            .map(|(ty, _)| ty.clone())
            .unwrap_or("any".to_owned());
          if handled_tsfn {
            Some((
              format!("((err: Error | null, {fn_args}) => {return_ty})"),
              false,
            ))
          } else {
            Some((format!("(({fn_args}) => {return_ty})"), false))
          }
        } else {
          // there should be runtime registered type in else
          let type_alias = ALIAS.with(|aliases| {
            aliases
              .borrow()
              .get(rust_ty.as_str())
              .map(|a| (a.to_owned(), false))
          });

          // Generic type handling
          if !args.is_empty() {
            let arg_str = args
              .iter()
              .map(|(arg, _)| arg.clone())
              .collect::<Vec<String>>()
              .join(", ");
            let mut ty = rust_ty;
            if let Some((alias, _)) = type_alias {
              ty = alias.split_once('<').map(|(t, _)| t.to_string()).unwrap();
            }

            Some((format!("{ty}<{arg_str}>"), false))
          } else {
            type_alias.or(Some((rust_ty, false)))
          }
        }
      } else {
        None
      };

      let (ty, is_optional) = ts_ty.unwrap_or_else(|| ("any".to_owned(), false));
      (
        if convert_tuple_to_variadic && !is_return_ty && !is_passthrough_type {
          format!("arg: {ty}")
        } else {
          ty
        },
        is_optional,
      )
    }
    Type::Group(g) => ty_to_ts_type(&g.elem, is_return_ty, is_struct_field, false),
    Type::Array(a) => {
      let (element_type, is_optional) =
        ty_to_ts_type(&a.elem, is_return_ty, is_struct_field, false);
      (format!("{element_type}[]"), is_optional)
    }
    Type::Paren(p) => {
      let (element_type, is_optional) =
        ty_to_ts_type(&p.elem, is_return_ty, is_struct_field, false);
      (element_type, is_optional)
    }
    Type::Slice(TypeSlice { elem, .. }) => {
      if let Type::Path(TypePath { path, .. }) = &**elem {
        if let Some(PathSegment { ident, .. }) = path.segments.last() {
          if let Some(js_type) = crate::TYPEDARRAY_SLICE_TYPES.get(&ident.to_string().as_str()) {
            return (js_type.to_string(), false);
          }
        }
      }
      ("any[]".to_owned(), false)
    }
    _ => ("any".to_owned(), false),
  }
}

#[cfg(test)]
mod tests {
  use super::escape_json;

  #[test]
  fn test_escape_json_escaped_quotes() {
    // Test the specific case reported in issue #2502
    let input = r#"\\"g+sx\\""#;
    let result = escape_json(input);

    // Verify the result can be parsed as JSON
    let json_string = format!(r#"{{"comment": "{result}"}}"#);
    let parsed: serde_json::Value =
      serde_json::from_str(&json_string).expect("Should parse as valid JSON");

    if let Some(comment) = parsed.get("comment").and_then(|v| v.as_str()) {
      assert_eq!(comment, r#"\\"g+sx\\""#);
    } else {
      panic!("Failed to extract comment from parsed JSON");
    }
  }

  #[test]
  fn test_escape_json_basic_escapes() {
    assert_eq!(escape_json(r#"test"quote"#), r#"test\"quote"#);
    assert_eq!(escape_json("test\nline"), r#"test\nline"#);
    assert_eq!(escape_json("test\tTab"), r#"test\tTab"#);
    assert_eq!(escape_json("test\\backslash"), "test\\\\backslash");
  }

  #[test]
  fn test_escape_json_multiple_escapes() {
    assert_eq!(
      escape_json(r#"test\\"multiple\\""#),
      r#"test\\\\\"multiple\\\\\""#
    );
    assert_eq!(escape_json(r#"\\\\"#), r#"\\\\\\\\"#);
  }

  #[test]
  fn test_escape_json_trailing_backslash() {
    assert_eq!(escape_json(r#"test\"#), r#"test\\"#);
  }
}
