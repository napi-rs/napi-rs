use std::cell::Cell;
use std::collections::HashMap;
use std::sync::{
  atomic::{AtomicUsize, Ordering},
  Mutex, OnceLock,
};

use napi_derive_backend::{bail_span, BindgenResult, Diagnostic};
use proc_macro2::{Delimiter, Ident, Span, TokenTree};
use quote::ToTokens;
use syn::parse::{Parse, ParseStream};
use syn::spanned::Spanned;
use syn::{parse_quote, Attribute, Token};

use crate::parser::AnyIdent;

static ATTRS: OnceLock<AttributeParseState> = OnceLock::new();
static STRUCTS: OnceLock<StructParseState> = OnceLock::new();

#[derive(Default)]
struct StructParseState {
  parsed: Mutex<HashMap<String, ParsedStruct>>,
}

struct ParsedStruct {
  js_name: String,
  ctor_defined: bool,
  disposable: bool,
}

#[derive(Default)]
struct AttributeParseState {
  parsed: AtomicUsize,
  #[allow(unused)]
  checks: AtomicUsize,
}

#[derive(Debug)]
/// Parsed attributes from a `#[napi(..)]`.
pub struct BindgenAttrs {
  /// Whether `#[napi]` attribute exists
  pub exists: bool,
  /// List of parsed attributes
  pub attrs: Vec<(Cell<bool>, BindgenAttr)>,
  /// Span of original attribute
  pub span: Span,
}

// NOTE: borrowed from wasm-bindgen
// some of them may useless in #[napi] macro
macro_rules! attrgen {
  ($mac:ident) => {
    $mac! {
      (catch_unwind, CatchUnwind(Span)),
      (async_runtime, AsyncRuntime(Span)),
      (module_exports, ModuleExports(Span)),
      (js_name, JsName(Span, String, Span)),
      (symbol_for, SymbolFor(Span, String, Span)),
      (well_known_symbol, WellKnownSymbol(Span, String, Span)),
      (constructor, Constructor(Span)),
      (factory, Factory(Span)),
      (getter, Getter(Span, Option<Ident>)),
      (setter, Setter(Span, Option<Ident>)),
      (readonly, Readonly(Span)),
      (enumerable, Enumerable(Span, Option<bool>), true),
      (writable, Writable(Span, Option<bool>), true),
      (configurable, Configurable(Span, Option<bool>), true),
      (skip, Skip(Span)),
      (strict, Strict(Span)),
      (return_if_invalid, ReturnIfInvalid(Span)),
      (object, Object(Span)),
      (object_from_js, ObjectFromJs(Span, Option<bool>), true),
      (object_to_js, ObjectToJs(Span, Option<bool>), true),
      (custom_finalize, CustomFinalize(Span)),
      (disposable, Disposable(Span)),
      (namespace, Namespace(Span, String, Span)),
      (type_tag, TypeTag(Span, String, Span)),
      (iterator, Iterator(Span)),
      (async_iterator, AsyncIterator(Span)),
      (ts_args_type, TsArgsType(Span, String, Span)),
      (ts_return_type, TsReturnType(Span, String, Span)),
      (ts_type, TsType(Span, String, Span)),
      (ts_generic_types, TsGenericTypes(Span, String, Span)),
      (string_enum, StringEnum(Span, Option<(String, Span)>)),
      (use_nullable, UseNullable(Span, Option<bool>), false),
      (discriminant, Discriminant(Span, String, Span)),
      (discriminant_case, DiscriminantCase(Span, String, Span)),
      (transparent, Transparent(Span)),
      (array, Array(Span)),
      (no_export, NoExport(Span)),

      // impl later
      // (inspectable, Inspectable(Span)),
      // (typescript_custom_section, TypescriptCustomSection(Span)),
      (skip_typescript, SkipTypescript(Span)),
      // (getter_with_clone, GetterWithClone(Span)),

      // For testing purposes only.
      // (assert_no_shim, AssertNoShim(Span)),
    }
  };
}

