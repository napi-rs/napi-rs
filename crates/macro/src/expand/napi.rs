#[cfg(feature = "type-def")]
use std::env;
#[cfg(feature = "type-def")]
use std::fs;
#[cfg(feature = "type-def")]
use std::io::Write;
#[cfg(feature = "type-def")]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(feature = "type-def")]
use fd_lock::RwLock as FdRwLock;

use crate::parser::{attrs::BindgenAttrs, ParseNapi};
use napi_derive_backend::{BindgenResult, TryToTokens};
#[cfg(feature = "type-def")]
use napi_derive_backend::{Napi, ToTypeDef};
use proc_macro2::TokenStream;
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
#[cfg(feature = "type-def")]
static BUILT_FLAG: AtomicBool = AtomicBool::new(false);

#[cfg(feature = "type-def")]
#[ctor::dtor]
fn dtor() {
  if let Ok(ref type_def_file) = env::var("TYPE_DEF_TMP_PATH") {
    let package_name = std::env::var("CARGO_PKG_NAME").expect("CARGO_PKG_NAME is not set");

    let file_result = fs::OpenOptions::new()
      .read(true)
      .append(true)
      .open(type_def_file);

    match file_result {
      Ok(f) => {
        let mut locked_file = FdRwLock::new(f);
        let write_result = locked_file.write();
        match write_result {
          Ok(mut write_guard) => {
            let write_result = write_guard
              .write_all(format!("{package_name}:{{\"done\": true}}\n").as_bytes())
              .and_then(|_| write_guard.flush());

            if let Err(err) = write_result {
              eprintln!(
                "Failed to write type def file for `{package_name}`: {:?}",
                err
              );
            }
          }
          Err(err) => {
            eprintln!(
              "Failed to acquire write lock for type def file for `{package_name}`: {:?}",
              err
            );
          }
        }
      }
      Err(err) => {
        eprintln!(
          "Failed to open type def file for `{package_name}`: {:?}",
          err
        );
      }
    }
  }
}

pub fn expand(attr: TokenStream, input: TokenStream) -> BindgenResult<TokenStream> {
  #[cfg(feature = "type-def")]
  if BUILT_FLAG
    .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
    .is_ok()
  {
    // logic on first macro expansion
    prepare_type_def_file();

    if let Ok(wasi_register_file) = env::var("WASI_REGISTER_TMP_PATH") {
      if let Err(_e) = remove_existed_def_file(&wasi_register_file) {
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
                .find(|(_, m)| m.path().is_ident("napi"));
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
          let napi = item.parse_napi(&mut tokens, &item_opts)?;
          item_opts.check_used()?;
          napi.try_to_tokens(&mut tokens)?;

          #[cfg(feature = "type-def")]
          {
            output_type_def(&napi);
          }
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

    #[cfg(feature = "type-def")]
    {
      output_type_def(&napi);
    }
    Ok(tokens)
  }
}

#[cfg(feature = "type-def")]
fn output_type_def(napi: &Napi) {
  if let Ok(type_def_file) = env::var("TYPE_DEF_TMP_PATH") {
    if let Some(type_def) = napi.to_type_def() {
      // Use file locking to prevent race conditions when multiple crates write simultaneously
      let file_result = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&type_def_file);

      match file_result {
        Ok(file) => {
          let mut locked_file = FdRwLock::new(file);
          let write_result = locked_file.write();
          match write_result {
            Ok(mut write_guard) => {
              let write_result = write_guard
                .write_all(type_def.to_string().as_bytes())
                .and_then(|_| write_guard.write_all("\n".as_bytes()))
                .and_then(|_| write_guard.flush());

              if let Err(e) = write_result {
                println!("Failed to write type def file: {:?}", e);
              }
              // Lock is automatically released when write_guard is dropped
            }
            Err(e) => {
              println!("Failed to acquire write lock for type def file: {:?}", e);
            }
          }
        }
        Err(e) => {
          println!("Failed to open type def file: {:?}", e);
        }
      }
    }
  }
}

fn replace_napi_attr_in_mod(
  js_namespace: String,
  attrs: &mut Vec<syn::Attribute>,
) -> Option<BindgenAttrs> {
  let napi_attr = attrs
    .iter()
    .enumerate()
    .find(|(_, m)| m.path().is_ident("napi"));

  if let Some((index, napi_attr)) = napi_attr {
    // adds `namespace = #js_namespace` into `#[napi]` attribute
    let new_attr = match &napi_attr.meta {
      syn::Meta::Path(_) => {
        syn::parse_quote!(#[napi(namespace = #js_namespace)])
      }
      syn::Meta::List(list) => {
        let existing = list.tokens.clone();
        syn::parse_quote!(#[napi(#existing, namespace = #js_namespace)])
      }
      syn::Meta::NameValue(name_value) => {
        let existing = &name_value.value;
        syn::parse_quote!(#[napi(#existing, namespace = #js_namespace)])
      }
    };

    let struct_opts = BindgenAttrs::try_from(&new_attr).unwrap();
    attrs.remove(index);
    Some(struct_opts)
  } else {
    None
  }
}

#[cfg(feature = "type-def")]
fn prepare_type_def_file() {
  if let Ok(ref type_def_file) = env::var("TYPE_DEF_TMP_PATH") {
    if let Err(_e) = remove_existed_def_file(type_def_file) {
      #[cfg(debug_assertions)]
      {
        println!("Failed to manipulate type def file: {:?}", _e);
      }
    }
  }
}

#[cfg(feature = "type-def")]
fn remove_existed_def_file(def_file: &str) -> std::io::Result<()> {
  use std::io::{BufRead, BufReader, Seek, SeekFrom};

  let pkg_name = std::env::var("CARGO_PKG_NAME").expect("CARGO_PKG_NAME is not set");

  // Open the file with read/write access for locking
  let file = match std::fs::OpenOptions::new()
    .read(true)
    .write(true)
    .create(true)
    .open(def_file)
  {
    Ok(file) => file,
    Err(e) => return Err(e),
  };

  // Acquire an exclusive lock to prevent race conditions
  let mut locked_file = FdRwLock::new(file);
  let mut write_guard = locked_file.write().map_err(|e| {
    std::io::Error::new(
      std::io::ErrorKind::Other,
      format!("Failed to acquire write lock: {}", e),
    )
  })?;

  // Read the current content
  let mut content = String::new();
  write_guard.seek(SeekFrom::Start(0))?;
  {
    let reader = BufReader::new(&*write_guard);
    for line in reader.lines() {
      if let Ok(line) = line {
        if let Some((package_name, _)) = line.split_once(':') {
          if pkg_name == package_name {
            // Skip lines for the current package
            continue;
          }
        }
        content.push_str(&line);
        content.push('\n');
      }
    }
  }

  // Write back the filtered content
  write_guard.seek(SeekFrom::Start(0))?;
  write_guard.set_len(0)?; // Truncate the file
  std::io::Write::write_all(&mut *write_guard, content.as_bytes())?;
  write_guard.flush()?;

  // Lock is automatically released when write_guard is dropped
  Ok(())
}
