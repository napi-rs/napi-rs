#[macro_use]
pub mod attrs;

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::str::Chars;

use attrs::{BindgenAttr, BindgenAttrs};

use convert_case::{Case, Casing};
use napi_derive_backend::{
  BindgenResult, CallbackArg, Diagnostic, FnKind, FnSelf, Napi, NapiConst, NapiEnum, NapiEnumValue,
  NapiEnumVariant, NapiFn, NapiFnArg, NapiFnArgKind, NapiImpl, NapiItem, NapiStruct,
  NapiStructField, NapiStructKind,
};
use proc_macro2::{Ident, Span, TokenStream, TokenTree};
use quote::ToTokens;
use syn::ext::IdentExt;
use syn::parse::{Parse, ParseStream, Result as SynResult};
use syn::{Attribute, Meta, NestedMeta, PatType, PathSegment, Signature, Type, Visibility};

use crate::parser::attrs::{check_recorded_struct_for_impl, record_struct};

thread_local! {
  static GENERATOR_STRUCT: RefCell<HashMap<String, bool>> = Default::default();
}

struct AnyIdent(Ident);

impl Parse for AnyIdent {
  fn parse(input: ParseStream) -> SynResult<Self> {
    input.step(|cursor| match cursor.ident() {
      Some((ident, remaining)) => Ok((AnyIdent(ident), remaining)),
      None => Err(cursor.error("expected an identifier")),
    })
  }
}

impl Parse for BindgenAttrs {
  fn parse(input: ParseStream) -> SynResult<Self> {
    let mut attrs = BindgenAttrs::default();
    if input.is_empty() {
      return Ok(attrs);
    }

    let opts = syn::punctuated::Punctuated::<_, syn::token::Comma>::parse_terminated(input)?;
    attrs.attrs = opts.into_iter().map(|c| (Cell::new(false), c)).collect();
    Ok(attrs)
  }
}