macro_rules! methods {
  ($(($name:ident, $variant:ident($($contents:tt)*) $($extra_tokens:tt)*),)*) => {
    $(methods!(@method $name, $variant($($contents)*) $($extra_tokens)*);)*

    #[cfg(feature = "strict")]
    #[allow(unused)]
    pub fn check_used(&self) -> Result<(), Diagnostic> {
      // Account for the fact this method was called
      let attrs = ATTRS.get_or_init(|| AttributeParseState::default());
      attrs.checks.fetch_add(1, Ordering::SeqCst);

      let mut errors = Vec::new();
      for (used, attr) in self.attrs.iter() {
        if used.get() {
            continue
        }
        let span = match attr {
          $(BindgenAttr::$variant(span, ..) => span,)*
        };
        errors.push(Diagnostic::span_error(*span, "unused #[napi] attribute"));
      }
      Diagnostic::from_vec(errors)
    }

    #[cfg(not(feature = "strict"))]
    #[allow(unused)]
    pub fn check_used(&self) -> Result<(), Diagnostic> {
        // Account for the fact this method was called
      let attrs = ATTRS.get_or_init(AttributeParseState::default);
      attrs.checks.fetch_add(1, Ordering::SeqCst);
      Ok(())
    }
  };

  (@method $name:ident, $variant:ident(Span, String, Span)) => {
    #[allow(unused)]
    pub fn $name(&self) -> Option<(&str, Span)> {
      self.attrs
        .iter()
        .filter_map(|a| match &a.1 {
          BindgenAttr::$variant(_, s, span) => {
            a.0.set(true);
            Some((&s[..], *span))
          }
          _ => None,
        })
        .next()
    }
  };

  (@method $name:ident, $variant:ident(Span, Option<(String, Span)>)) => {
    #[allow(unused)]
    pub fn $name(&self) -> Option<Option<&(String, Span)>> {
      self.attrs
        .iter()
        .filter_map(|a| match &a.1 {
          BindgenAttr::$variant(_, s) => {
            a.0.set(true);
            Some(s.as_ref())
          }
          _ => None,
        })
        .next()
    }
  };

  (@method $name:ident, $variant:ident(Span, Option<bool>), $default_value:literal) => {
    #[allow(unused)]
    pub fn $name(&self) -> bool {
      self.attrs
        .iter()
        .filter_map(|a| match &a.1 {
          BindgenAttr::$variant(_, s) => {
            a.0.set(true);
            *s
          }
          _ => None,
        })
        .next()
        .unwrap_or($default_value)
    }
  };

  (@method $name:ident, $variant:ident(Span, Vec<String>, Vec<Span>)) => {
    #[allow(unused)]
    pub fn $name(&self) -> Option<(&[String], &[Span])> {
      self.attrs
        .iter()
        .filter_map(|a| match &a.1 {
          BindgenAttr::$variant(_, ss, spans) => {
            a.0.set(true);
            Some((&ss[..], &spans[..]))
          }
          _ => None,
        })
        .next()
      }
  };

  (@method $name:ident, $variant:ident(Span, $($other:tt)*)) => {
    #[allow(unused)]
    pub fn $name(&self) -> Option<&$($other)*> {
      self.attrs
        .iter()
        .filter_map(|a| match &a.1 {
          BindgenAttr::$variant(_, s) => {
            a.0.set(true);
            Some(s)
          }
          _ => None,
        })
        .next()
      }
  };

  (@method $name:ident, $variant:ident($($other:tt)*)) => {
    #[allow(unused)]
    pub fn $name(&self) -> Option<&$($other)*> {
      self.attrs
        .iter()
        .filter_map(|a| match &a.1 {
          BindgenAttr::$variant(s) => {
            a.0.set(true);
            Some(s)
          }
          _ => None,
        })
        .next()
    }
  };
}

impl BindgenAttrs {
  /// Find and parse the napi attributes.
  pub fn find(attrs: &mut Vec<syn::Attribute>) -> Result<BindgenAttrs, Diagnostic> {
    for (index, attr) in attrs.iter().enumerate() {
      let attr = BindgenAttrs::try_from(attr)?;
      if attr.exists {
        attrs.remove(index);

        return Ok(attr);
      }
    }

    Ok(BindgenAttrs::default())
  }

  /// The `writable`, `enumerable` and `configurable` flags, in that order, each
  /// `None` when it is not written out. `writable()` and the others fill a
  /// missing flag with `true` instead.
  pub fn given_property_flags(&self) -> [Option<bool>; 3] {
    let mut flags = [None; 3];
    for (used, attr) in self.attrs.iter() {
      let (index, value) = match attr {
        BindgenAttr::Writable(_, value) => (0, value),
        BindgenAttr::Enumerable(_, value) => (1, value),
        BindgenAttr::Configurable(_, value) => (2, value),
        _ => continue,
      };
      used.set(true);
      // The first one wins, as in `writable()`.
      flags[index] = flags[index].or(*value);
    }
    flags
  }

