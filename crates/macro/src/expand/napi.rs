use std::env;
use std::fs;
#[cfg(feature = "type-def")]
use std::io::BufWriter;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::parser::{attrs::BindgenAttrs, ParseNapi};
use napi_derive_backend::{BindgenResult, TryToTokens, REGISTER_IDENTS};
#[cfg(feature = "type-def")]
use napi_derive_backend::{Napi, ToTypeDef};
use proc_macro2::{TokenStream, TokenTree};
use quote::ToTokens;
use syn::{Attribute, Item};

/// a flag indicate whether or never at least one `napi` macro has been expanded.
/// ```ignore
/// if BUILT_FLAG
///  .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
///  .is_ok() {
///   // logic on first macro expansion
/// }
///
/// ```
static BUILT_FLAG: AtomicBool = AtomicBool::new(false);

pub fn expand(attr: TokenStream, input: TokenStream) -> BindgenResult<TokenStream> {
  if BUILT_FLAG
    .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
    .is_ok()
  {
    // logic on first macro expansion
    #[cfg(feature = "type-def")]
    prepare_type_def_file();

    if let Ok(wasi_register_file) = env::var("WASI_REGISTER_TMP_PATH") {
      if let Err(_e) = fs::remove_file(wasi_register_file) {
        #[cfg(debug_assertions)]
        {
          println!("Failed to manipulate wasi register file: {:?}", _e);
        }
      }
    }
  }

  let mut item = syn::parse2::<Item>(input)?;
  let opts: BindgenAttrs = syn::parse2(attr)?;
  let mut tokens = proc_macro2::TokenStream::new();
  if let Item::Mod(mut js_mod) = item {
    let js_name = opts.js_name().map_or_else(
      || js_mod.ident.to_string(),
      |(js_name, _)| js_name.to_owned(),
    );
    if let Some((_, mut items)) = js_mod.content.clone() {
      for item in items.iter_mut() {
        let mut empty_attrs = vec![];
        if let Some(item_opts) = replace_napi_attr_in_mod(
          js_name.clone(),
          match item {
            Item::Fn(ref mut function) => &mut function.attrs,
            Item::Struct(ref mut struct_) => &mut struct_.attrs,
            Item::Enum(ref mut enum_) => &mut enum_.attrs,
            Item::Const(ref mut const_) => &mut const_.attrs,
            Item::Impl(ref mut impl_) => &mut impl_.attrs,
            Item::Mod(mod_) => {
              let mod_in_mod = mod_
                .attrs
                .iter()
                .enumerate()
                .find(|(_, m)| m.path.segments[0].ident == "napi");
              if mod_in_mod.is_some() {
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
        ) {
          let napi = item.parse_napi(&mut tokens, item_opts)?;
          napi.try_to_tokens(&mut tokens)?;

          #[cfg(feature = "type-def")]
          output_type_def(&napi);
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
      .filter(|attr| attr.path.segments[0].ident != "napi")
      .collect();
    let mod_name = js_mod.ident;
    let visible = js_mod.vis;
    let mod_tokens = quote! { #(#js_mod_attrs)* #visible mod #mod_name { #tokens } };
    Ok(mod_tokens)
  } else {
    let napi = item.parse_napi(&mut tokens, opts)?;
    napi.try_to_tokens(&mut tokens)?;

    #[cfg(feature = "type-def")]
    output_type_def(&napi);

    REGISTER_IDENTS.with(|idents| {
      if let Ok(wasi_register_file) = env::var("WASI_REGISTER_TMP_PATH") {
        let mut file =
          fs::File::create(wasi_register_file).expect("Create wasi register file failed");
        file
          .write_all(format!("{:?}", idents.borrow()).as_bytes())
          .expect("Write wasi register file failed");
      }
    });

    Ok(tokens)
  }
}

#[cfg(feature = "type-def")]
fn output_type_def(napi: &Napi) {
  if let Ok(type_def_file) = env::var("TYPE_DEF_TMP_PATH") {
    if let Some(type_def) = napi.to_type_def() {
      fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(type_def_file)
        .and_then(|file| {
          let mut writer = BufWriter::<fs::File>::new(file);
          writer.write_all(type_def.to_string().as_bytes())?;
          writer.write_all("\n".as_bytes())
        })
        .unwrap_or_else(|e| {
          println!("Failed to write type def file: {:?}", e);
        });
    }
  }
}

fn replace_napi_attr_in_mod(
  js_namespace: String,
  attrs: &mut Vec<syn::Attribute>,
) -> Option<BindgenAttrs> {
  let napi_attr = attrs.clone();
  let napi_attr = napi_attr
    .iter()
    .enumerate()
    .find(|(_, m)| m.path.segments[0].ident == "napi");
  if let Some((index, napi_attr)) = napi_attr {
    let attr_token_stream = napi_attr.tokens.clone();
    let raw_attr_stream = attr_token_stream.to_string();
    let raw_attr_stream = if !raw_attr_stream.is_empty() {
      raw_attr_stream
        .strip_prefix('(')
        .unwrap()
        .strip_suffix(')')
        .unwrap()
        .to_string()
    } else {
      raw_attr_stream
    };
    let raw_attr_token_stream = syn::parse_str::<TokenStream>(raw_attr_stream.as_str()).unwrap();

    let new_attr: syn::Attribute = if !raw_attr_stream.is_empty() {
      syn::parse_quote!(
        #[napi(#raw_attr_token_stream, namespace = #js_namespace)]
      )
    } else {
      syn::parse_quote!(
        #[napi(namespace = #js_namespace)]
      )
    };
    let struct_opts: BindgenAttrs =
      if let Some(TokenTree::Group(g)) = new_attr.tokens.into_iter().next() {
        syn::parse2(g.stream()).ok()?
      } else {
        syn::parse2(quote! {}).ok()?
      };
    attrs.remove(index);
    Some(struct_opts)
  } else {
    None
  }
}

#[cfg(feature = "type-def")]
fn prepare_type_def_file() {
  if let Ok(ref type_def_file) = env::var("TYPE_DEF_TMP_PATH") {
    use napi_derive_backend::{NAPI_RS_CLI_VERSION, NAPI_RS_CLI_VERSION_WITH_SHARED_CRATES_FIX};
    if let Err(_e) = if *NAPI_RS_CLI_VERSION >= *NAPI_RS_CLI_VERSION_WITH_SHARED_CRATES_FIX {
      remove_existed_type_def(type_def_file)
    } else {
      fs::remove_file(type_def_file)
    } {
      #[cfg(debug_assertions)]
      {
        println!("Failed to manipulate type def file: {:?}", _e);
      }
    }
  }
}

#[cfg(feature = "type-def")]
fn remove_existed_type_def(type_def_file: &str) -> std::io::Result<()> {
  use std::io::{BufRead, BufReader};

  let pkg_name = std::env::var("CARGO_PKG_NAME").expect("CARGO_PKG_NAME is not set");
  if let Ok(content) = std::fs::File::open(type_def_file) {
    let reader = BufReader::new(content);
    let cleaned_content = reader
      .lines()
      .filter_map(|line| {
        if let Ok(line) = line {
          if let Some((package_name, _)) = line.split_once(':') {
            if pkg_name == package_name {
              return None;
            }
          }
          Some(line)
        } else {
          None
        }
      })
      .collect::<Vec<String>>()
      .join("\n");
    let mut content = std::fs::OpenOptions::new()
      .read(true)
      .write(true)
      .truncate(true)
      .open(type_def_file)?;

    content.write_all(cleaned_content.as_bytes())?;
    content.write_all(b"\n")?;
  }
  Ok(())
}
