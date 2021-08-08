use backend::{bail_span, BindgenResult, Diagnostic};
use proc_macro2::{Delimiter, Ident, Span, TokenTree};
use std::{
  cell::{Cell, RefCell},
  collections::HashSet,
};
use syn::spanned::Spanned;

thread_local! {
  static ATTRS: AttributeParseState = Default::default();
  static CTORS: ConstructorParseState = Default::default();
}

#[derive(Default)]
struct ConstructorParseState {
  parsed: RefCell<HashSet<String>>,
}

#[derive(Default)]
struct AttributeParseState {
  parsed: Cell<usize>,
  checks: Cell<usize>,
}

/// Parsed attributes from a `#[napi(..)]`.
#[cfg_attr(feature = "extra-traits", derive(Debug, PartialEq, Eq))]
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
      (getter, Getter(Span, Option<Ident>)),
      (setter, Setter(Span, Option<Ident>)),
      (readonly, Readonly(Span)),
      (skip, Skip(Span)),

      // impl later
      // (inspectable, Inspectable(Span)),
      // (typescript_custom_section, TypescriptCustomSection(Span)),
      // (skip_typescript, SkipTypescript(Span)),
      // (typescript_type, TypeScriptType(Span, String, Span)),
      // (getter_with_clone, GetterWithClone(Span)),

      // For testing purposes only.
      // (assert_no_shim, AssertNoShim(Span)),
    }
  };
}

macro_rules! methods {
  ($(($name:ident, $variant:ident($($contents:tt)*)),)*) => {
    $(methods!(@method $name, $variant($($contents)*));)*

    #[cfg(feature = "strict-macro")]
    fn check_used(self) -> Result<(), Diagnostic> {
      // Account for the fact this method was called
      ATTRS.with(|state| state.checks.set(state.checks.get() + 1));

      let mut errors = Vec::new();
      for (used, attr) in self.attrs.iter() {
        if used.get() {
            continue
        }
        // The check below causes rustc to crash on powerpc64 platforms
        // with an LLVM error. To avoid this, we instead use #[cfg()]
        // and duplicate the function below. See #58516 for details.
        /*if !cfg!(feature = "strict-macro") {
            continue
        }*/
        let span = match attr {
          $(BindgenAttr::$variant(span, ..) => span,)*
        };
        errors.push(Diagnostic::span_error(*span, "unused #[napi] attribute"));
      }
      Diagnostic::from_vec(errors)
    }

    #[cfg(not(feature = "strict-macro"))]
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

      let pos = match &napi_attr {
        Some((pos, raw_attr)) => {
          ret.exists = true;
          ret.span = raw_attr.tokens.span();
          *pos
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
      ret.attrs.extend(attrs.attrs.drain(..));
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
    #[cfg_attr(feature = "extra-traits", derive(Debug, PartialEq, Eq))]
    pub enum BindgenAttr {
      $($($variants)*,)*
    }
  }
}

attrgen!(gen_bindgen_attr);

pub fn record_constructor(name: &Ident, opts: &BindgenAttrs) -> BindgenResult<()> {
  CTORS.with(|state| {
    let span = opts.span;
    let name_str = name.to_string();
    let mut set = state.parsed.borrow_mut();

    if set.contains(&name_str) {
      Err(Diagnostic::span_error(
        span,
        format!(
          "constructor for struct `{}` has already been defined",
          name_str,
        ),
      ))
    } else {
      set.insert(name_str);
      Ok(())
    }
  })
}