  attrgen!(methods);
}

impl TryFrom<&Attribute> for BindgenAttrs {
  type Error = Diagnostic;

  fn try_from(attr: &Attribute) -> Result<Self, Self::Error> {
    let mut ret = BindgenAttrs {
      exists: false,
      attrs: vec![],
      span: Span::call_site(),
    };

    let is_napi =
      attr.path().segments.last().map(|s| s.ident.to_string()) == Some("napi".to_string());
    let is_cfg_attr = attr
      .meta
      .path()
      .segments
      .first()
      .map(|s| s.ident.to_string())
      == Some("cfg_attr".to_string());

    if is_napi {
      ret.exists = true;
      ret.span = attr.span();

      let tts = attr.meta.to_token_stream().into_iter();
      let group = match tts.last() {
        // #[napi(xxx)]
        //   ^^^^^^^^^
        Some(TokenTree::Group(d)) => d,
        // #[napi]
        //   ^^^^
        Some(TokenTree::Ident(_)) => parse_quote!(()),
        _ => bail_span!(attr, "invalid #[napi] attribute"),
      };

      if group.delimiter() != Delimiter::Parenthesis {
        bail_span!(attr, "malformed #[napi] attribute");
      }

      let mut attrs: BindgenAttrs = syn::parse2(group.stream())?;
      ret.attrs.append(&mut attrs.attrs);
    }

    if is_cfg_attr {
      let cfg_attr_list = attr.meta.require_list()?;
      // #[cfg_attr(condition, attr_to_apply)]
      // We parse the arguments of cfg_attr.
      let mut args_iter = cfg_attr_list
        .parse_args_with(syn::punctuated::Punctuated::<syn::Meta, Token![,]>::parse_terminated)?
        .into_iter();
      if let Some(arg) = args_iter.next_back() {
        if arg.path().segments.last().map(|s| s.ident.to_string()) == Some("napi".to_string()) {
          ret.exists = true;
          ret.span = arg.span();
          let tts = arg.to_token_stream().into_iter();
          let group = match tts.last() {
            // #[napi(xxx)]
            //   ^^^^^^^^^
            Some(TokenTree::Group(d)) => d,
            // #[napi]
            //   ^^^^
            Some(TokenTree::Ident(_)) => parse_quote!(()),
            _ => bail_span!(attr, "invalid #[napi] attribute"),
          };

          if group.delimiter() != Delimiter::Parenthesis {
            bail_span!(attr, "malformed #[napi] attribute");
          }

          let mut attrs: BindgenAttrs = syn::parse2(group.stream())?;
          ret.attrs.append(&mut attrs.attrs);
        }
      }
    }

    Ok(ret)
  }
}

impl Default for BindgenAttrs {
  fn default() -> BindgenAttrs {
    // Add 1 to the list of parsed attribute sets. We'll use this counter to
    // sanity check that we call `check_used` an appropriate number of
    // times.
    let attrs = ATTRS.get_or_init(AttributeParseState::default);
    attrs.parsed.fetch_add(1, Ordering::SeqCst);
    BindgenAttrs {
      span: Span::call_site(),
      attrs: Vec::new(),
      exists: false,
    }
  }
}

macro_rules! gen_bindgen_attr {
  ($( ($method:ident, $variant:ident($($associated_data:tt)*) $($extra_tokens:tt)*) ,)*) => {
    /// The possible attributes in the `#[napi]`.
    #[derive(Debug)]
    #[allow(unused)]
    pub enum BindgenAttr {
      $($variant($($associated_data)*)),*
    }
  }
}

attrgen!(gen_bindgen_attr);

pub fn record_struct(ident: &Ident, js_name: String, opts: &BindgenAttrs) {
  let state = STRUCTS.get_or_init(StructParseState::default);
  let mut map = state.parsed.lock().unwrap();
  let struct_name = ident.to_string();

  map.insert(
    struct_name,
    ParsedStruct {
      js_name,
      ctor_defined: opts.constructor().is_some(),
      disposable: opts.disposable().is_some(),
    },
  );
}

pub fn is_recorded_struct_disposable(ident: &Ident) -> bool {
  let state = STRUCTS.get_or_init(StructParseState::default);
  let map = state.parsed.lock().unwrap();
  map
    .get(&ident.to_string())
    .is_some_and(|parsed| parsed.disposable)
}

