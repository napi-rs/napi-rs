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

const BUFFER_TYPE_IMPORT_SENTINEL: &str = "\0napi-rs-buffer-type-import\0";
const BUFFER_TYPE_IMPORT_MARKER_BASE: &str = "__NAPI_RS_TYPE_IMPORT_BUFFER__";

#[derive(Default, Debug)]
pub struct TypeDef {
  pub kind: String,
  pub name: String,
  pub original_name: Option<String>,
  pub def: String,
  pub js_mod: Option<String>,
  pub js_doc: JSDoc,
  /// The `#[napi]` types this definition refers to, recorded while its type
  /// strings were built. See [`TypeRefs`].
  pub type_refs: TypeRefs,
}

/// The `#[napi]` type references a [`TypeDef`]'s `def` text contains, so the
/// CLI can tell them apart from hand-written `ts_type` text when it fixes them
/// up across namespaces.
#[derive(Default, Debug, Clone, PartialEq, Eq)]
pub struct TypeRefs {
  /// References resolved to a type napi-derive had already seen, written as
  /// its path from the module root (`a.b.Type`, or bare `Type` for a
  /// top-level one). Inside a namespace the first segment can be shadowed
  /// (`b` inside `namespace a.b`), which only the CLI can see.
  pub root: Vec<String>,
  /// Rust type names napi-derive had not seen yet when it wrote the
  /// reference (a type declared later in the crate), written as-is. The CLI
  /// maps them to the type's JS path once every definition is known.
  pub unresolved: Vec<String>,
  /// Names spelled in hand-written TS text (`ts_type`, `ts_arg_type`,
  /// `ts_args_type`, `ts_return_type`, `ts_generic_types`) the definition
  /// holds. The CLI cannot tell such text apart from napi-derive's once they
  /// share a declaration, so it leaves a reference spelled like one of these
  /// as written.
  pub ts_override_names: Vec<String>,
}

#[derive(Default, Debug)]
pub struct JSDoc {
  blocks: Vec<Vec<String>>,
}

pub trait ToTypeDef {
  fn to_type_def(&self) -> Option<TypeDef>;
}

