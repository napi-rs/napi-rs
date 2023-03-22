#[cfg(feature = "compat-mode")]
mod compat_macro;
mod parser;

#[macro_use]
extern crate syn;
#[macro_use]
extern crate napi_derive_backend;
#[macro_use]
extern crate quote;

#[cfg(not(feature = "noop"))]
use std::env;
#[cfg(not(feature = "noop"))]
use std::fs;
#[cfg(not(feature = "noop"))]
use std::io::Write;
#[cfg(all(feature = "type-def", not(feature = "noop")))]
use std::io::{BufWriter, Result as IOResult};
#[cfg(not(feature = "noop"))]
use std::sync::atomic::{AtomicBool, Ordering};

use napi_derive_backend::BindgenResult;
#[cfg(not(feature = "noop"))]
use napi_derive_backend::TryToTokens;
#[cfg(not(feature = "noop"))]
use napi_derive_backend::REGISTER_IDENTS;
#[cfg(all(feature = "type-def", not(feature = "noop")))]
use napi_derive_backend::{ToTypeDef, TypeDef};
#[cfg(not(feature = "noop"))]
use parser::{attrs::BindgenAttrs, ParseNapi};
use proc_macro::TokenStream as RawStream;
use proc_macro2::TokenStream;
#[cfg(not(feature = "noop"))]
use proc_macro2::TokenTree;
use quote::ToTokens;
use syn::Attribute;
#[cfg(not(feature = "noop"))]
use syn::Item;
#[cfg(feature = "compat-mode")]
use syn::{fold::Fold, parse_macro_input, ItemFn};

#[cfg(not(feature = "noop"))]
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