pub fn check_recorded_struct_for_impl(ident: &Ident, opts: &BindgenAttrs) -> BindgenResult<String> {
  let state = STRUCTS.get_or_init(StructParseState::default);
  let mut map = state.parsed.lock().unwrap();
  let struct_name = ident.to_string();
  if let Some(parsed) = map.get_mut(&struct_name) {
    if opts.constructor().is_some() && !cfg!(debug_assertions) {
      if parsed.ctor_defined {
        bail_span!(
          ident,
          "Constructor has already been defined for struct `{}`",
          &struct_name
        );
      } else {
        parsed.ctor_defined = true;
      }
    }

    Ok(parsed.js_name.clone())
  } else {
    bail_span!(
      ident,
      "Did not find struct `{}` parsed before expand #[napi] for impl",
      &struct_name,
    )
  }
}

impl Parse for BindgenAttrs {
  fn parse(input: ParseStream) -> syn::Result<Self> {
    let mut attrs = BindgenAttrs::default();
    if input.is_empty() {
      return Ok(attrs);
    }

    let opts = syn::punctuated::Punctuated::<_, syn::token::Comma>::parse_terminated(input)?;
    for attr in &opts {
      if let BindgenAttr::Namespace(_, namespace, span) = attr {
        validate_namespace(namespace).map_err(|message| syn::Error::new(*span, message))?;
      }
    }
    attrs.attrs = opts.into_iter().map(|c| (Cell::new(false), c)).collect();
    Ok(attrs)
  }
}

/// Words that cannot be the root of a dotted namespace. The root is a binding in the ESM
/// and browser loaders (`const { root } = nativeBinding`, `export const root = ...`), which
/// are module code, so the words reserved in strict mode are out too. TypeScript also rejects
/// the reserved words as a namespace name (TS2819).
const RESERVED_NAMESPACE_ROOTS: &[&str] = &[
  // ReservedWord
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  // Reserved in strict mode code
  "implements",
  "interface",
  "let",
  "package",
  "private",
  "protected",
  "public",
  "static",
  // Not a binding name in strict mode code
  "arguments",
  "eval",
  // Reserved by the NAPI-RS type generation
  "globalThis",
];

/// Whether `segment` is a JavaScript IdentifierName. It uses the `XID_*` properties of the
/// Unicode version that the resolved `unicode-ident` ships. These leave out a few rare
/// characters that `ID_*` (what ECMAScript uses) takes, and they can be newer than the
/// TypeScript scanner: TypeScript 6.0 rejects letters added in Unicode 16 (TS1127), such as
/// U+10D50, in the generated d.ts, though the runtime and Node accept them.
fn is_identifier_name(segment: &str) -> bool {
  let mut chars = segment.chars();
  chars
    .next()
    .is_some_and(|c| c == '$' || c == '_' || unicode_ident::is_xid_start(c))
    && chars
      .all(|c| c == '$' || c == '\u{200C}' || c == '\u{200D}' || unicode_ident::is_xid_continue(c))
}

/// Checks a `namespace` value, which nests at runtime: `"a.b"` is `exports.a.b`.
///
/// Every namespace must be non-empty, have no control character (category Cc) or JavaScript
/// line terminator (U+2028, U+2029) and no `__proto__` segment. None of these can work: `""`,
/// control characters and line terminators break the generated d.ts and loaders, a NUL fails
/// the load, and `__proto__` sets a prototype instead of a property (see below).
///
/// A dotted namespace must also be valid in the generated d.ts (`export declare namespace
/// a.b`) and loaders, so each segment must be an identifier and the root must be a name the
/// ESM loader can bind. A namespace without a dot is not held to these rules, so it keeps
/// building as before: `"default"` or `"class"` works through the CommonJS loader, and any
/// name works through `exports[name]` when the JS binding is not generated (`--no-js`).
pub(crate) fn validate_namespace(namespace: &str) -> Result<(), String> {
  if namespace.is_empty() {
    return Err("namespace must not be empty".to_owned());
  }
  // U+2028 and U+2029 are not Cc, but JavaScript reads them as line breaks, like `\n`.
  if let Some(c) = namespace
    .chars()
    .find(|c| c.is_control() || matches!(c, '\u{2028}' | '\u{2029}'))
  {
    return Err(format!(
      "namespace `{}` must not contain a control or line terminator character, found U+{:04X}",
      namespace.escape_debug(),
      u32::from(c)
    ));
  }
  // `__proto__` would be set with `exports.__proto__ = ...` by the CommonJS loader, and by any
  // copy of the exports object with `Object.assign` or a bundler's interop helper, which
  // replaces the prototype of the target instead of adding the namespace to it.
  if namespace.split('.').any(|segment| segment == "__proto__") {
    return Err(format!(
      "namespace `{namespace}` must not use `__proto__` as a name"
    ));
  }
  if !namespace.contains('.') {
    return Ok(());
  }
  for segment in namespace.split('.') {
    if segment.is_empty() {
      return Err(format!(
        "namespace `{namespace}` has an empty segment; write the parts separated by single dots, as in `a.b`"
      ));
    }
    if !is_identifier_name(segment) {
      return Err(format!(
        "namespace `{namespace}`: `{segment}` is not a JavaScript identifier; each part of a dotted namespace must be one"
      ));
    }
  }
  let root = namespace.split('.').next().unwrap_or_default();
  if RESERVED_NAMESPACE_ROOTS.contains(&root) {
    return Err(format!(
      "namespace `{namespace}`: `{root}` is reserved and cannot be the first part of a dotted namespace, which is exported under that name"
    ));
  }
  Ok(())
}