thread_local! {
  static ALIAS: RefCell<HashMap<String, String>> = Default::default();
  static TYPE_REFS: RefCell<Option<TypeRefs>> = const { RefCell::new(None) };
  /// The type parameters in scope (a generic `#[napi] type`'s), which name no
  /// `#[napi]` type.
  static TYPE_PARAMS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// Runs `f` with `type_params` in scope, so a reference to one of them is not
/// recorded as a `#[napi]` type reference.
pub(crate) fn with_type_params<T>(type_params: &[String], f: impl FnOnce() -> T) -> T {
  let outer = TYPE_PARAMS.with(|params| params.replace(type_params.to_vec()));
  let value = f();
  TYPE_PARAMS.with(|params| params.replace(outer));
  value
}

fn is_type_param(rust_ty: &str) -> bool {
  TYPE_PARAMS.with(|params| params.borrow().iter().any(|param| param == rust_ty))
}

/// The TS type of a slot `#[napi(ts_...)]` text may override: `ts_type` when
/// given, else `infer()`. The optional flag always comes from `infer()`, but
/// the references it records are dropped with its text, and the names
/// `ts_type` spells are recorded instead (see [`TypeRefs::ts_override_names`]).
pub(crate) fn ts_type_or_infer(
  ts_type: Option<&str>,
  infer: impl FnOnce() -> (String, bool),
) -> (String, bool) {
  match ts_type {
    Some(ts_type) => {
      record_ts_override(ts_type);
      let ((_, is_optional), _) = with_type_refs(infer);
      (ts_type.to_owned(), is_optional)
    }
    None => infer(),
  }
}

/// Records the dotted names hand-written TS text spells, as a superset of
/// the type references it holds.
pub(crate) fn record_ts_override(ts_type: &str) {
  // TypeScript allows spaces around the dots of a qualified name
  // (`models . Config`); the CLI reads it as `models.Config`.
  let mut joined = String::with_capacity(ts_type.len());
  let mut rest = ts_type;
  while let Some(dot) = rest.find('.') {
    joined.push_str(rest[..dot].trim_end());
    joined.push('.');
    rest = rest[dot + 1..].trim_start();
  }
  joined.push_str(rest);
  let ts_type = joined.as_str();
  let is_name_char = |c: char| c == '_' || c == '$' || c.is_alphanumeric();
  let mut names = Vec::new();
  let mut chars = ts_type.char_indices().peekable();
  while let Some((start, first)) = chars.next() {
    if !is_name_char(first) {
      continue;
    }
    let mut end = start + first.len_utf8();
    while let Some(&(i, c)) = chars.peek() {
      if is_name_char(c) || c == '.' {
        end = i + c.len_utf8();
        chars.next();
      } else {
        break;
      }
    }
    // A number (`9e3`) is no name.
    if !first.is_ascii_digit() {
      names.push(ts_type[start..end].trim_end_matches('.'));
    }
  }
  TYPE_REFS.with(|refs| {
    if let Some(refs) = refs.borrow_mut().as_mut() {
      for name in names {
        if !refs
          .ts_override_names
          .iter()
          .any(|existing| existing == name)
        {
          refs.ts_override_names.push(name.to_owned());
        }
      }
    }
  });
}

/// Runs `f` (one item's `to_type_def`) and records the `#[napi]` type
/// references its type strings contain into the returned definition.
pub(crate) fn collect_type_refs(f: impl FnOnce() -> Option<TypeDef>) -> Option<TypeDef> {
  let (type_def, type_refs) = with_type_refs(f);
  type_def.map(|mut type_def| {
    type_def.type_refs = type_refs;
    type_def
  })
}

/// Runs `f` and returns the `#[napi]` type references it recorded, apart from
/// the ones of the definition being built around it.
pub(crate) fn with_type_refs<T>(f: impl FnOnce() -> T) -> (T, TypeRefs) {
  let outer = TYPE_REFS.with(|refs| refs.borrow_mut().replace(TypeRefs::default()));
  let value = f();
  let type_refs = TYPE_REFS.with(|refs| std::mem::replace(&mut *refs.borrow_mut(), outer));
  (value, type_refs.unwrap_or_default())
}

/// Records `type_refs` again, for type text built earlier (a `Task`'s output
/// type) that is written into the definition being built now.
fn replay_type_refs(type_refs: &TypeRefs) {
  for name in &type_refs.root {
    record_type_ref(name, true);
  }
  for name in &type_refs.unresolved {
    record_type_ref(name, false);
  }
  for name in &type_refs.ts_override_names {
    record_ts_override(name);
  }
}

fn record_type_ref(name: &str, resolved: bool) {
  TYPE_REFS.with(|refs| {
    if let Some(refs) = refs.borrow_mut().as_mut() {
      let list = if resolved {
        &mut refs.root
      } else {
        &mut refs.unresolved
      };
      if !list.iter().any(|existing| existing == name) {
        list.push(name.to_owned());
      }
    }
  });
}

/// Registers `name` (a Rust type identifier) as an alias for `alias` (its JS
/// name), qualified by `js_mod` when the item was declared in a namespace, so
/// later lookups by Rust identifier resolve to a reference that's valid from
/// outside that namespace too.
fn add_alias(name: String, alias: String, js_mod: Option<&str>) {
  let alias = match js_mod {
    Some(js_mod) => format!("{js_mod}.{alias}"),
    None => alias,
  };
  ALIAS.with(|aliases| {
    aliases.borrow_mut().insert(name, alias);
  });
}

/// Escapes a string for safe embedding in JSON
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

/// Formats a JavaScript property name, adding quotes if it contains special characters
/// or starts with a digit that would make it an invalid identifier.
///
/// This function checks for characters that are known to be invalid in JavaScript
/// identifiers, rather than trying to enumerate all valid ones (which would need
/// complex Unicode identifier rules). This approach allows Unicode letters and
/// maintains backward compatibility.
pub fn format_js_property_name(js_name: &str) -> String {
  // Check if first character is a digit
  let starts_with_digit = js_name.chars().next().is_some_and(|c| c.is_ascii_digit());

  // Check for specific characters that are known to be invalid in JS identifiers
  // We explicitly check for invalid characters rather than trying to enumerate all
  // valid ones, which allows Unicode letters while catching common problematic chars.
  let has_invalid_chars = js_name.chars().any(|c| {
    matches!(
      c,
      '-' | ':'
        | ' '
        | '.'
        | '['
        | ']'
        | '@'
        | '#'
        | '$'  // Maintaining backward compatibility: $ was quoted in original implementation
        | '%'
        | '^'
        | '&'
        | '*'
        | '('
        | ')'
        | '+'
        | '='
        | '{'
        | '}'
        | '|'
        | '\\'
        | ';'
        | '\''
        | '"'
        | '<'
        | '>'
        | ','
        | '?'
        | '/'
        | '~'
        | '`'
        | '!'
    )
  });

  let needs_quotes = starts_with_digit || has_invalid_chars;

  if needs_quotes {
    format!("'{js_name}'")
  } else {
    js_name.to_string()
  }
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

    // Escape `*/` sequences to prevent premature comment termination
    fn escape_comment_close(s: &str) -> String {
      s.replace("*/", "*\\/")
    }

    if self.blocks.len() == 1 && self.blocks[0].len() == 1 {
      return writeln!(f, "/** {} */", escape_comment_close(&self.blocks[0][0]));
    }

    writeln!(f, "/**")?;
    for (i, block) in self.blocks.iter().enumerate() {
      for line in block {
        writeln!(f, " * {}", escape_comment_close(line))?;
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
    let uses_buffer_type = self.def.contains(BUFFER_TYPE_IMPORT_SENTINEL);
    let marker = if uses_buffer_type {
      let mut marker = BUFFER_TYPE_IMPORT_MARKER_BASE.to_owned();
      let mut suffix = 1;
      while self.def.contains(&marker) {
        marker = format!("{BUFFER_TYPE_IMPORT_MARKER_BASE}_{suffix}");
        suffix += 1;
      }
      marker
    } else {
      String::new()
    };
    let def = if uses_buffer_type {
      self.def.replace(BUFFER_TYPE_IMPORT_SENTINEL, "Buffer")
    } else {
      self.def.clone()
    };
    let js_mod = if let Some(js_mod) = &self.js_mod {
      format!(", \"js_mod\": \"{}\"", escape_json(js_mod))
    } else {
      "".to_string()
    };
    let original_name = if let Some(original_name) = &self.original_name {
      format!(", \"original_name\": \"{}\"", escape_json(original_name))
    } else {
      "".to_string()
    };
    let imported_types = if uses_buffer_type {
      format!(
        r#", "def_with_type_import_markers": "{}", "type_imports": [{{"marker": "{}", "name": "Buffer", "module": "buffer"}}]"#,
        escape_json(&self.def.replace(BUFFER_TYPE_IMPORT_SENTINEL, &marker)),
        marker,
      )
    } else {
      String::new()
    };

    let json_list = |key: &str, names: &[String]| {
      if names.is_empty() {
        return String::new();
      }
      let names = names
        .iter()
        .map(|name| format!("\"{}\"", escape_json(name)))
        .collect::<Vec<_>>()
        .join(", ");
      format!(", \"{key}\": [{names}]")
    };
    // A root-qualified reference only needs fixing up inside a namespace.
    let root_refs = if self.js_mod.is_some() {
      json_list("root_refs", &self.type_refs.root)
    } else {
      String::new()
    };
    let unresolved_refs = json_list("unresolved_refs", &self.type_refs.unresolved);
    let ts_override_names = json_list("ts_override_names", &self.type_refs.ts_override_names);

    write!(
      f,
      r#"{{"kind": "{}", "name": "{}", "js_doc": "{}", "def": "{}"{}{}{}{}{}{}}}"#,
      escape_json(&self.kind),
      escape_json(&self.name),
      escape_json(&self.js_doc.to_string()),
      escape_json(&def),
      original_name,
      js_mod,
      imported_types,
      root_refs,
      unresolved_refs,
      ts_override_names,
    )
  }
}

/// Mapping from `rust_type` to (`ts_type`, `is_ts_function_type_notation`, `is_ts_union_type`)
static KNOWN_TYPES: LazyLock<HashMap<&'static str, (&'static str, bool, bool)>> = LazyLock::new(
  || {
    let mut map = HashMap::default();

    // Primitive types (imported from crate::PRIMITIVE_TYPES)
    map.extend(crate::PRIMITIVE_TYPES.iter().cloned());

    // Basic object types
    map.extend([
      ("JsObject", ("object", false, false)),
      ("Object", ("object", false, false)),
      ("ObjectRef", ("object", false, false)),
      ("Array", ("unknown[]", false, false)),
      ("Value", ("any", false, false)),
      ("ClassInstance", ("{}", false, false)),
    ]);

    // Collection types
    map.extend([
      ("Map", ("Record<string, any>", false, false)),
      ("HashMap", ("Record<{}, {}>", false, false)),
      ("BTreeMap", ("Record<{}, {}>", false, false)),
      ("IndexMap", ("Record<{}, {}>", false, false)),
      ("HashSet", ("Set<{}>", false, false)),
      ("BTreeSet", ("Set<{}>", false, false)),
      ("IndexSet", ("Set<{}>", false, false)),
      ("Vec", ("Array<{}>", false, false)),
    ]);

    // TypedArray types
    map.extend([
      ("ArrayBuffer", ("ArrayBuffer", false, false)),
      ("JsArrayBuffer", ("ArrayBuffer", false, false)),
      ("Int8Array", ("Int8Array", false, false)),
      ("Int8ArraySlice", ("Int8Array", false, false)),
      ("Uint8Array", ("Uint8Array", false, false)),
      ("Uint8ArraySlice", ("Uint8Array", false, false)),
      ("Uint8ClampedArray", ("Uint8ClampedArray", false, false)),
      ("Uint8ClampedSlice", ("Uint8ClampedArray", false, false)),
      ("Int16Array", ("Int16Array", false, false)),
      ("Int16ArraySlice", ("Int16Array", false, false)),
      ("Uint16Array", ("Uint16Array", false, false)),
      ("Uint16ArraySlice", ("Uint16Array", false, false)),
      ("Int32Array", ("Int32Array", false, false)),
      ("Int32ArraySlice", ("Int32Array", false, false)),
      ("Uint32Array", ("Uint32Array", false, false)),
      ("Uint32ArraySlice", ("Uint32Array", false, false)),
      ("Float32Array", ("Float32Array", false, false)),
      ("Float32ArraySlice", ("Float32Array", false, false)),
      ("Float64Array", ("Float64Array", false, false)),
      ("Float64ArraySlice", ("Float64Array", false, false)),
      ("BigInt64Array", ("BigInt64Array", false, false)),
      ("BigInt64ArraySlice", ("BigInt64Array", false, false)),
      ("BigUint64Array", ("BigUint64Array", false, false)),
      ("BigUint64ArraySlice", ("BigUint64Array", false, false)),
      ("DataView", ("DataView", false, false)),
    ]);

    // Date and time types
    map.extend([
      ("DateTime", ("Date", false, false)),
      ("NaiveDateTime", ("Date", false, false)),
      ("Date", ("Date", false, false)),
      ("JsDate", ("Date", false, false)),
    ]);

    // Buffer types
    map.extend([
      ("JsBuffer", (BUFFER_TYPE_IMPORT_SENTINEL, false, false)),
      ("BufferSlice", (BUFFER_TYPE_IMPORT_SENTINEL, false, false)),
      ("Buffer", (BUFFER_TYPE_IMPORT_SENTINEL, false, false)),
    ]);

    // Error and Result types (note: Result is a union type)
    map.extend([
      ("Result", ("Error | {}", false, true)),
      ("Error", ("Error", false, false)),
      ("JsError", ("Error", false, false)),
      ("JsTypeError", ("TypeError", false, false)),
      ("JsRangeError", ("RangeError", false, false)),
    ]);

    // Function types (note: these use function type notation)
    map.extend([
      ("Function", ("({}) => {}", true, false)),
      ("FunctionRef", ("({}) => {}", true, false)),
    ]);

    // Stream types
    map.extend([("ReadableStream", ("ReadableStream<{}>", false, false))]);

    // Either types (union types for multiple variants)
    map.extend([
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
    ]);

    // Async and Promise types
    map.extend([
      ("Promise", ("Promise<{}>", false, false)),
      ("PromiseRaw", ("Promise<{}>", false, false)),
      ("AbortSignal", ("AbortSignal", false, false)),
    ]);

    // External and unknown types
    map.extend([
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
    ]);

    // Smart pointer types
    map.extend([
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

// ============================================================================
// Type Checking and Template Utilities
// ============================================================================

/// Fills a TypeScript type template with arguments
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

/// Checks if a Rust type maps to a TypeScript union type
fn is_ts_union_type(rust_ty: &str) -> bool {
  KNOWN_TYPES
    .get(rust_ty)
    .map(|&(_, _, is_union_type)| is_union_type)
    .unwrap_or(false)
}

// Type constants for function types
const TSFN_RUST_TY: &str = "ThreadsafeFunction";
const FUNCTION_TY: &str = "Function";
const FUNCTION_ARG_TY: &str = "FnArgs";
const FUNCTION_REF_TY: &str = "FunctionRef";

/// Checks if a Rust type is a generic function type
fn is_generic_function_type(rust_ty: &str) -> bool {
  rust_ty == TSFN_RUST_TY
    || rust_ty == FUNCTION_TY
    || rust_ty == FUNCTION_ARG_TY
    || rust_ty == FUNCTION_REF_TY
}

/// Checks if a type uses TypeScript function type notation
fn is_ts_function_type_notation(ty: &Type) -> bool {
  match ty {
    Type::Path(syn::TypePath {
      qself: None, path, ..
    }) => {
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

/// Handles conversion of Option<T> to TypeScript
fn handle_option_type(
  args: &[(String, bool)],
  is_struct_field: bool,
  is_return_ty: bool,
) -> Option<(String, bool)> {
  args.first().map(|(arg, _)| {
    if is_struct_field {
      return (arg.to_string(), true);
    };
    let is_arg_callback = arg.contains("=>");
    let arg = if is_arg_callback {
      format!("({arg})")
    } else {
      arg.clone()
    };
    (
      if is_return_ty {
        format!("{arg} | null")
      } else {
        format!("{arg} | undefined | null")
      },
      true,
    )
  })
}

/// Handles conversion of AsyncTask<T> to Promise<T>
fn handle_async_task_type(args: &[(String, bool)]) -> Option<(String, bool)> {
  r#struct::TASK_STRUCTS.with(|t| {
    let (output_type, _) = args.first()?.to_owned();
    if let Some((o, type_refs)) = t.borrow().get(&output_type) {
      replay_type_refs(type_refs);
      Some((format!("Promise<{o}>"), false))
    } else {
      Some(("Promise<unknown>".to_owned(), false))
    }
  })
}

/// Handles conversion of Reference<T> and WeakReference<T>
fn handle_reference_type(args: &[(String, bool)], rust_ty: String) -> Option<(String, bool)> {
  r#struct::TASK_STRUCTS.with(|t| {
    // Reference<T> => T
    if let Some(arg) = args.first() {
      let (output_type, _) = arg.to_owned();
      if let Some((o, type_refs)) = t.borrow().get(&output_type) {
        replay_type_refs(type_refs);
        Some((o.to_owned(), false))
      } else {
        Some((output_type, false))
      }
    } else {
      // Not NAPI-RS `Reference`
      Some((rust_ty, false))
    }
  })
}

/// Handles conversion of AsyncBlock<T> to Promise<T>
fn handle_async_block_type(args: &[(String, bool)], rust_ty: String) -> Option<(String, bool)> {
  if let Some(arg) = args.first() {
    Some((format!("Promise<{}>", arg.0), false))
  } else {
    // Not NAPI-RS `AsyncBlock`
    Some((rust_ty, false))
  }
}

/// Handles conversion of ThreadsafeFunction to TypeScript function type
fn handle_threadsafe_function_type(args: &[(String, bool)]) -> Option<(String, bool)> {
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
    let args = if fn_args.is_empty() {
      "(err: Error | null)".to_owned()
    } else {
      format!("(err: Error | null, {fn_args})")
    };
    Some((format!("({args} => {return_ty})"), false))
  } else if fn_args.is_empty() {
    Some((format!("(() => {return_ty})"), false))
  } else {
    Some((format!("(({fn_args}) => {return_ty})"), false))
  }
}

/// Handles known types from the KNOWN_TYPES map
fn handle_known_type(
  rust_ty: &str,
  known_ty: &str,
  args: Vec<(String, bool)>,
  is_return_ty: bool,
) -> Option<(String, bool)> {
  if rust_ty == "()" && is_return_ty {
    return Some(("void".to_owned(), false));
  }

  if !known_ty.contains("{}") {
    return Some((known_ty.to_owned(), false));
  }

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
    let mut filtered_args = if let Some(arg_indices) = KNOWN_TYPES_IGNORE_ARG.get(rust_ty) {
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
}

/// Handles generic type conversion and aliasing
fn handle_generic_type(rust_ty: &str, args: &[(String, bool)]) -> Option<(String, bool)> {
  let type_alias =
    ALIAS.with(|aliases| aliases.borrow().get(rust_ty).map(|a| (a.to_owned(), false)));
  match &type_alias {
    // A type parameter names no `#[napi]` type, even when one shares its name.
    _ if is_type_param(rust_ty) => {}
    Some((alias, _)) => record_type_ref(
      alias.split_once('<').map_or(alias.as_str(), |(t, _)| t),
      true,
    ),
    // `Self` is rewritten by the caller; anything else is a type not seen yet.
    None if rust_ty != "Self" => record_type_ref(rust_ty, false),
    None => {}
  }

  // Generic type handling
  if !args.is_empty() {
    let arg_str = args
      .iter()
      .map(|(arg, _)| arg.clone())
      .collect::<Vec<String>>()
      .join(", ");
    let mut ty = rust_ty;
    if let Some((alias, _)) = type_alias {
      // If alias contains '<', take the base type as &str, then convert to String for formatting
      ty = alias.split_once('<').map(|(t, _)| t).unwrap();
      return Some((format!("{}<{}>", ty, arg_str), false));
    }
    Some((format!("{}<{}>", ty, arg_str), false))
  } else {
    type_alias.or(Some((rust_ty.to_string(), false)))
  }
}

/// Processes generic arguments for a type path
fn process_generic_arguments(arguments: &syn::PathArguments, rust_ty: &str) -> Vec<(String, bool)> {
  let is_ts_union_type = is_ts_union_type(rust_ty);
  let mut is_function_with_lifetime = false;
  // Only `FnArgs<T>` unpacks an inner tuple `T` into variadic positional
  // params. `Function`, `FunctionRef`, and `ThreadsafeFunction` keep their
  // `Args` generic as a single value (which may itself be `FnArgs<...>`).
  let is_fn_args = rust_ty == FUNCTION_ARG_TY;
  let is_fn_like = is_generic_function_type(rust_ty);

  if let syn::PathArguments::AngleBracketed(arguments) = arguments {
    arguments
      .args
      .iter()
      .enumerate()
      .filter_map(|(index, arg)| match arg {
        syn::GenericArgument::Type(generic_ty) => {
          let mut is_return_type = false;
          if index == 1 && is_fn_like {
            is_return_type = true;
          }
          // if Type is Function, first argument is lifetime and second is params, third is return type
          // so we need to judge is_function_with_lifetime and set is_return_type
          // if not and just keep the origin's logic
          if is_function_with_lifetime {
            is_return_type = index != 1;
          }
          Some(ty_to_ts_type(generic_ty, is_return_type, false, is_fn_args)).map(
            |(mut ty, is_optional)| {
              if is_fn_like && !is_fn_args {
                ty = wrap_fn_like_arg(ty, generic_ty, is_return_type);
              }
              if is_ts_union_type && is_ts_function_type_notation(generic_ty) {
                ty = format!("({ty})");
              }
              (ty, is_optional)
            },
          )
        }
        // const Generic for `ThreadsafeFunction` generic
        syn::GenericArgument::Const(syn::Expr::Lit(syn::ExprLit {
          lit: syn::Lit::Bool(bo),
          ..
        })) => Some((bo.value.to_string(), false)),
        syn::GenericArgument::Lifetime(_) => {
          if index == 0 && is_fn_like {
            is_function_with_lifetime = true;
          }
          None
        }
        _ => None,
      })
      .collect::<Vec<_>>()
  } else {
    vec![]
  }
}

/// Normalizes a generic argument of `Function`, `FunctionRef`, or
/// `ThreadsafeFunction` so it slots into a TypeScript function signature.
///
/// - empty tuple `()` → `""` for params, `"void"` for the return slot
/// - non-empty tuple → wrap as `arg: [T1, T2, ...]` (a single tuple-typed arg)
/// - `FnArgs<T>` → leave as-is (already produces `arg: T` or a variadic spread)
/// - any other type → wrap as `arg: T`
fn wrap_fn_like_arg(ty: String, generic_ty: &Type, is_return_type: bool) -> String {
  if let Type::Tuple(tuple) = generic_ty {
    if tuple.elems.is_empty() {
      return if is_return_type {
        "void".to_owned()
      } else {
        String::new()
      };
    }
    if !is_return_type {
      return format!("arg: {ty}");
    }
    return ty;
  }
  if is_return_type || ty.is_empty() || is_fn_args_path(generic_ty) {
    return ty;
  }
  format!("arg: {ty}")
}

/// True iff `ty` is a path whose final segment is `FnArgs`.
fn is_fn_args_path(ty: &Type) -> bool {
  if let Type::Path(syn::TypePath {
    qself: None, path, ..
  }) = ty
  {
    if let Some(seg) = path.segments.last() {
      return seg.ident == FUNCTION_ARG_TY;
    }
  }
  false
}

/// Handles Type::Path conversion to TypeScript
fn handle_type_path(
  path: &syn::Path,
  is_return_ty: bool,
  is_struct_field: bool,
  convert_tuple_to_variadic: bool,
) -> (String, bool) {
  let mut is_passthrough_type = false;

  let ts_ty = if let Some(syn::PathSegment { ident, arguments }) = path.segments.last() {
    let rust_ty = ident.to_string();
    let args = process_generic_arguments(arguments, &rust_ty);

    // A type parameter in scope (`type List<Item> = Vec<Item>`) is written as
    // itself, never as a `#[napi]` type of the same Rust name.
    if path.segments.len() == 1 && arguments.is_none() && is_type_param(&rust_ty) {
      Some((rust_ty.clone(), false))
    } else if rust_ty == "Result" && is_return_ty {
      Some(args.first().unwrap().to_owned())
    } else if rust_ty == "Option" {
      handle_option_type(&args, is_struct_field, is_return_ty)
    } else if rust_ty == "AsyncTask" {
      handle_async_task_type(&args)
    } else if rust_ty == "Reference" || rust_ty == "WeakReference" {
      handle_reference_type(&args, rust_ty)
    } else if rust_ty == "AsyncBlock" {
      handle_async_block_type(&args, rust_ty)
    } else if rust_ty == "FnArgs" {
      is_passthrough_type = true;
      Some(args.first().unwrap().to_owned())
    } else if let Some(t) = crate::typegen::r#struct::CLASS_STRUCTS.with(|c| {
      c.borrow_mut()
        .get(rust_ty.as_str())
        .map(|c| c.qualified_name())
    }) {
      if !is_type_param(&rust_ty) {
        record_type_ref(&t, true);
      }
      Some((t, false))
    } else if let Some(&(known_ty, _, _)) = KNOWN_TYPES.get(rust_ty.as_str()) {
      handle_known_type(&rust_ty, known_ty, args, is_return_ty)
    } else if rust_ty == TSFN_RUST_TY {
      handle_threadsafe_function_type(&args)
    } else {
      handle_generic_type(&rust_ty, &args)
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
    Type::Path(syn::TypePath {
      qself: None, path, ..
    }) => handle_type_path(
      path,
      is_return_ty,
      is_struct_field,
      convert_tuple_to_variadic,
    ),
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
  use quote::ToTokens;

  use super::{
    add_alias, escape_json, format_js_property_name, handle_generic_type, ty_to_ts_type, JSDoc,
    ToTypeDef, TypeDef, TypeRefs, BUFFER_TYPE_IMPORT_MARKER_BASE, BUFFER_TYPE_IMPORT_SENTINEL,
  };

  #[test]
  fn type_def_display_escapes_all_json_fields() {
    let type_def = TypeDef {
      kind: "impl".to_owned(),
      name: "Quoted\"Name\\Line".to_owned(),
      original_name: Some("Original\nName".to_owned()),
      def: "method(): \"value\"".to_owned(),
      js_mod: Some("namespace\\\"name".to_owned()),
      js_doc: JSDoc::new(["A \"quoted\" doc"]),
      type_refs: TypeRefs {
        root: vec!["ns.\"Root\"".to_owned()],
        unresolved: vec!["Later\\".to_owned()],
        ts_override_names: vec!["a.\"B\"".to_owned()],
      },
    };

    let parsed: serde_json::Value =
      serde_json::from_str(&type_def.to_string()).expect("type definition must be valid JSON");

    assert_eq!(parsed["kind"].as_str(), Some(type_def.kind.as_str()));
    assert_eq!(parsed["name"].as_str(), Some(type_def.name.as_str()));
    assert_eq!(
      parsed["original_name"].as_str(),
      type_def.original_name.as_deref()
    );
    assert_eq!(parsed["def"].as_str(), Some(type_def.def.as_str()));
    assert_eq!(parsed["js_mod"].as_str(), type_def.js_mod.as_deref());
    assert_eq!(
      parsed["js_doc"].as_str(),
      Some(type_def.js_doc.to_string().as_str())
    );
    assert_eq!(parsed["root_refs"][0].as_str(), Some("ns.\"Root\""));
    assert_eq!(parsed["unresolved_refs"][0].as_str(), Some("Later\\"));
    assert_eq!(parsed["ts_override_names"][0].as_str(), Some("a.\"B\""));
  }

  #[test]
  fn type_def_display_preserves_imported_type_provenance() {
    let type_def = TypeDef {
      kind: "fn".to_owned(),
      name: "bufferPassThrough".to_owned(),
      def: format!(
        "function bufferPassThrough(value: {BUFFER_TYPE_IMPORT_SENTINEL}): {BUFFER_TYPE_IMPORT_SENTINEL}"
      ),
      ..Default::default()
    };

    let parsed: serde_json::Value =
      serde_json::from_str(&type_def.to_string()).expect("type definition must be valid JSON");

    assert_eq!(
      parsed["def"].as_str(),
      Some("function bufferPassThrough(value: Buffer): Buffer")
    );
    assert_eq!(
      parsed["def_with_type_import_markers"].as_str(),
      Some(
        "function bufferPassThrough(value: __NAPI_RS_TYPE_IMPORT_BUFFER__): __NAPI_RS_TYPE_IMPORT_BUFFER__"
      )
    );
    assert_eq!(
      parsed["type_imports"][0]["marker"].as_str(),
      Some(BUFFER_TYPE_IMPORT_MARKER_BASE)
    );
    assert_eq!(parsed["type_imports"][0]["name"].as_str(), Some("Buffer"));
    assert_eq!(parsed["type_imports"][0]["module"].as_str(), Some("buffer"));
  }

  #[test]
  fn type_def_display_chooses_a_structurally_unique_import_marker() {
    let type_def = TypeDef {
      kind: "fn".to_owned(),
      name: "bufferCollision".to_owned(),
      def: format!(
        "function bufferCollision(value: {BUFFER_TYPE_IMPORT_SENTINEL}, collision: {BUFFER_TYPE_IMPORT_MARKER_BASE}): {BUFFER_TYPE_IMPORT_SENTINEL}"
      ),
      ..Default::default()
    };

    let parsed: serde_json::Value =
      serde_json::from_str(&type_def.to_string()).expect("type definition must be valid JSON");

    assert_eq!(
      parsed["def"].as_str(),
      Some(
        "function bufferCollision(value: Buffer, collision: __NAPI_RS_TYPE_IMPORT_BUFFER__): Buffer"
      )
    );
    assert_eq!(
      parsed["type_imports"][0]["marker"].as_str(),
      Some("__NAPI_RS_TYPE_IMPORT_BUFFER___1")
    );
    assert_eq!(
      parsed["def_with_type_import_markers"].as_str(),
      Some(
        "function bufferCollision(value: __NAPI_RS_TYPE_IMPORT_BUFFER___1, collision: __NAPI_RS_TYPE_IMPORT_BUFFER__): __NAPI_RS_TYPE_IMPORT_BUFFER___1"
      )
    );
  }

  #[test]
  fn user_class_named_buffer_precedes_the_builtin_buffer_mapping() {
    crate::typegen::r#struct::CLASS_STRUCTS.with(|classes| {
      classes.borrow_mut().insert(
        "Buffer".to_owned(),
        crate::typegen::r#struct::ClassStructRef {
          js_name: "UserBuffer".to_owned(),
          js_mod: None,
        },
      );
    });
    let ty = syn::parse_str("Buffer").expect("Buffer must parse as a Rust type");
    assert_eq!(
      ty_to_ts_type(&ty, false, false, false),
      ("UserBuffer".to_owned(), false)
    );
    crate::typegen::r#struct::CLASS_STRUCTS.with(|classes| {
      classes.borrow_mut().clear();
    });
  }

  #[test]
  fn class_reference_across_namespaces_keeps_namespace_qualifier() {
    // Regression test for napi-rs/napi-rs#3406 (symptom 2): a function
    // referencing a namespaced class resolved to the bare `js_name`,
    // dropping the namespace. Two classes sharing a `js_name` in different
    // namespaces ("alpha"/"beta") must each resolve to their own
    // `<namespace>.<js_name>`, not a dangling unqualified name.
    crate::typegen::r#struct::CLASS_STRUCTS.with(|classes| {
      let mut classes = classes.borrow_mut();
      classes.insert(
        "AlphaClient".to_owned(),
        crate::typegen::r#struct::ClassStructRef {
          js_name: "Client".to_owned(),
          js_mod: Some("alpha".to_owned()),
        },
      );
      classes.insert(
        "BetaClient".to_owned(),
        crate::typegen::r#struct::ClassStructRef {
          js_name: "Client".to_owned(),
          js_mod: Some("beta".to_owned()),
        },
      );
    });

    let alpha_ty: syn::Type = syn::parse_str("AlphaClient").expect("AlphaClient must parse");
    let beta_ty: syn::Type = syn::parse_str("BetaClient").expect("BetaClient must parse");

    assert_eq!(
      ty_to_ts_type(&alpha_ty, false, false, false),
      ("alpha.Client".to_owned(), false)
    );
    assert_eq!(
      ty_to_ts_type(&beta_ty, false, false, false),
      ("beta.Client".to_owned(), false)
    );

    crate::typegen::r#struct::CLASS_STRUCTS.with(|classes| classes.borrow_mut().clear());
  }

  #[test]
  fn non_class_alias_across_namespaces_keeps_namespace_qualifier() {
    // Same underlying bug as #3406, but for the ALIAS-map path that enums,
    // consts, and type aliases resolve through (CLASS_STRUCTS only covers
    // classes/structs).
    add_alias("AlphaStatus".to_owned(), "Status".to_owned(), Some("alpha"));
    add_alias("BetaStatus".to_owned(), "Status".to_owned(), Some("beta"));

    assert_eq!(
      handle_generic_type("AlphaStatus", &[]),
      Some(("alpha.Status".to_owned(), false))
    );
    assert_eq!(
      handle_generic_type("BetaStatus", &[]),
      Some(("beta.Status".to_owned(), false))
    );
  }

  #[test]
  fn type_refs_record_the_napi_types_a_definition_names() {
    // napi-rs/napi-rs#3476: the CLI needs to know which references napi-derive
    // wrote (and which it could not resolve yet) to fix them up across
    // namespaces, without touching hand-written `ts_type` text.
    crate::typegen::r#struct::CLASS_STRUCTS.with(|classes| {
      classes.borrow_mut().insert(
        "RefsClass".to_owned(),
        crate::typegen::r#struct::ClassStructRef {
          js_name: "Client".to_owned(),
          js_mod: Some("outer.inner".to_owned()),
        },
      );
    });
    add_alias("RefsStatus".to_owned(), "Status".to_owned(), None);
    let ty: syn::Type =
      syn::parse_str("(Option<RefsClass>, Vec<RefsStatus>, RefsLater, Self, u32)")
        .expect("tuple must parse");

    let type_def = super::collect_type_refs(|| {
      Some(TypeDef {
        def: ty_to_ts_type(&ty, false, false, false).0,
        js_mod: Some("outer".to_owned()),
        ..Default::default()
      })
    })
    .expect("type def");

    assert_eq!(
      type_def.def,
      "[outer.inner.Client | undefined | null, Array<Status>, RefsLater, Self, number]"
    );
    assert_eq!(
      type_def.type_refs,
      TypeRefs {
        root: vec!["outer.inner.Client".to_owned(), "Status".to_owned()],
        unresolved: vec!["RefsLater".to_owned()],
        ..Default::default()
      }
    );
    let parsed: serde_json::Value =
      serde_json::from_str(&type_def.to_string()).expect("type definition must be valid JSON");
    assert_eq!(parsed["root_refs"][1].as_str(), Some("Status"));
    assert_eq!(parsed["unresolved_refs"][0].as_str(), Some("RefsLater"));

    // A top-level definition does not need its root references.
    let top_level = TypeDef {
      js_mod: None,
      ..type_def
    };
    let parsed: serde_json::Value =
      serde_json::from_str(&top_level.to_string()).expect("type definition must be valid JSON");
    assert!(parsed.get("root_refs").is_none());
    assert_eq!(parsed["unresolved_refs"][0].as_str(), Some("RefsLater"));

    crate::typegen::r#struct::CLASS_STRUCTS
      .with(|classes| classes.borrow_mut().remove("RefsClass"));
  }

  #[test]
  fn async_task_outputs_record_the_task_output_type_refs() {
    // A function returning `AsyncTask<T>` writes the text stored when the
    // `Task` impl was processed, so it must record that text's references too.
    let ((output, _), task_refs) = super::with_type_refs(|| {
      crate::typegen::r#struct::CLASS_STRUCTS.with(|classes| {
        classes.borrow_mut().insert(
          "TaskRefsOutput".to_owned(),
          crate::typegen::r#struct::ClassStructRef {
            js_name: "Output".to_owned(),
            js_mod: Some("q".to_owned()),
          },
        );
      });
      let ty: syn::Type = syn::parse_str("TaskRefsOutput").expect("type must parse");
      ty_to_ts_type(&ty, false, true, false)
    });
    assert_eq!(output, "q.Output");
    crate::typegen::r#struct::TASK_STRUCTS.with(|tasks| {
      tasks
        .borrow_mut()
        .insert("TaskRefsTask".to_owned(), (output, task_refs));
    });

    let ty: syn::Type = syn::parse_str("AsyncTask<TaskRefsTask>").expect("type must parse");
    let ((def, _), type_refs) = super::with_type_refs(|| ty_to_ts_type(&ty, false, true, false));

    assert_eq!(def, "Promise<q.Output>");
    assert_eq!(type_refs.root, vec!["q.Output".to_owned()]);

    crate::typegen::r#struct::TASK_STRUCTS.with(|tasks| tasks.borrow_mut().remove("TaskRefsTask"));
    crate::typegen::r#struct::CLASS_STRUCTS
      .with(|classes| classes.borrow_mut().remove("TaskRefsOutput"));
  }

  fn test_fn(name: &str, sig: &str, ts: &[(&str, &str)]) -> crate::NapiFn {
    let sig: syn::Signature = syn::parse_str(sig).expect("signature must parse");
    let ts = |key: &str| {
      ts.iter()
        .find(|(k, _)| *k == key)
        .map(|(_, v)| (*v).to_owned())
    };
    let args = sig
      .inputs
      .iter()
      .filter_map(|arg| match arg {
        syn::FnArg::Typed(p) => Some(crate::NapiFnArg {
          kind: crate::NapiFnArgKind::PatType(Box::new(p.clone())),
          ts_arg_type: ts(&p.pat.to_token_stream().to_string()),
        }),
        syn::FnArg::Receiver(_) => None,
      })
      .collect();
    let ret = match sig.output {
      syn::ReturnType::Default => None,
      syn::ReturnType::Type(_, ty) => Some(*ty),
    };
    crate::NapiFn {
      name: syn::Ident::new(name, proc_macro2::Span::call_site()),
      js_name: name.to_owned(),
      symbol_for: None,
      well_known_symbol: None,
      module_exports: false,
      attrs: vec![],
      args,
      ret,
      is_ret_result: false,
      is_async: false,
      within_async_runtime: false,
      fn_self: Some(crate::FnSelf::Ref),
      kind: crate::FnKind::Normal,
      vis: syn::Visibility::Inherited,
      parent: Some(syn::Ident::new("OvHolder", proc_macro2::Span::call_site())),
      parent_js_name: Some("Holder".to_owned()),
      strict: false,
      return_if_invalid: false,
      js_mod: Some("api".to_owned()),
      ts_generic_types: ts("ts_generic_types"),
      ts_type: None,
      ts_args_type: ts("ts_args_type"),
      ts_return_type: ts("ts_return_type"),
      skip_typescript: false,
      comments: vec![],
      parent_is_generator: false,
      parent_is_async_generator: false,
      writable: true,
      enumerable: true,
      configurable: true,
      catch_unwind: false,
      unsafe_: false,
      register_name: syn::Ident::new(name, proc_macro2::Span::call_site()),
      no_export: false,
    }
  }

  fn test_field(name: &str, ty: &str, ts_type: Option<&str>) -> crate::NapiStructField {
    crate::NapiStructField {
      name: syn::Member::Named(syn::Ident::new(name, proc_macro2::Span::call_site())),
      js_name: name.to_owned(),
      symbol_for: None,
      well_known_symbol: None,
      ty: syn::parse_str(ty).expect("type must parse"),
      getter: true,
      setter: true,
      writable: true,
      enumerable: true,
      configurable: true,
      comments: vec![],
      skip_typescript: false,
      ts_type: ts_type.map(str::to_owned),
      has_lifetime: false,
    }
  }

  #[test]
  fn ts_overrides_do_not_record_the_inferred_type_refs() {
    // napi-rs/napi-rs#3476 review: `#[napi(ts_arg_type = "Input")] x: Input`
    // inside `namespace api` means `api.Input`; recording the Rust type's
    // reference made the CLI rewrite it to the top-level `Input`.
    add_alias("OvInput".to_owned(), "Input".to_owned(), None);
    add_alias("OvOther".to_owned(), "Other".to_owned(), None);
    let napi = crate::Napi {
      item: crate::NapiItem::Impl(crate::NapiImpl {
        name: syn::Ident::new("OvHolder", proc_macro2::Span::call_site()),
        js_name: "Holder".to_owned(),
        has_lifetime: false,
        items: vec![
          test_fn("hand", "fn hand(x: OvInput)", &[("x", "Input")]),
          test_fn(
            "handRet",
            "fn hand_ret() -> OvInput",
            &[("ts_return_type", "Input")],
          ),
          test_fn(
            "handArgs",
            "fn hand_args(x: OvInput)",
            &[("ts_args_type", "x: Input")],
          ),
          test_fn(
            "handGeneric",
            "fn hand_generic(x: u32)",
            &[("ts_generic_types", "T extends Generic")],
          ),
          // The neighbouring method's own reference is still recorded.
          test_fn("generated", "fn generated(y: OvOther)", &[]),
        ],
        task_output_type: None,
        iterator_yield_type: None,
        iterator_next_type: None,
        iterator_return_type: None,
        async_iterator_yield_type: None,
        async_iterator_next_type: None,
        async_iterator_return_type: None,
        js_mod: Some("api".to_owned()),
        comments: vec![],
        register_name: syn::Ident::new("OvHolder", proc_macro2::Span::call_site()),
      }),
    };

    let type_def = napi.to_type_def().expect("type def");
    assert_eq!(
      type_def.def,
      " hand(x: Input): void\n handRet(): Input\n handArgs(x: Input): void\n handGeneric<T extends Generic>(x: number): void\n generated(y: Other): void"
    );
    assert_eq!(
      type_def.type_refs,
      TypeRefs {
        root: vec!["Other".to_owned()],
        ts_override_names: ["Input", "x", "T", "extends", "Generic"]
          .map(str::to_owned)
          .to_vec(),
        ..Default::default()
      }
    );
    let parsed: serde_json::Value =
      serde_json::from_str(&type_def.to_string()).expect("type definition must be valid JSON");
    assert_eq!(parsed["root_refs"][0].as_str(), Some("Other"));
    assert_eq!(parsed["ts_override_names"][0].as_str(), Some("Input"));

    // A field's `ts_type` too, while the field keeps its optional flag.
    let napi = crate::Napi {
      item: crate::NapiItem::Struct(crate::NapiStruct {
        name: syn::Ident::new("OvHoldsInput", proc_macro2::Span::call_site()),
        js_name: "HoldsInput".to_owned(),
        comments: vec![],
        js_mod: Some("api".to_owned()),
        use_nullable: false,
        register_name: syn::Ident::new("OvHoldsInput", proc_macro2::Span::call_site()),
        kind: crate::NapiStructKind::Object(crate::NapiObject {
          fields: vec![
            test_field("hand", "Option<OvInput>", Some("Input")),
            test_field("generated", "OvOther", None),
          ],
          object_from_js: true,
          object_to_js: true,
          is_tuple: false,
        }),
        has_lifetime: false,
        is_generator: false,
        is_async_generator: false,
        type_tag: None,
      }),
    };
    let type_def = napi.to_type_def().expect("type def");
    assert_eq!(type_def.def, "hand?: Input\ngenerated: Other");
    assert_eq!(type_def.type_refs.root, vec!["Other".to_owned()]);
    assert_eq!(
      type_def.type_refs.ts_override_names,
      vec!["Input".to_owned()]
    );

    super::ALIAS.with(|aliases| {
      let mut aliases = aliases.borrow_mut();
      aliases.remove("OvInput");
      aliases.remove("OvOther");
      aliases.remove("OvHoldsInput");
    });
    crate::typegen::r#struct::CLASS_STRUCTS
      .with(|classes| classes.borrow_mut().remove("OvHoldsInput"));
  }

  #[test]
  fn type_params_are_not_recorded_as_type_refs() {
    // napi-rs/napi-rs#3476 review: `type ItemList<Item> = Vec<Item>` names its
    // own parameter, not a `#[napi]` type `Item` declared before or after it.
    add_alias("TpSeen".to_owned(), "TpSeen".to_owned(), None);
    add_alias("TpOther".to_owned(), "Other".to_owned(), None);
    // Registered under other JS names, so a substitution would show.
    add_alias(
      "TpRenamed".to_owned(),
      "JsRenamed".to_owned(),
      Some("models"),
    );
    crate::typegen::r#struct::CLASS_STRUCTS.with(|classes| {
      classes.borrow_mut().insert(
        "TpClass".to_owned(),
        crate::typegen::r#struct::ClassStructRef {
          js_name: "TpClass".to_owned(),
          js_mod: None,
        },
      );
      classes.borrow_mut().insert(
        "TpMoved".to_owned(),
        crate::typegen::r#struct::ClassStructRef {
          js_name: "Moved".to_owned(),
          js_mod: Some("models".to_owned()),
        },
      );
    });
    let napi_type = |type_params: &[&str]| crate::Napi {
      item: crate::NapiItem::Type(crate::NapiType {
        name: syn::Ident::new("TpList", proc_macro2::Span::call_site()),
        js_name: "TpList".to_owned(),
        type_params: type_params.iter().map(|p| (*p).to_owned()).collect(),
        value: syn::parse_str("(Vec<TpSeen>, TpClass, TpLater, TpOther)").expect("type must parse"),
        register_name: syn::Ident::new("TpList", proc_macro2::Span::call_site()),
        skip_typescript: false,
        js_mod: Some("ns".to_owned()),
        comments: vec![],
      }),
    };

    let type_def = napi_type(&["TpSeen", "TpClass", "TpLater"])
      .to_type_def()
      .expect("type def");
    assert_eq!(type_def.def, "[Array<TpSeen>, TpClass, TpLater, Other]");
    assert_eq!(
      type_def.type_refs,
      TypeRefs {
        root: vec!["Other".to_owned()],
        ..Default::default()
      }
    );

    // A parameter named like a `#[napi]` type with another JS name or
    // namespace stays bare, not `models.JsRenamed` / `models.Moved`.
    let shadowing = crate::Napi {
      item: crate::NapiItem::Type(crate::NapiType {
        name: syn::Ident::new("TpShadow", proc_macro2::Span::call_site()),
        js_name: "TpShadow".to_owned(),
        type_params: vec!["TpRenamed".to_owned(), "TpMoved".to_owned()],
        value: syn::parse_str("(Vec<TpRenamed>, Option<TpMoved>)").expect("type must parse"),
        register_name: syn::Ident::new("TpShadow", proc_macro2::Span::call_site()),
        skip_typescript: false,
        js_mod: Some("ns".to_owned()),
        comments: vec![],
      }),
    }
    .to_type_def()
    .expect("type def");
    assert_eq!(
      shadowing.def,
      "[Array<TpRenamed>, TpMoved | undefined | null]"
    );
    assert_eq!(shadowing.type_refs, TypeRefs::default());

    // Without the parameters in scope, the same names are references.
    let type_def = napi_type(&[]).to_type_def().expect("type def");
    assert_eq!(
      type_def.type_refs,
      TypeRefs {
        root: ["TpSeen", "TpClass", "Other"].map(str::to_owned).to_vec(),
        unresolved: vec!["TpLater".to_owned()],
        ..Default::default()
      }
    );

    super::ALIAS.with(|aliases| {
      let mut aliases = aliases.borrow_mut();
      aliases.remove("TpSeen");
      aliases.remove("TpOther");
      aliases.remove("TpList");
      aliases.remove("TpRenamed");
      aliases.remove("TpShadow");
    });
    crate::typegen::r#struct::CLASS_STRUCTS.with(|classes| {
      let mut classes = classes.borrow_mut();
      classes.remove("TpClass");
      classes.remove("TpMoved");
    });
  }

  #[test]
  fn ts_override_names_are_the_dotted_names_of_the_text() {
    let ((), type_refs) = super::with_type_refs(|| {
      super::record_ts_override("x: a.b.Input<T> | 'lit-1' | Map<string, $Y_2>, ...rest: 9e3[]");
      super::record_ts_override("y: models . Config, z: [A, ...B]");
    });
    assert_eq!(
      type_refs.ts_override_names,
      [
        "x",
        "a.b.Input",
        "T",
        "lit",
        "Map",
        "string",
        "$Y_2",
        "rest",
        "y",
        "models.Config",
        "z",
        "A",
        "B"
      ]
      .map(str::to_owned)
      .to_vec()
    );
  }

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

  // Tests for format_js_property_name
  #[test]
  fn threadsafe_function_empty_args_omits_dangling_comma() {
    let ty: syn::Type =
      syn::parse_str("ThreadsafeFunction<(), ()>").expect("ThreadsafeFunction<(), ()> must parse");
    let (ts, _) = ty_to_ts_type(&ty, false, false, false);
    assert_eq!(ts, "((err: Error | null) => void)");
    assert!(!ts.contains(", )"));
    assert!(!ts.contains(",)"));
  }

  #[test]
  fn threadsafe_function_in_either_is_parenthesized() {
    let ty: syn::Type = syn::parse_str("Either<String, ThreadsafeFunction<i32, i32>>")
      .expect("Either<String, ThreadsafeFunction<i32, i32>> must parse");
    let (ts, _) = ty_to_ts_type(&ty, false, false, false);
    assert_eq!(ts, "string | ((err: Error | null, arg: number) => number)");
  }

  #[test]
  fn test_format_js_property_name_valid_identifiers() {
    // Simple ASCII identifiers should not be quoted
    assert_eq!(format_js_property_name("foo"), "foo");
    assert_eq!(format_js_property_name("myProperty"), "myProperty");
    assert_eq!(format_js_property_name("_private"), "_private");
    assert_eq!(format_js_property_name("__proto__"), "__proto__");
    assert_eq!(format_js_property_name("camelCase"), "camelCase");
    assert_eq!(format_js_property_name("PascalCase"), "PascalCase");
    assert_eq!(format_js_property_name("with123numbers"), "with123numbers");
  }

  #[test]
  fn test_format_js_property_name_unicode_identifiers() {
    // Unicode letters should be allowed (not quoted)
    assert_eq!(format_js_property_name("café"), "café");
    assert_eq!(format_js_property_name("日本語"), "日本語");
    assert_eq!(format_js_property_name("Ελληνικά"), "Ελληνικά");
    assert_eq!(format_js_property_name("мир"), "мир");
    assert_eq!(format_js_property_name("世界"), "世界");
  }

  #[test]
  fn test_format_js_property_name_starts_with_digit() {
    // Identifiers starting with digits should be quoted
    assert_eq!(format_js_property_name("0invalid"), "'0invalid'");
    assert_eq!(format_js_property_name("123"), "'123'");
    assert_eq!(format_js_property_name("9Lives"), "'9Lives'");
  }

  #[test]
  fn test_format_js_property_name_special_chars() {
    // Properties with special characters should be quoted
    assert_eq!(format_js_property_name("kebab-case"), "'kebab-case'");
    assert_eq!(format_js_property_name("with space"), "'with space'");
    assert_eq!(format_js_property_name("dot.notation"), "'dot.notation'");
    assert_eq!(format_js_property_name("array[0]"), "'array[0]'");
    assert_eq!(format_js_property_name("@decorator"), "'@decorator'");
    assert_eq!(format_js_property_name("#private"), "'#private'");
    assert_eq!(format_js_property_name("percent%"), "'percent%'");
    assert_eq!(format_js_property_name("caret^"), "'caret^'");
    assert_eq!(format_js_property_name("ampersand&"), "'ampersand&'");
    assert_eq!(format_js_property_name("star*"), "'star*'");
    assert_eq!(format_js_property_name("paren("), "'paren('");
    assert_eq!(format_js_property_name("paren)"), "'paren)'");
    assert_eq!(format_js_property_name("plus+"), "'plus+'");
    assert_eq!(format_js_property_name("equals="), "'equals='");
    assert_eq!(format_js_property_name("brace{"), "'brace{'");
    assert_eq!(format_js_property_name("brace}"), "'brace}'");
    assert_eq!(format_js_property_name("pipe|"), "'pipe|'");
    assert_eq!(format_js_property_name("backslash\\"), "'backslash\\'");
    assert_eq!(format_js_property_name("semicolon;"), "'semicolon;'");
    assert_eq!(format_js_property_name("quote'"), "'quote''");
    assert_eq!(format_js_property_name("doublequote\""), "'doublequote\"'");
    assert_eq!(format_js_property_name("less<"), "'less<'");
    assert_eq!(format_js_property_name("greater>"), "'greater>'");
    assert_eq!(format_js_property_name("comma,"), "'comma,'");
    assert_eq!(format_js_property_name("question?"), "'question?'");
    assert_eq!(format_js_property_name("slash/"), "'slash/'");
    assert_eq!(format_js_property_name("tilde~"), "'tilde~'");
    assert_eq!(format_js_property_name("backtick`"), "'backtick`'");
    assert_eq!(format_js_property_name("exclamation!"), "'exclamation!'");
  }

  #[test]
  fn test_format_js_property_name_dollar_sign() {
    // Dollar sign should be quoted for backward compatibility
    assert_eq!(format_js_property_name("$var"), "'$var'");
    assert_eq!(format_js_property_name("jQuery$"), "'jQuery$'");
    assert_eq!(format_js_property_name("$"), "'$'");
  }

  #[test]
  fn test_format_js_property_name_colon_namespace() {
    // Colons (common in XML/namespaced properties) should be quoted
    assert_eq!(format_js_property_name("xml:lang"), "'xml:lang'");
    assert_eq!(format_js_property_name("xlink:href"), "'xlink:href'");
  }

  #[test]
  fn test_format_js_property_name_mixed() {
    // Mixed cases
    assert_eq!(format_js_property_name("valid_name_123"), "valid_name_123");
    assert_eq!(
      format_js_property_name("invalid-name-123"),
      "'invalid-name-123'"
    );
    assert_eq!(format_js_property_name("café_bar"), "café_bar");
    assert_eq!(format_js_property_name("café-bar"), "'café-bar'");
  }
}