/// ```ignore
/// #[napi]
/// fn test(ctx: CallContext, name: String) {
///   "hello" + name
/// }
/// ```
#[cfg(not(feature = "noop"))]
#[proc_macro_attribute]
pub fn napi(attr: RawStream, input: RawStream) -> RawStream {
  if BUILT_FLAG
    .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
    .is_ok()
  {
    // logic on first macro expansion
    #[cfg(feature = "type-def")]
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
    if let Ok(wasi_register_file) = env::var("WASI_REGISTER_TMP_PATH") {
      if let Err(_e) = fs::remove_file(wasi_register_file) {
        #[cfg(debug_assertions)]
        {
          println!("Failed to manipulate wasi register file: {:?}", _e);
        }
      }
    }
  }

  match expand(attr.into(), input.into()) {
    Ok(tokens) => {
      if env::var("DEBUG_GENERATED_CODE").is_ok() {
        println!("{}", tokens);
      }
      REGISTER_IDENTS.with(|idents| {
        if let Ok(wasi_register_file) = env::var("WASI_REGISTER_TMP_PATH") {
          let mut file =
            fs::File::create(wasi_register_file).expect("Create wasi register file failed");
          file
            .write_all(format!("{:?}", idents.borrow()).as_bytes())
            .expect("Write wasi register file failed");
        }
      });
      tokens.into()
    }
    Err(diagnostic) => {
      println!("`napi` macro expand failed.");

      (quote! { #diagnostic }).into()
    }
  }
}

#[cfg(feature = "noop")]
#[proc_macro_attribute]
pub fn napi(attr: RawStream, input: RawStream) -> RawStream {
  match expand(attr.into(), input.into()) {
    Ok(tokens) => tokens.into(),
    Err(diagnostic) => {
      println!("`napi` macro expand failed.");

      (quote! { #diagnostic }).into()
    }
  }
}

#[cfg(feature = "noop")]
fn expand(_attr: TokenStream, input: TokenStream) -> BindgenResult<TokenStream> {
  let mut item = syn::parse2::<syn::Item>(input.into())?;
  let mut tokens = proc_macro2::TokenStream::new();

  match item {
    syn::Item::Struct(ref mut struct_) => struct_
      .fields
      .iter_mut()
      .for_each(|field| find_and_remove_napi_attr(&mut field.attrs)),
    _ => {}
  }

  item.to_tokens(&mut tokens);

  Ok(tokens)
}

#[cfg(feature = "noop")]
fn find_and_remove_napi_attr(attrs: &mut Vec<Attribute>) {
  loop {
    let napi_attr = attrs
      .iter()
      .enumerate()
      .find(|&(_, m)| m.path.segments[0].ident == "napi");

    let pos = match napi_attr {
      Some((pos, _raw_attr)) => pos,
      None => break,
    };

    attrs.remove(pos);
  }
}

#[cfg(not(feature = "noop"))]
fn expand(attr: TokenStream, input: TokenStream) -> BindgenResult<TokenStream> {
  let mut item = syn::parse2::<syn::Item>(input)?;
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
            syn::Item::Fn(ref mut function) => &mut function.attrs,
            syn::Item::Struct(ref mut struct_) => &mut struct_.attrs,
            syn::Item::Enum(ref mut enum_) => &mut enum_.attrs,
            syn::Item::Const(ref mut const_) => &mut const_.attrs,
            syn::Item::Impl(ref mut impl_) => &mut impl_.attrs,
            syn::Item::Mod(mod_) => {
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
          if let Ok(type_def_file) = env::var("TYPE_DEF_TMP_PATH") {
            if let Err(e) = output_type_def(type_def_file, napi.to_type_def()) {
              println!("Failed to write type def file: {:?}", e);
            };
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
    if let Ok(type_def_file) = env::var("TYPE_DEF_TMP_PATH") {
      if let Err(e) = output_type_def(type_def_file, napi.to_type_def()) {
        println!("Failed to write type def file: {:?}", e);
      };
    }
    Ok(tokens)
  }
}

#[cfg(all(feature = "type-def", not(feature = "noop")))]
fn output_type_def(type_def_file: String, type_def: Option<TypeDef>) -> IOResult<()> {
  if type_def.is_some() {
    let file = fs::OpenOptions::new()
      .append(true)
      .create(true)
      .open(type_def_file)?;

    let mut writer = BufWriter::<fs::File>::new(file);
    writer.write_all(type_def.unwrap().to_string().as_bytes())?;
    writer.write_all("\n".as_bytes())
  } else {
    IOResult::Ok(())
  }
}

#[cfg(feature = "compat-mode")]
#[proc_macro_attribute]
pub fn contextless_function(_attr: RawStream, input: RawStream) -> RawStream {
  let input = parse_macro_input!(input as ItemFn);
  let mut js_fn = compat_macro::JsFunction::new();
  js_fn.fold_item_fn(input);
  let fn_name = js_fn.name.unwrap();
  let fn_block = js_fn.block;
  let signature = js_fn.signature.unwrap();
  let visibility = js_fn.visibility;
  let new_fn_name = signature.ident.clone();
  let execute_js_function =
    compat_macro::get_execute_js_code(new_fn_name, compat_macro::FunctionKind::Contextless);

  let expanded = quote! {
    #[inline(always)]
    #signature #(#fn_block)*

    #visibility extern "C" fn #fn_name(
      raw_env: napi::sys::napi_env,
      cb_info: napi::sys::napi_callback_info,
    ) -> napi::sys::napi_value {
      use std::ptr;
      use std::panic::{self, AssertUnwindSafe};
      use std::ffi::CString;
      use napi::{Env, NapiValue, NapiRaw, Error, Status};

      let ctx = unsafe { Env::from_raw(raw_env) };
      #execute_js_function
    }
  };
  // Hand the output tokens back to the compiler
  RawStream::from(expanded)
}

#[cfg(feature = "compat-mode")]
#[proc_macro_attribute]
pub fn js_function(attr: RawStream, input: RawStream) -> RawStream {
  let arg_len = parse_macro_input!(attr as compat_macro::ArgLength);
  let arg_len_span = arg_len.length;
  let input = parse_macro_input!(input as ItemFn);
  let mut js_fn = compat_macro::JsFunction::new();
  js_fn.fold_item_fn(input);
  let fn_name = js_fn.name.unwrap();
  let fn_block = js_fn.block;
  let signature = js_fn.signature.unwrap();
  let visibility = js_fn.visibility;
  let new_fn_name = signature.ident.clone();
  let execute_js_function =
    compat_macro::get_execute_js_code(new_fn_name, compat_macro::FunctionKind::JsFunction);
  let expanded = quote! {
    #[inline(always)]
    #signature #(#fn_block)*

    #visibility extern "C" fn #fn_name(
      raw_env: napi::sys::napi_env,
      cb_info: napi::sys::napi_callback_info,
    ) -> napi::sys::napi_value {
      use std::ptr;
      use std::panic::{self, AssertUnwindSafe};
      use std::ffi::CString;
      use napi::{Env, Error, Status, NapiValue, NapiRaw, CallContext};
      let mut argc = #arg_len_span as usize;
      #[cfg(all(target_os = "windows", target_arch = "x86"))]
      let mut raw_args = vec![ptr::null_mut(); #arg_len_span];
      #[cfg(not(all(target_os = "windows", target_arch = "x86")))]
      let mut raw_args = [ptr::null_mut(); #arg_len_span];
      let mut raw_this = ptr::null_mut();

      unsafe {
        let status = napi::sys::napi_get_cb_info(
          raw_env,
          cb_info,
          &mut argc,
          raw_args.as_mut_ptr(),
          &mut raw_this,
          ptr::null_mut(),
        );
        debug_assert!(Status::from(status) == Status::Ok, "napi_get_cb_info failed");
      }

      let mut env = unsafe { Env::from_raw(raw_env) };
      #[cfg(all(target_os = "windows", target_arch = "x86"))]
      let ctx = CallContext::new(&mut env, cb_info, raw_this, raw_args.as_slice(), argc);
      #[cfg(not(all(target_os = "windows", target_arch = "x86")))]
      let ctx = CallContext::new(&mut env, cb_info, raw_this, &raw_args, argc);
      #execute_js_function
    }
  };
  // Hand the output tokens back to the compiler
  RawStream::from(expanded)
}

#[cfg(feature = "compat-mode")]
#[proc_macro_attribute]
pub fn module_exports(_attr: RawStream, input: RawStream) -> RawStream {
  let input = parse_macro_input!(input as ItemFn);
  let mut js_fn = compat_macro::JsFunction::new();
  js_fn.fold_item_fn(input);
  let fn_block = js_fn.block;
  let fn_name = js_fn.name.unwrap();
  let signature = js_fn.signature_raw.unwrap();
  let args_len = js_fn.args.len();
  let call_expr = if args_len == 1 {
    quote! { #fn_name(exports) }
  } else if args_len == 2 {
    quote! { #fn_name(exports, env) }
  } else {
    panic!("Arguments length of #[module_exports] function must be 1 or 2");
  };

  let register = quote! {
    #[cfg_attr(not(target_arch = "wasm32"), napi::bindgen_prelude::ctor)]
    fn __napi__explicit_module_register() {
      unsafe fn register(raw_env: napi::sys::napi_env, raw_exports: napi::sys::napi_value) -> napi::Result<()> {
        use napi::{Env, JsObject, NapiValue};

        let env = Env::from_raw(raw_env);
        let exports = JsObject::from_raw_unchecked(raw_env, raw_exports);

        #call_expr
      }

      napi::bindgen_prelude::register_module_exports(register)
    }
  };

  (quote! {
    #[inline]
    #signature #(#fn_block)*

    #register
  })
  .into()
}

#[cfg(not(feature = "noop"))]
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

#[cfg(all(feature = "type-def", not(feature = "noop")))]
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