impl Parse for BindgenAttr {
  fn parse(input: ParseStream) -> syn::Result<Self> {
    let original = input.fork();
    let attr: AnyIdent = input.parse()?;
    let attr = attr.0;
    let attr_span = attr.span();
    let attr_string = attr.to_string();
    let raw_attr_string = format!("r#{attr_string}");

    macro_rules! parsers {
      ($(($name:ident, $($contents:tt)*),)*) => {
        $(
          if attr_string == stringify!($name) || raw_attr_string == stringify!($name) {
            parsers!(
              @parser
              $($contents)*
            );
          }
        )*
      };

      (@parser $variant:ident(Span)) => ({
        return Ok(BindgenAttr::$variant(attr_span));
      });

      (@parser $variant:ident(Span, Ident)) => ({
        input.parse::<Token![=]>()?;
        let ident = input.parse::<AnyIdent>()?.0;
        return Ok(BindgenAttr::$variant(attr_span, ident))
      });

      (@parser $variant:ident(Span, Option<Ident>)) => ({
        if input.parse::<Token![=]>().is_ok() {
          let ident = input.parse::<AnyIdent>()?.0;
          return Ok(BindgenAttr::$variant(attr_span, Some(ident)))
        } else {
          return Ok(BindgenAttr::$variant(attr_span, None));
        }
      });

        (@parser $variant:ident(Span, syn::Path)) => ({
            input.parse::<Token![=]>()?;
            return Ok(BindgenAttr::$variant(attr_span, input.parse()?));
        });

        (@parser $variant:ident(Span, syn::Expr)) => ({
            input.parse::<Token![=]>()?;
            return Ok(BindgenAttr::$variant(attr_span, input.parse()?));
        });

        (@parser $variant:ident(Span, String, Span)) => ({
          input.parse::<Token![=]>()?;
          let (val, span) = match input.parse::<syn::LitStr>() {
            Ok(str) => (str.value(), str.span()),
            Err(_) => {
              let ident = input.parse::<AnyIdent>()?.0;
              (ident.to_string(), ident.span())
            }
          };
          return Ok(BindgenAttr::$variant(attr_span, val, span))
        });

        (@parser $variant:ident(Span, Option<(String, Span)>)) => ({
          if let Ok(_) = input.parse::<Token![=]>() {
            let val = match input.parse::<syn::LitStr>() {
              Ok(str) => Some((str.value(), str.span())),
              Err(_) => {
                let ident = input.parse::<AnyIdent>()?.0;
                Some((ident.to_string(), ident.span()))
              }
            };
            return Ok(BindgenAttr::$variant(attr_span, val))
          } else {
            return Ok(BindgenAttr::$variant(attr_span, None))
          }
        });

        (@parser $variant:ident(Span, Option<bool>), $default_value:literal) => ({
          if let Ok(_) = input.parse::<Token![=]>() {
            let (val, _) = match input.parse::<syn::LitBool>() {
              Ok(str) => (str.value(), str.span()),
              Err(_) => {
                let ident = input.parse::<AnyIdent>()?.0;
                (true, ident.span())
              }
            };
            return Ok::<BindgenAttr, syn::Error>(BindgenAttr::$variant(attr_span, Some(val)))
          } else {
            return Ok(BindgenAttr::$variant(attr_span, Some($default_value)))
          }
        });

        (@parser $variant:ident(Span, Vec<String>, Vec<Span>)) => ({
          input.parse::<Token![=]>()?;
          let (vals, spans) = match input.parse::<syn::ExprArray>() {
            Ok(exprs) => {
              let mut vals = vec![];
              let mut spans = vec![];

              for expr in exprs.elems.iter() {
                if let syn::Expr::Lit(syn::ExprLit {
                  lit: syn::Lit::Str(ref str),
                  ..
                }) = expr {
                  vals.push(str.value());
                  spans.push(str.span());
                } else {
                  return Err(syn::Error::new(expr.span(), "expected string literals"));
                }
              }

              (vals, spans)
            },
            Err(_) => {
              let ident = input.parse::<AnyIdent>()?.0;
              (vec![ident.to_string()], vec![ident.span()])
            }
          };
          return Ok(BindgenAttr::$variant(attr_span, vals, spans))
        });
      }

    attrgen!(parsers);

    Err(original.error("unknown attribute"))
  }
}

