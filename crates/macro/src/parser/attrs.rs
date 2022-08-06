use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use napi_derive_backend::{bail_span, BindgenResult, Diagnostic};
use proc_macro2::{Delimiter, Ident, Span, TokenTree};
use syn::spanned::Spanned;

thread_local! {
  static ATTRS: AttributeParseState = Default::default();
  static STRUCTS: StructParseState = Default::default();
}

#[derive(Default)]
struct StructParseState {
  parsed: RefCell<HashMap<String, ParsedStruct>>,
}

struct ParsedStruct {
  js_name: String,
  ctor_defined: bool,
}

#[derive(Default)]
struct AttributeParseState {
  parsed: Cell<usize>,
  checks: Cell<usize>,
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
// some of them may useless is #[napi] macro
macro_rules! attrgen {
  ($mac:ident) => {
    $mac! {
      (js_name, JsName(Span, String, Span)),
      (constructor, Constructor(Span)),
      (factory, Factory(Span)),
      (getter, Getter(Span, Option<Ident>)),
      (setter, Setter(Span, Option<Ident>)),
      (readonly, Readonly(Span)),
      (enumerable, Enumerable(Span, Option<bool>)),
      (writable, Writable(Span, Option<bool>)),
      (configurable, Configurable(Span, Option<bool>)),
      (skip, Skip(Span)),
      (strict, Strict(Span)),
      (return_if_invalid, ReturnIfInvalid(Span)),
      (object, Object(Span)),
      (namespace, Namespace(Span, String, Span)),
      (iterator, Iterator(Span)),
      (ts_args_type, TsArgsType(Span, String, Span)),
      (ts_return_type, TsReturnType(Span, String, Span)),
      (ts_type, TsType(Span, String, Span)),
      (ts_generic_types, TsGenericTypes(Span, String, Span)),

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
  ($(($name:ident, $variant:ident($($contents:tt)*)),)*) => {
    $(methods!(@method $name, $variant($($contents)*));)*

    #[cfg(feature = "strict")]
    fn check_used(self) -> Result<(), Diagnostic> {
      // Account for the fact this method was called
      ATTRS.with(|state| state.checks.set(state.checks.get() + 1));

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
    fn check_used(self) -> Result<(), Diagnostic> {
        // Account for the fact this method was called
        ATTRS.with(|state| state.checks.set(state.checks.get() + 1));
        Ok(())
    }
  };

  (@method $name:ident, $variant:ident(Span, String, Span)) => {
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

  (@method $name:ident, $variant:ident(Span, Option<bool>)) => {
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
        .unwrap_or(true)
    }
  };

  (@method $name:ident, $variant:ident(Span, Vec<String>, Vec<Span>)) => {
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
    let mut ret = BindgenAttrs::default();
    loop {
      let napi_attr = attrs
        .iter()
        .enumerate()
        .find(|&(_, m)| m.path.segments[0].ident == "napi");

      let pos = match napi_attr {
        Some((pos, raw_attr)) => {
          ret.exists = true;
          ret.span = raw_attr.tokens.span();
          pos
        }
        None => return Ok(ret),
      };
      let attr = attrs.remove(pos);
      let mut tts = attr.tokens.clone().into_iter();
      let group = match tts.next() {
        Some(TokenTree::Group(d)) => d,
        Some(_) => bail_span!(attr, "malformed #[napi] attribute"),
        None => continue,
      };
      if tts.next().is_some() {
        bail_span!(attr, "malformed #[napi] attribute");
      }
      if group.delimiter() != Delimiter::Parenthesis {
        bail_span!(attr, "malformed #[napi] attribute");
      }
      let mut attrs: BindgenAttrs = syn::parse2(group.stream())?;
      ret.attrs.append(&mut attrs.attrs);
      attrs.check_used()?;
    }
  }

  attrgen!(methods);
}

impl Default for BindgenAttrs {
  fn default() -> BindgenAttrs {
    // Add 1 to the list of parsed attribute sets. We'll use this counter to
    // sanity check that we call `check_used` an appropriate number of
    // times.
    ATTRS.with(|state| state.parsed.set(state.parsed.get() + 1));
    BindgenAttrs {
      span: Span::call_site(),
      attrs: Vec::new(),
      exists: false,
    }
  }
}

macro_rules! gen_bindgen_attr {
  ($( ($method:ident, $($variants:tt)*) ,)*) => {
    /// The possible attributes in the `#[napi]`.
    #[derive(Debug)]
    pub enum BindgenAttr {
      $($($variants)*,)*
    }
  }
}

attrgen!(gen_bindgen_attr);

pub fn record_struct(ident: &Ident, js_name: String, opts: &BindgenAttrs) {
  STRUCTS.with(|state| {
    let struct_name = ident.to_string();

    let mut map = state.parsed.borrow_mut();

    map.insert(
      struct_name,
      ParsedStruct {
        js_name,
        ctor_defined: opts.constructor().is_some(),
      },
    );
  });
}

pub fn check_recorded_struct_for_impl(ident: &Ident, opts: &BindgenAttrs) -> BindgenResult<String> {
  STRUCTS.with(|state| {
    let struct_name = ident.to_string();
    let mut map = state.parsed.borrow_mut();
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
  })
}