impl Parse for BindgenAttr {
  fn parse(input: ParseStream) -> SynResult<Self> {
    let original = input.fork();
    let attr: AnyIdent = input.parse()?;
    let attr = attr.0;
    let attr_span = attr.span();
    let attr_string = attr.to_string();
    let raw_attr_string = format!("r#{}", attr_string);

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

        (@parser $variant:ident(Span, Option<bool>)) => ({
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
            return Ok(BindgenAttr::$variant(attr_span, Some(true)))
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

pub trait ConvertToAST {
  fn convert_to_ast(&mut self, opts: BindgenAttrs) -> BindgenResult<Napi>;
}

pub trait ParseNapi {
  fn parse_napi(&mut self, tokens: &mut TokenStream, opts: BindgenAttrs) -> BindgenResult<Napi>;
}

/// This function does a few things:
/// - parses the tokens for the given argument `p` to find the `#[napi(ts_arg_type = "MyType")]`
///   attribute and return the manually overridden type.
/// - If both the `ts_args_type` override and the `ts_arg_type` override are present, bail
///   since it should only allow one at a time.
/// - Bails if it finds the `#[napi...]` attribute but it has the wrong data.
/// - Removes the attribute from the output token stream so this
///   `pub fn add(u: u32, #[napi(ts_arg_type = "MyType")] f: String)`
///    turns into
///   `pub fn add(u: u32, f: String)`
///    otherwise it won't compile
fn find_ts_arg_type_and_remove_attribute(
  p: &mut PatType,
  ts_args_type: Option<&(&str, Span)>,
) -> BindgenResult<Option<String>> {
  for (idx, attr) in p.attrs.iter().enumerate() {
    if let Ok(Meta::List(meta_list)) = attr.parse_meta() {
      if meta_list.path.get_ident() != Some(&format_ident!("napi")) {
        // If this attribute is not for `napi` ignore it.
        continue;
      }

      if let Some((ts_args_type, _)) = ts_args_type {
        bail_span!(
          meta_list,
          "Found a 'ts_args_type'=\"{}\" override. Cannot use 'ts_arg_type' at the same time since they are mutually exclusive.",
          ts_args_type
        );
      }

      let nested = meta_list.nested.first();

      let nm = if let Some(NestedMeta::Meta(Meta::NameValue(nm))) = nested {
        nm
      } else {
        bail_span!(meta_list.nested, "Expected Name Value");
      };

      if Some(&format_ident!("ts_arg_type")) != nm.path.get_ident() {
        bail_span!(nm.path, "Did not find 'ts_arg_type'");
      }

      if let syn::Lit::Str(lit) = &nm.lit {
        p.attrs.remove(idx);
        return Ok(Some(lit.value()));
      } else {
        bail_span!(nm.lit, "Expected a string literal");
      }
    }
  }

  Ok(None)
}

fn get_ty(mut ty: &syn::Type) -> &syn::Type {
  while let syn::Type::Group(g) = ty {
    ty = &g.elem;
  }

  ty
}

fn replace_self(ty: syn::Type, self_ty: Option<&Ident>) -> syn::Type {
  let self_ty = match self_ty {
    Some(i) => i,
    None => return ty,
  };
  let path = match get_ty(&ty) {
    syn::Type::Path(syn::TypePath { qself: None, path }) => path.clone(),
    other => return other.clone(),
  };
  let new_path = if path.segments.len() == 1 && path.segments[0].ident == "Self" {
    self_ty.clone().into()
  } else {
    path
  };
  syn::Type::Path(syn::TypePath {
    qself: None,
    path: new_path,
  })
}

/// Extracts the last ident from the path
fn extract_path_ident(path: &syn::Path) -> BindgenResult<Ident> {
  for segment in path.segments.iter() {
    match segment.arguments {
      syn::PathArguments::None => {}
      _ => bail_span!(path, "paths with type parameters are not supported yet"),
    }
  }

  match path.segments.last() {
    Some(value) => Ok(value.ident.clone()),
    None => {
      bail_span!(path, "empty idents are not supported");
    }
  }
}

fn extract_callback_trait_types(
  arguments: &syn::PathArguments,
) -> BindgenResult<(Vec<syn::Type>, Option<syn::Type>)> {
  match arguments {
    // <T: Fn>
    syn::PathArguments::None => Ok((vec![], None)),
    syn::PathArguments::AngleBracketed(_) => {
      bail_span!(arguments, "use parentheses for napi callback trait")
    }
    syn::PathArguments::Parenthesized(arguments) => {
      let args = arguments.inputs.iter().cloned().collect::<Vec<_>>();

      let ret = match &arguments.output {
        syn::ReturnType::Type(_, ret_ty) => {
          let ret_ty = &**ret_ty;
          if let Some(ty_of_result) = extract_result_ty(ret_ty)? {
            if ty_of_result.to_token_stream().to_string() == "()" {
              None
            } else {
              Some(ty_of_result)
            }
          } else {
            bail_span!(ret_ty, "The return type of callback can only be `Result`");
          }
        }
        _ => {
          bail_span!(
            arguments,
            "The return type of callback can only be `Result`. Try with `Result<()>`"
          );
        }
      };

      Ok((args, ret))
    }
  }
}

fn extract_result_ty(ty: &syn::Type) -> BindgenResult<Option<syn::Type>> {
  match ty {
    syn::Type::Path(syn::TypePath { qself: None, path }) => {
      let segment = path.segments.last().unwrap();
      if segment.ident != "Result" {
        Ok(None)
      } else {
        match &segment.arguments {
          syn::PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments {
            args, ..
          }) => {
            let ok_arg = args.first().unwrap();
            match ok_arg {
              syn::GenericArgument::Type(ty) => Ok(Some(ty.clone())),
              _ => bail_span!(ok_arg, "unsupported generic type"),
            }
          }
          _ => {
            bail_span!(segment, "unsupported generic type")
          }
        }
      }
    }
    _ => Ok(None),
  }
}

fn get_expr(mut expr: &syn::Expr) -> &syn::Expr {
  while let syn::Expr::Group(g) = expr {
    expr = &g.expr;
  }

  expr
}

/// Extract the documentation comments from a Vec of attributes
fn extract_doc_comments(attrs: &[syn::Attribute]) -> Vec<String> {
  attrs
    .iter()
    .filter_map(|a| {
      // if the path segments include an ident of "doc" we know this
      // this is a doc comment
      if a.path.segments.iter().any(|s| s.ident == "doc") {
        Some(
          // We want to filter out any Puncts so just grab the Literals
          a.tokens.clone().into_iter().filter_map(|t| match t {
            TokenTree::Literal(lit) => {
              let quoted = lit.to_string();
              Some(try_unescape(&quoted).unwrap_or(quoted))
            }
            _ => None,
          }),
        )
      } else {
        None
      }
    })
    //Fold up the [[String]] iter we created into Vec<String>
    .fold(vec![], |mut acc, a| {
      acc.extend(a);
      acc
    })
}

// Unescaped a quoted string. char::escape_debug() was used to escape the text.
fn try_unescape(s: &str) -> Option<String> {
  if s.is_empty() {
    return Some(String::new());
  }
  let mut result = String::with_capacity(s.len());
  let mut chars = s.chars();
  for i in 0.. {
    let c = match chars.next() {
      Some(c) => c,
      None => {
        if result.ends_with('"') {
          result.pop();
        }
        return Some(result);
      }
    };
    if i == 0 && c == '"' {
      // ignore it
    } else if c == '\\' {
      let c = chars.next()?;
      match c {
        't' => result.push('\t'),
        'r' => result.push('\r'),
        'n' => result.push('\n'),
        '\\' | '\'' | '"' => result.push(c),
        'u' => {
          if chars.next() != Some('{') {
            return None;
          }
          let (c, next) = unescape_unicode(&mut chars)?;
          result.push(c);
          if next != '}' {
            return None;
          }
        }
        _ => return None,
      }
    } else {
      result.push(c);
    }
  }
  None
}

fn unescape_unicode(chars: &mut Chars) -> Option<(char, char)> {
  let mut value = 0;
  for i in 0..7 {
    let c = chars.next()?;
    let num = match c {
      '0'..='9' => c as u32 - '0' as u32,
      'a'..='f' => c as u32 - 'a' as u32,
      'A'..='F' => c as u32 - 'A' as u32,
      _ => {
        if i == 0 {
          return None;
        }

        if i == 0 {
          return None;
        }
        let decoded = char::from_u32(value)?;
        return Some((decoded, c));
      }
    };

    if i >= 6 {
      return None;
    }
    value = (value << 4) | num;
  }
  None
}

fn extract_fn_closure_generics(
  generics: &syn::Generics,
) -> BindgenResult<HashMap<String, syn::PathArguments>> {
  let mut errors = vec![];

  let mut map = HashMap::default();
  if generics.params.is_empty() {
    return Ok(map);
  }

  if let Some(where_clause) = &generics.where_clause {
    for prediction in where_clause.predicates.iter() {
      match prediction {
        syn::WherePredicate::Type(syn::PredicateType {
          bounded_ty, bounds, ..
        }) => {
          for bound in bounds {
            match bound {
              syn::TypeParamBound::Trait(t) => {
                for segment in t.path.segments.iter() {
                  match segment.ident.to_string().as_str() {
                    "Fn" | "FnOnce" | "FnMut" => {
                      map.insert(
                        bounded_ty.to_token_stream().to_string(),
                        segment.arguments.clone(),
                      );
                    }
                    _ => {}
                  };
                }
              }
              syn::TypeParamBound::Lifetime(lifetime) => {
                if lifetime.ident != "static" {
                  errors.push(err_span!(
                    bound,
                    "only 'static is supported in lifetime bound for fn arguments"
                  ));
                }
              }
            }
          }
        }
        _ => errors.push(err_span! {
          prediction,
          "unsupported where clause prediction in napi"
        }),
      };
    }
  }

  for param in generics.params.iter() {
    match param {
      syn::GenericParam::Type(syn::TypeParam { ident, bounds, .. }) => {
        for bound in bounds {
          match bound {
            syn::TypeParamBound::Trait(t) => {
              for segment in t.path.segments.iter() {
                match segment.ident.to_string().as_str() {
                  "Fn" | "FnOnce" | "FnMut" => {
                    map.insert(ident.to_string(), segment.arguments.clone());
                  }
                  _ => {}
                };
              }
            }
            syn::TypeParamBound::Lifetime(lifetime) => {
              if lifetime.ident != "static" {
                errors.push(err_span!(
                  bound,
                  "only 'static is supported in lifetime bound for fn arguments"
                ));
              }
            }
          }
        }
      }
      _ => {
        errors.push(err_span!(param, "unsupported napi generic param for fn"));
      }
    }
  }

  Diagnostic::from_vec(errors).and(Ok(map))
}

fn napi_fn_from_decl(
  sig: &mut Signature,
  opts: &BindgenAttrs,
  attrs: Vec<Attribute>,
  vis: Visibility,
  parent: Option<&Ident>,
) -> BindgenResult<NapiFn> {
  let mut errors = vec![];

  let syn::Signature {
    ident,
    asyncness,
    output,
    generics,
    ..
  } = sig.clone();

  let mut fn_self = None;
  let callback_traits = extract_fn_closure_generics(&generics)?;

  let args = sig
    .inputs
    .iter_mut()
    .filter_map(|arg| match arg {
      syn::FnArg::Typed(ref mut p) => {
        let ts_arg_type = find_ts_arg_type_and_remove_attribute(p, opts.ts_args_type().as_ref())
          .unwrap_or_else(|e| {
            errors.push(e);
            None
          });

        let ty_str = p.ty.to_token_stream().to_string();
        if let Some(path_arguments) = callback_traits.get(&ty_str) {
          match extract_callback_trait_types(path_arguments) {
            Ok((fn_args, fn_ret)) => Some(NapiFnArg {
              kind: NapiFnArgKind::Callback(Box::new(CallbackArg {
                pat: p.pat.clone(),
                args: fn_args,
                ret: fn_ret,
              })),
              ts_arg_type,
            }),
            Err(e) => {
              errors.push(e);
              None
            }
          }
        } else {
          let ty = replace_self(p.ty.as_ref().clone(), parent);
          p.ty = Box::new(ty);
          Some(NapiFnArg {
            kind: NapiFnArgKind::PatType(Box::new(p.clone())),
            ts_arg_type,
          })
        }
      }
      syn::FnArg::Receiver(r) => {
        if parent.is_some() {
          assert!(fn_self.is_none());
          if r.reference.is_none() {
            errors.push(err_span!(
              r,
              "The native methods can't move values from napi. Try `&self` or `&mut self` instead."
            ));
          } else if r.mutability.is_some() {
            fn_self = Some(FnSelf::MutRef);
          } else {
            fn_self = Some(FnSelf::Ref);
          }
        } else {
          errors.push(err_span!(r, "arguments cannot be `self`"));
        }
        None
      }
    })
    .collect::<Vec<_>>();

  let (ret, is_ret_result) = match output {
    syn::ReturnType::Default => (None, false),
    syn::ReturnType::Type(_, ty) => {
      let result_ty = extract_result_ty(&ty)?;
      if result_ty.is_some() {
        (result_ty, true)
      } else {
        (Some(replace_self(*ty, parent)), false)
      }
    }
  };

  Diagnostic::from_vec(errors).map(|_| {
    let js_name = if let Some(prop_name) = opts.getter() {
      opts.js_name().map_or_else(
        || {
          if let Some(ident) = prop_name {
            ident.to_string()
          } else {
            ident
              .to_string()
              .trim_start_matches("get_")
              .to_case(Case::Camel)
          }
        },
        |(js_name, _)| js_name.to_owned(),
      )
    } else if let Some(prop_name) = opts.setter() {
      opts.js_name().map_or_else(
        || {
          if let Some(ident) = prop_name {
            ident.to_string()
          } else {
            ident
              .to_string()
              .trim_start_matches("set_")
              .to_case(Case::Camel)
          }
        },
        |(js_name, _)| js_name.to_owned(),
      )
    } else if opts.constructor().is_some() {
      "constructor".to_owned()
    } else {
      opts.js_name().map_or_else(
        || ident.to_string().to_case(Case::Camel),
        |(js_name, _)| js_name.to_owned(),
      )
    };

    let namespace = opts.namespace().map(|(m, _)| m.to_owned());
    let parent_is_generator = if let Some(p) = parent {
      GENERATOR_STRUCT.with(|inner| {
        let inner = inner.borrow();
        let key = namespace
          .as_ref()
          .map(|n| format!("{}::{}", n, p))
          .unwrap_or_else(|| p.to_string());
        *inner.get(&key).unwrap_or(&false)
      })
    } else {
      false
    };

    NapiFn {
      name: ident,
      js_name,
      args,
      ret,
      is_ret_result,
      is_async: asyncness.is_some(),
      vis,
      kind: fn_kind(opts),
      fn_self,
      parent: parent.cloned(),
      comments: extract_doc_comments(&attrs),
      attrs,
      strict: opts.strict().is_some(),
      return_if_invalid: opts.return_if_invalid().is_some(),
      js_mod: opts.namespace().map(|(m, _)| m.to_owned()),
      ts_generic_types: opts.ts_generic_types().map(|(m, _)| m.to_owned()),
      ts_args_type: opts.ts_args_type().map(|(m, _)| m.to_owned()),
      ts_return_type: opts.ts_return_type().map(|(m, _)| m.to_owned()),
      skip_typescript: opts.skip_typescript().is_some(),
      parent_is_generator,
      writable: opts.writable(),
      enumerable: opts.enumerable(),
      configurable: opts.configurable(),
      catch_unwind: opts.catch_unwind().is_some(),
      unsafe_: sig.unsafety.is_some(),
    }
  })
}

impl ParseNapi for syn::Item {
  fn parse_napi(&mut self, tokens: &mut TokenStream, opts: BindgenAttrs) -> BindgenResult<Napi> {
    match self {
      syn::Item::Fn(f) => f.parse_napi(tokens, opts),
      syn::Item::Struct(s) => s.parse_napi(tokens, opts),
      syn::Item::Impl(i) => i.parse_napi(tokens, opts),
      syn::Item::Enum(e) => e.parse_napi(tokens, opts),
      syn::Item::Const(c) => c.parse_napi(tokens, opts),
      _ => bail_span!(
        self,
        "#[napi] can only be applied to a function, struct, enum, const, mod or impl."
      ),
    }
  }
}

impl ParseNapi for syn::ItemFn {
  fn parse_napi(&mut self, tokens: &mut TokenStream, opts: BindgenAttrs) -> BindgenResult<Napi> {
    if opts.ts_type().is_some() {
      bail_span!(
        self,
        "#[napi] can't be applied to a function with #[napi(ts_type)]"
      );
    }
    if opts.return_if_invalid().is_some() && opts.strict().is_some() {
      bail_span!(
        self,
        "#[napi(return_if_invalid)] can't be used with #[napi(strict)]"
      );
    }
    let napi = self.convert_to_ast(opts);
    self.to_tokens(tokens);

    napi
  }
}
impl ParseNapi for syn::ItemStruct {
  fn parse_napi(&mut self, tokens: &mut TokenStream, opts: BindgenAttrs) -> BindgenResult<Napi> {
    if opts.ts_args_type().is_some()
      || opts.ts_return_type().is_some()
      || opts.skip_typescript().is_some()
      || opts.ts_type().is_some()
    {
      bail_span!(
        self,
        "#[napi] can't be applied to a struct with #[napi(ts_args_type)], #[napi(ts_return_type)], #[napi(skip_typescript)] or #[napi(ts_type)]"
      );
    }
    if opts.return_if_invalid().is_some() {
      bail_span!(
        self,
        "#[napi(return_if_invalid)] can only be applied to a function or method."
      );
    }
    if opts.catch_unwind().is_some() {
      bail_span!(
        self,
        "#[napi(catch_unwind)] can only be applied to a function or method."
      );
    }
    if opts.object().is_some() && opts.custom_finalize().is_some() {
      bail_span!(self, "Custom finalize is not supported for #[napi(object)]");
    }
    let napi = self.convert_to_ast(opts);
    self.to_tokens(tokens);

    napi
  }
}

impl ParseNapi for syn::ItemImpl {
  fn parse_napi(&mut self, tokens: &mut TokenStream, opts: BindgenAttrs) -> BindgenResult<Napi> {
    if opts.ts_args_type().is_some()
      || opts.ts_return_type().is_some()
      || opts.skip_typescript().is_some()
      || opts.ts_type().is_some()
      || opts.custom_finalize().is_some()
    {
      bail_span!(
        self,
        "#[napi] can't be applied to impl with #[napi(ts_args_type)], #[napi(ts_return_type)], #[napi(skip_typescript)] or #[napi(ts_type)] or #[napi(custom_finalize)]"
      );
    }
    if opts.return_if_invalid().is_some() {
      bail_span!(
        self,
        "#[napi(return_if_invalid)] can only be applied to a function or method."
      );
    }
    if opts.catch_unwind().is_some() {
      bail_span!(
        self,
        "#[napi(catch_unwind)] can only be applied to a function or method."
      );
    }
    // #[napi] macro will be remove from impl items after converted to ast
    let napi = self.convert_to_ast(opts);
    self.to_tokens(tokens);

    napi
  }
}

impl ParseNapi for syn::ItemEnum {
  fn parse_napi(&mut self, tokens: &mut TokenStream, opts: BindgenAttrs) -> BindgenResult<Napi> {
    if opts.ts_args_type().is_some()
      || opts.ts_return_type().is_some()
      || opts.ts_type().is_some()
      || opts.custom_finalize().is_some()
    {
      bail_span!(
        self,
        "#[napi] can't be applied to a enum with #[napi(ts_args_type)], #[napi(ts_return_type)] or #[napi(ts_type)] or #[napi(custom_finalize)]"
      );
    }
    if opts.return_if_invalid().is_some() {
      bail_span!(
        self,
        "#[napi(return_if_invalid)] can only be applied to a function or method."
      );
    }
    if opts.catch_unwind().is_some() {
      bail_span!(
        self,
        "#[napi(catch_unwind)] can only be applied to a function or method."
      );
    }
    let napi = self.convert_to_ast(opts);
    self.to_tokens(tokens);

    napi
  }
}
impl ParseNapi for syn::ItemConst {
  fn parse_napi(&mut self, tokens: &mut TokenStream, opts: BindgenAttrs) -> BindgenResult<Napi> {
    if opts.ts_args_type().is_some()
      || opts.ts_return_type().is_some()
      || opts.ts_type().is_some()
      || opts.custom_finalize().is_some()
    {
      bail_span!(
        self,
        "#[napi] can't be applied to a const with #[napi(ts_args_type)], #[napi(ts_return_type)] or #[napi(ts_type)] or #[napi(custom_finalize)]"
      );
    }
    if opts.return_if_invalid().is_some() {
      bail_span!(
        self,
        "#[napi(return_if_invalid)] can only be applied to a function or method."
      );
    }
    if opts.catch_unwind().is_some() {
      bail_span!(
        self,
        "#[napi(catch_unwind)] can only be applied to a function or method."
      );
    }
    let napi = self.convert_to_ast(opts);
    self.to_tokens(tokens);
    napi
  }
}

fn fn_kind(opts: &BindgenAttrs) -> FnKind {
  let mut kind = FnKind::Normal;

  if opts.getter().is_some() {
    kind = FnKind::Getter;
  }

  if opts.setter().is_some() {
    kind = FnKind::Setter;
  }

  if opts.constructor().is_some() {
    kind = FnKind::Constructor;
  }

  if opts.factory().is_some() {
    kind = FnKind::Factory;
  }

  kind
}

impl ConvertToAST for syn::ItemFn {
  fn convert_to_ast(&mut self, opts: BindgenAttrs) -> BindgenResult<Napi> {
    let func = napi_fn_from_decl(
      &mut self.sig,
      &opts,
      self.attrs.clone(),
      self.vis.clone(),
      None,
    )?;

    Ok(Napi {
      item: NapiItem::Fn(func),
    })
  }
}

impl ConvertToAST for syn::ItemStruct {
  fn convert_to_ast(&mut self, opts: BindgenAttrs) -> BindgenResult<Napi> {
    let mut errors = vec![];

    let vis = self.vis.clone();
    let struct_name = self.ident.clone();
    let js_name = opts.js_name().map_or_else(
      || self.ident.to_string().to_case(Case::Pascal),
      |(js_name, _)| js_name.to_owned(),
    );
    let mut fields = vec![];
    let mut is_tuple = false;
    let struct_kind = if opts.constructor().is_some() {
      NapiStructKind::Constructor
    } else if opts.object().is_some() {
      NapiStructKind::Object
    } else {
      NapiStructKind::None
    };

    for (i, field) in self.fields.iter_mut().enumerate() {
      match field.vis {
        syn::Visibility::Public(..) => {}
        _ => {
          if struct_kind != NapiStructKind::None {
            errors.push(err_span!(
              field,
              "#[napi] requires all struct fields to be public to mark struct as constructor or object shape\nthis field is not public."
            ));
          }
          continue;
        }
      }

      let field_opts = BindgenAttrs::find(&mut field.attrs)?;

      let (js_name, name) = match &field.ident {
        Some(ident) => (
          field_opts.js_name().map_or_else(
            || ident.unraw().to_string().to_case(Case::Camel),
            |(js_name, _)| js_name.to_owned(),
          ),
          syn::Member::Named(ident.clone()),
        ),
        None => {
          is_tuple = true;
          (format!("field{}", i), syn::Member::Unnamed(i.into()))
        }
      };

      let ignored = field_opts.skip().is_some();
      let readonly = field_opts.readonly().is_some();
      let writable = field_opts.writable();
      let enumerable = field_opts.enumerable();
      let configurable = field_opts.configurable();
      let skip_typescript = field_opts.skip_typescript().is_some();
      let ts_type = field_opts.ts_type().map(|e| e.0.to_string());

      fields.push(NapiStructField {
        name,
        js_name,
        ty: field.ty.clone(),
        getter: !ignored,
        setter: !(ignored || readonly),
        writable,
        enumerable,
        configurable,
        comments: extract_doc_comments(&field.attrs),
        skip_typescript,
        ts_type,
      })
    }

    record_struct(&struct_name, js_name.clone(), &opts);
    let namespace = opts.namespace().map(|(m, _)| m.to_owned());
    let implement_iterator = opts.iterator().is_some();
    GENERATOR_STRUCT.with(|inner| {
      let mut inner = inner.borrow_mut();
      let key = namespace
        .as_ref()
        .map(|n| format!("{}::{}", n, struct_name))
        .unwrap_or_else(|| struct_name.to_string());
      inner.insert(key, implement_iterator);
    });

    Diagnostic::from_vec(errors).map(|()| Napi {
      item: NapiItem::Struct(NapiStruct {
        js_name,
        name: struct_name,
        vis,
        fields,
        is_tuple,
        kind: struct_kind,
        object_from_js: opts.object_from_js(),
        object_to_js: opts.object_to_js(),
        js_mod: namespace,
        comments: extract_doc_comments(&self.attrs),
        implement_iterator,
        use_custom_finalize: opts.custom_finalize().is_some(),
      }),
    })
  }
}

impl ConvertToAST for syn::ItemImpl {
  fn convert_to_ast(&mut self, impl_opts: BindgenAttrs) -> BindgenResult<Napi> {
    let struct_name = match get_ty(&self.self_ty) {
      syn::Type::Path(syn::TypePath {
        ref path,
        qself: None,
      }) => path,
      _ => {
        bail_span!(self.self_ty, "unsupported self type in #[napi] impl")
      }
    };

    let struct_name = extract_path_ident(struct_name)?;

    let mut struct_js_name = struct_name.to_string().to_case(Case::UpperCamel);
    let mut items = vec![];
    let mut task_output_type = None;
    let mut iterator_yield_type = None;
    let mut iterator_next_type = None;
    let mut iterator_return_type = None;
    for item in self.items.iter_mut() {
      if let Some(method) = match item {
        syn::ImplItem::Method(m) => Some(m),
        syn::ImplItem::Type(m) => {
          if let Some((_, t, _)) = &self.trait_ {
            if let Some(PathSegment { ident, .. }) = t.segments.last() {
              if ident == "Task" && m.ident == "JsValue" {
                task_output_type = Some(m.ty.clone());
              } else if ident == "Generator" {
                if let Type::Path(_) = &m.ty {
                  if m.ident == "Yield" {
                    iterator_yield_type = Some(m.ty.clone());
                  } else if m.ident == "Next" {
                    iterator_next_type = Some(m.ty.clone());
                  } else if m.ident == "Return" {
                    iterator_return_type = Some(m.ty.clone());
                  }
                }
              }
            }
          }
          None
        }
        _ => {
          bail_span!(item, "unsupported impl item in #[napi]")
        }
      } {
        let opts = BindgenAttrs::find(&mut method.attrs)?;

        // it'd better only care methods decorated with `#[napi]` attribute
        if !opts.exists {
          continue;
        }

        if opts.constructor().is_some() || opts.factory().is_some() {
          struct_js_name = check_recorded_struct_for_impl(&struct_name, &opts)?;
        }

        let vis = method.vis.clone();

        match &vis {
          Visibility::Public(_) => {}
          _ => {
            bail_span!(method.sig.ident, "only pub method supported by #[napi].",);
          }
        }

        let func = napi_fn_from_decl(
          &mut method.sig,
          &opts,
          method.attrs.clone(),
          vis,
          Some(&struct_name),
        )?;

        items.push(func);
      }
    }

    let namespace = impl_opts.namespace().map(|(m, _)| m.to_owned());

    Ok(Napi {
      item: NapiItem::Impl(NapiImpl {
        name: struct_name,
        js_name: struct_js_name,
        items,
        task_output_type,
        iterator_yield_type,
        iterator_next_type,
        iterator_return_type,
        js_mod: namespace,
        comments: extract_doc_comments(&self.attrs),
      }),
    })
  }
}

impl ConvertToAST for syn::ItemEnum {
  fn convert_to_ast(&mut self, opts: BindgenAttrs) -> BindgenResult<Napi> {
    match self.vis {
      Visibility::Public(_) => {}
      _ => bail_span!(self, "only public enum allowed"),
    }

    self.attrs.push(Attribute {
      pound_token: Default::default(),
      style: syn::AttrStyle::Outer,
      bracket_token: Default::default(),
      path: syn::parse_quote! { derive },
      tokens: quote! { (Copy, Clone) },
    });

    let js_name = opts
      .js_name()
      .map_or_else(|| self.ident.to_string(), |(s, _)| s.to_string());

    let variants = match opts.string_enum() {
      Some(_) => self
        .variants
        .iter()
        .map(|v| {
          if !matches!(v.fields, syn::Fields::Unit) {
            bail_span!(v.fields, "Structured enum is not supported in #[napi]")
          }
          if matches!(&v.discriminant, Some((_, _))) {
            bail_span!(
              v.fields,
              "Literal values are not supported with string enum in #[napi]"
            )
          }
          Ok(NapiEnumVariant {
            name: v.ident.clone(),
            val: NapiEnumValue::String(v.ident.to_string()),
            comments: extract_doc_comments(&v.attrs),
          })
        })
        .collect::<BindgenResult<Vec<NapiEnumVariant>>>()?,
      None => {
        let mut last_variant_val: i32 = -1;

        self
          .variants
          .iter()
          .map(|v| {
            if !matches!(v.fields, syn::Fields::Unit) {
              bail_span!(v.fields, "Structured enum is not supported in #[napi]")
            }

            let val = match &v.discriminant {
              Some((_, expr)) => {
                let mut symbol = 1;
                let mut inner_expr = get_expr(expr);
                if let syn::Expr::Unary(syn::ExprUnary {
                  attrs: _,
                  op: syn::UnOp::Neg(_),
                  expr,
                }) = inner_expr
                {
                  symbol = -1;
                  inner_expr = expr;
                }

                match inner_expr {
                  syn::Expr::Lit(syn::ExprLit {
                    attrs: _,
                    lit: syn::Lit::Int(int_lit),
                  }) => match int_lit.base10_digits().parse::<i32>() {
                    Ok(v) => symbol * v,
                    Err(_) => {
                      bail_span!(
                        int_lit,
                        "enums with #[wasm_bindgen] can only support \
                      numbers that can be represented as i32",
                      );
                    }
                  },
                  _ => bail_span!(
                    expr,
                    "enums with #[wasm_bindgen] may only have \
                  number literal values",
                  ),
                }
              }
              None => last_variant_val + 1,
            };

            last_variant_val = val;

            Ok(NapiEnumVariant {
              name: v.ident.clone(),
              val: NapiEnumValue::Number(val),
              comments: extract_doc_comments(&v.attrs),
            })
          })
          .collect::<BindgenResult<Vec<NapiEnumVariant>>>()?
      }
    };

    Ok(Napi {
      item: NapiItem::Enum(NapiEnum {
        name: self.ident.clone(),
        js_name,
        variants,
        js_mod: opts.namespace().map(|(m, _)| m.to_owned()),
        comments: extract_doc_comments(&self.attrs),
        skip_typescript: opts.skip_typescript().is_some(),
      }),
    })
  }
}

impl ConvertToAST for syn::ItemConst {
  fn convert_to_ast(&mut self, opts: BindgenAttrs) -> BindgenResult<Napi> {
    match self.vis {
      Visibility::Public(_) => Ok(Napi {
        item: NapiItem::Const(NapiConst {
          name: self.ident.clone(),
          js_name: opts
            .js_name()
            .map_or_else(|| self.ident.to_string(), |(s, _)| s.to_string()),
          type_name: *self.ty.clone(),
          value: *self.expr.clone(),
          js_mod: opts.namespace().map(|(m, _)| m.to_owned()),
          comments: extract_doc_comments(&self.attrs),
          skip_typescript: opts.skip_typescript().is_some(),
        }),
      }),
      _ => bail_span!(self, "only public const allowed"),
    }
  }
}