#[cfg(test)]
mod tests {
  use super::{validate_namespace, BindgenAttrs};

  #[track_caller]
  fn rejects(namespace: &str, message: &str) {
    let error = validate_namespace(namespace).unwrap_err();
    assert!(error.contains(message), "`{namespace}`: {error}");
  }

  #[test]
  fn accepts_identifier_namespaces() {
    for namespace in [
      "a",
      "a.b.c",
      "$a._b",
      "ünï.çø",
      "a\u{200C}b.c",
      "undefined.x",
      "x.default",
      "x.class",
      "x.constructor",
      "x.prototype",
    ] {
      assert_eq!(validate_namespace(namespace), Ok(()), "`{namespace}`");
    }
  }

  #[test]
  fn keeps_accepting_single_segment_names() {
    for namespace in [
      "default",
      "class",
      "delete",
      "await",
      "a-b",
      "1a",
      "a b",
      // `napi build` rejects it while it generates the type definitions (on by default with
      // the `type-def` feature), but it works at runtime as `exports.globalThis`.
      "globalThis",
    ] {
      assert_eq!(validate_namespace(namespace), Ok(()), "`{namespace}`");
    }
  }

  #[test]
  fn rejects_empty_namespaces_and_segments() {
    rejects("", "must not be empty");
    rejects(".a", "has an empty segment");
    rejects("a.", "has an empty segment");
    rejects("a..b", "has an empty segment");
    rejects(".", "has an empty segment");
  }

  #[test]
  fn rejects_control_characters() {
    rejects("a\0b", "found U+0000");
    rejects("a\nb", "found U+000A");
    rejects("a.b\u{7F}", "found U+007F");
    rejects("a\u{2028}b", "found U+2028");
    rejects("a\u{2029}b", "found U+2029");
    assert!(validate_namespace("a\0b")
      .unwrap_err()
      .starts_with("namespace `a\\0b`"));
  }

  #[test]
  fn rejects_proto_anywhere() {
    rejects("__proto__", "`__proto__`");
    rejects("__proto__.a", "`__proto__`");
    rejects("a.__proto__", "`__proto__`");
  }

  #[test]
  fn rejects_dotted_segments_that_are_not_identifiers() {
    rejects("x.a-b", "`a-b` is not a JavaScript identifier");
    rejects("a-b.x", "`a-b` is not a JavaScript identifier");
    rejects("x.1a", "`1a` is not a JavaScript identifier");
    rejects("x.a b", "`a b` is not a JavaScript identifier");
  }

  #[test]
  fn rejects_reserved_dotted_roots() {
    for root in [
      "default", "class", "delete", "await", "yield", "let", "static", "eval",
    ] {
      rejects(&format!("{root}.x"), &format!("`{root}` is reserved"));
    }
    rejects("globalThis.x", "`globalThis` is reserved");
  }

  #[test]
  fn parse_errors_point_at_the_namespace_string() {
    let error = syn::parse_str::<BindgenAttrs>(r#"js_name = "f", namespace = "a..b""#).unwrap_err();
    assert!(
      error.to_string().contains("has an empty segment"),
      "{error}"
    );
    assert!(syn::parse_str::<BindgenAttrs>(r#"namespace = "a.b""#).is_ok());
  }
}
