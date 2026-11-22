use super::typedef;
use crate::parser::{
  attrs::{BindgenAttr, BindgenAttrs},
  ParseNapi,
};
use napi_derive_backend::{BindgenResult, TryToTokens};
use proc_macro2::{Span, TokenStream};
use quote::ToTokens;
use std::cell::Cell;
use syn::{spanned::Spanned, Attribute, Item};

pub fn expand(attr: TokenStream, input: TokenStream) -> BindgenResult<TokenStream> {
  typedef::prepare_type_def_file()?;

  let mut item = syn::parse2::<Item>(input)?;
  let opts: BindgenAttrs = syn::parse2(attr)?;
  let mut tokens = proc_macro2::TokenStream::new();
  if let Item::Mod(mut js_mod) = item {
    if let Some((attr, span)) = crate::parser::symbol_key_attr(&opts)? {
      return Err(napi_derive_backend::Diagnostic::span_error(
        span,
        format!("{attr} is only supported on class methods, accessors and fields"),
      ));
    }
    let (js_name, js_name_span) = opts.js_name().map_or_else(
      || (js_mod.ident.to_string(), js_mod.ident.span()),
      |(js_name, span)| (js_name.to_owned(), span),
    );
    if let Some((_, mut items)) = js_mod.content.clone() {
      for item in items.iter_mut() {
        let mut empty_attrs = vec![];
        if let Some(item_opts) = replace_napi_attr_in_mod(
          &js_name,
          js_name_span,
          match item {
            Item::Fn(ref mut function) => &mut function.attrs,
            Item::Struct(ref mut struct_) => &mut struct_.attrs,
            Item::Enum(ref mut enum_) => &mut enum_.attrs,
            Item::Const(ref mut const_) => &mut const_.attrs,
            Item::Impl(ref mut impl_) => &mut impl_.attrs,
            Item::Mod(mod_) => {
              if mod_.attrs.iter().any(is_napi_attr) {
                bail_span!(
                  mod_,
                  "napi module cannot be nested under another napi module"
                );
              } else {
                &mut empty_attrs
              }
            }
            _ => &mut empty_attrs,
          },
        )? {
          let napi = item.parse_napi(&mut tokens, &item_opts)?;
          item_opts.check_used()?;
          napi.try_to_tokens(&mut tokens)?;
          typedef::output_type_def(&napi)?;
        } else {
          item.to_tokens(&mut tokens);
        };
      }
      js_mod.content = None;
    };

    let js_mod_attrs: Vec<Attribute> = js_mod
      .attrs
      .clone()
      .into_iter()
      .filter(|attr| attr.path().is_ident("napi"))
      .collect();
    let mod_name = js_mod.ident;
    let visible = js_mod.vis;
    let mod_tokens = quote! { #(#js_mod_attrs)* #visible mod #mod_name { #tokens } };
    Ok(mod_tokens)
  } else {
    let napi = item.parse_napi(&mut tokens, &opts)?;
    opts.check_used()?;
    napi.try_to_tokens(&mut tokens)?;
    typedef::output_type_def(&napi)?;
    Ok(tokens)
  }
}

fn is_napi_attr(attr: &Attribute) -> bool {
  attr
    .path()
    .segments
    .last()
    .is_some_and(|segment| segment.ident == "napi")
}

fn replace_napi_attr_in_mod(
  js_namespace: &str,
  js_namespace_span: Span,
  attrs: &mut Vec<syn::Attribute>,
) -> BindgenResult<Option<BindgenAttrs>> {
  let napi_attr = attrs.iter().enumerate().find(|(_, m)| is_napi_attr(m));

  if let Some((index, napi_attr)) = napi_attr {
    let mut struct_opts = match &napi_attr.meta {
      syn::Meta::Path(_) => BindgenAttrs {
        exists: true,
        span: napi_attr.span(),
        ..Default::default()
      },
      syn::Meta::List(list) => {
        let mut parsed: BindgenAttrs = syn::parse2(list.tokens.clone())?;
        parsed.exists = true;
        parsed.span = napi_attr.span();
        parsed
      }
      syn::Meta::NameValue(_) => {
        bail_span!(napi_attr, "invalid #[napi] attribute");
      }
    };

    if !struct_opts
      .attrs
      .iter()
      .any(|(_, attr)| matches!(attr, BindgenAttr::Namespace(..)))
    {
      // The module name becomes the item's namespace here without being parsed, so it is
      // checked here, and only when an item uses it.
      crate::parser::attrs::validate_namespace(js_namespace).map_err(|message| {
        napi_derive_backend::Diagnostic::span_error(js_namespace_span, message)
      })?;
      // adds `namespace = #js_namespace` into `#[napi]` attribute unless explicitly overridden
      struct_opts.attrs.push((
        Cell::new(false),
        BindgenAttr::Namespace(
          Span::call_site(),
          js_namespace.to_owned(),
          Span::call_site(),
        ),
      ));
    }

    attrs.remove(index);
    Ok(Some(struct_opts))
  } else {
    Ok(None)
  }
}

#[cfg(test)]
mod tests {
  use super::expand;
  use proc_macro2::TokenStream;
  use quote::quote;

  fn expand_mod(attr: TokenStream, input: TokenStream) -> String {
    expand(attr, input).unwrap().to_string()
  }

  #[test]
  fn assigns_module_namespace_for_qualified_and_alternate_delimiter_attrs() {
    let expanded = expand_mod(
      quote! {},
      quote! {
        mod my_mod {
          #[napi_derive::napi]
          pub fn bare_qualified() -> u32 { 1 }

          #[::napi_derive::napi()]
          pub fn empty_absolute() -> u32 { 2 }

          #[napi_derive::napi(js_name = "withTrailing",)]
          pub fn trailing_comma() -> u32 { 3 }

          #[napi_derive::napi { js_name = "braceDelim" }]
          pub fn brace_delim() -> u32 { 4 }

          #[::napi_derive::napi[js_name = "bracketDelim"]]
          pub fn bracket_delim() -> u32 { 5 }
        }
      },
    );

    assert_eq!(expanded.matches("Some (\"my_mod\\0\")").count(), 10);
    assert!(expanded.contains("\"bareQualified\\0\""));
    assert!(expanded.contains("\"emptyAbsolute\\0\""));
    assert!(expanded.contains("\"withTrailing\\0\""));
    assert!(expanded.contains("\"braceDelim\\0\""));
    assert!(expanded.contains("\"bracketDelim\\0\""));
  }

  #[test]
  fn preserves_explicit_child_namespace_under_strict_mode() {
    let expanded = expand_mod(
      quote! {},
      quote! {
        mod my_mod {
          #[napi_derive::napi(namespace = "custom_ns")]
          pub fn explicit_other() -> u32 { 1 }

          #[napi_derive::napi(namespace = "my_mod")]
          pub fn explicit_same() -> u32 { 2 }
        }
      },
    );

    assert_eq!(expanded.matches("Some (\"custom_ns\\0\")").count(), 2);
    assert_eq!(expanded.matches("Some (\"my_mod\\0\")").count(), 2);
    assert!(expanded.contains("Some (\"custom_ns\\0\") , \"explicitOther\\0\""));
    assert!(expanded.contains("Some (\"my_mod\\0\") , \"explicitSame\\0\""));
  }

  #[test]
  fn returns_diagnostic_instead_of_panicking_on_invalid_child_attr() {
    let err = expand(
      quote! {},
      quote! {
        mod my_mod {
          #[napi_derive::napi(unknown_option)]
          pub fn bad_option() -> u32 { 1 }
        }
      },
    )
    .unwrap_err();
    assert!(format!("{err:?}").contains("unknown attribute"));

    let err = expand(
      quote! {},
      quote! {
        mod my_mod {
          #[napi_derive::napi = "bad"]
          pub fn bad_name_value() -> u32 { 1 }
        }
      },
    )
    .unwrap_err();
    assert!(format!("{err:?}").contains("invalid #[napi] attribute"));
  }

  #[test]
  fn validates_the_module_js_name_as_a_namespace() {
    let err = expand(
      quote! { js_name = "a..b" },
      quote! {
        mod my_mod {
          #[napi_derive::napi]
          pub fn f() -> u32 { 1 }
        }
      },
    )
    .unwrap_err();
    assert!(format!("{err:?}").contains("namespace `a..b` has an empty segment"));

    let err = expand(
      quote! {},
      quote! {
        mod my_mod {
          #[napi_derive::napi(namespace = "x.__proto__")]
          pub fn f() -> u32 { 1 }
        }
      },
    )
    .unwrap_err();
    assert!(format!("{err:?}").contains("must not use `__proto__`"));

    // The module name is only checked when an item takes it as its namespace.
    let expanded = expand_mod(
      quote! { js_name = "" },
      quote! {
        mod my_mod {
          #[napi_derive::napi(namespace = "x")]
          pub fn f() -> u32 { 1 }
        }
      },
    );
    assert!(expanded.contains("Some (\"x\\0\")"));

    let expanded = expand_mod(
      quote! { js_name = "outer.inner" },
      quote! {
        mod my_mod {
          #[napi_derive::napi]
          pub fn f() -> u32 { 1 }
        }
      },
    );
    assert!(expanded.contains("Some (\"outer.inner\\0\")"));
  }

  #[test]
  fn rejects_nested_napi_mod_for_short_qualified_and_absolute_paths() {
    for inner_attr in [
      quote! { #[napi] },
      quote! { #[napi_derive::napi] },
      quote! { #[::napi_derive::napi] },
    ] {
      let err = expand(
        quote! {},
        quote! {
          mod outer {
            #inner_attr
            mod inner {}
          }
        },
      )
      .unwrap_err();
      assert!(format!("{err:?}").contains("napi module cannot be nested under another napi module"));
    }
  }
}
