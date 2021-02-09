extern crate proc_macro;

use proc_macro::TokenStream;
use proc_macro2::{Ident, Literal};
use quote::{format_ident, quote};
use syn::fold::{fold_fn_arg, fold_signature, Fold};
use syn::parse::{Parse, ParseStream, Result};
use syn::punctuated::Punctuated;
use syn::{parse_macro_input, Block, FnArg, ItemFn, Signature, Token, Visibility};

struct ArgLength {
  length: Literal,
}

impl Parse for ArgLength {
  fn parse(input: ParseStream) -> Result<Self> {
    let vars = Punctuated::<Literal, Token![,]>::parse_terminated(input)?;
    Ok(ArgLength {
      length: vars
        .first()
        .cloned()
        .unwrap_or_else(|| Literal::usize_unsuffixed(0)),
    })
  }
}

struct JsFunction {
  args: Vec<FnArg>,
  name: Option<Ident>,
  signature: Option<Signature>,
  signature_raw: Option<Signature>,
  block: Vec<Block>,
  visibility: Visibility,
}

impl JsFunction {
  pub fn new() -> Self {
    JsFunction {
      args: vec![],
      name: None,
      signature: None,
      signature_raw: None,
      visibility: Visibility::Inherited,
      block: vec![],
    }
  }
}

impl Fold for JsFunction {
  fn fold_fn_arg(&mut self, arg: FnArg) -> FnArg {
    self.args.push(arg.clone());
    fold_fn_arg(self, arg)
  }

  fn fold_signature(&mut self, signature: Signature) -> Signature {
    self.name = Some(format_ident!("{}", signature.ident));
    let mut new_signature = signature.clone();
    new_signature.ident = format_ident!("_generated_{}_generated_", signature.ident);
    self.signature = Some(new_signature);
    self.signature_raw = Some(signature.clone());
    fold_signature(self, signature)
  }

  fn fold_visibility(&mut self, v: Visibility) -> Visibility {
    self.visibility = v.clone();
    v
  }

  fn fold_block(&mut self, node: Block) -> Block {
    self.block.push(node.clone());
    node
  }
}

#[proc_macro_attribute]
pub fn js_function(attr: TokenStream, input: TokenStream) -> TokenStream {
  let arg_len = parse_macro_input!(attr as ArgLength);
  let arg_len_span = arg_len.length;
  let input = parse_macro_input!(input as ItemFn);
  let mut js_fn = JsFunction::new();
  js_fn.fold_item_fn(input);
  let fn_name = js_fn.name.unwrap();
  let fn_block = js_fn.block;
  let signature = js_fn.signature.unwrap();
  let visibility = js_fn.visibility;
  let new_fn_name = signature.ident.clone();
  let execute_js_function = get_execute_js_code(new_fn_name, FunctionKind::JsFunction);
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

      use napi::{Env, Error, Status, NapiValue, IntoNapiValue, CallContext};
      let mut argc = #arg_len_span as usize;
      let mut raw_args: [napi::sys::napi_value; #arg_len_span] = [ptr::null_mut(); #arg_len_span];
      let mut raw_this = ptr::null_mut();
      let mut context = ptr::null_mut();

      unsafe {
        let status = napi::sys::napi_get_cb_info(
          raw_env,
          cb_info,
          &mut argc,
          raw_args.as_mut_ptr(),
          &mut raw_this,
          &mut context,
        );
        debug_assert!(Status::from(status) == Status::Ok, "napi_get_cb_info failed");
      }

      let mut env = unsafe { Env::from_raw(raw_env) };
      let ctx = CallContext::new(&mut env, cb_info, raw_this, &raw_args, #arg_len_span, argc, context);
      #execute_js_function
    }
  };
  // Hand the output tokens back to the compiler
  TokenStream::from(expanded)
}

#[proc_macro_attribute]
pub fn contextless_function(_attr: TokenStream, input: TokenStream) -> TokenStream {
  let input = parse_macro_input!(input as ItemFn);
  let mut js_fn = JsFunction::new();
  js_fn.fold_item_fn(input);
  let fn_name = js_fn.name.unwrap();
  let fn_block = js_fn.block;
  let signature = js_fn.signature.unwrap();
  let visibility = js_fn.visibility;
  let new_fn_name = signature.ident.clone();
  let execute_js_function = get_execute_js_code(new_fn_name, FunctionKind::Contextless);

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
      use napi::{Env, NapiValue, Error, Status, IntoNapiValue};

      let ctx = unsafe { Env::from_raw(raw_env) };
      #execute_js_function
    }
  };
  // Hand the output tokens back to the compiler
  TokenStream::from(expanded)
}

enum FunctionKind {
  Contextless,
  JsFunction,
}

#[inline]
fn get_execute_js_code(
  new_fn_name: Ident,
  function_kind: FunctionKind,
) -> proc_macro2::TokenStream {
  let return_token_stream = match function_kind {
    FunctionKind::Contextless => {
      quote! {
        Ok(Some(v)) => unsafe { v.raw() },
        Ok(None) => ptr::null_mut(),
      }
    }
    FunctionKind::JsFunction => {
      quote! {
        Ok(v) => unsafe { v.raw() },
      }
    }
  };
  quote! {
    match panic::catch_unwind(AssertUnwindSafe(move || #new_fn_name(ctx))).map_err(|e| {
      let message = {
        if let Some(string) = e.downcast_ref::<String>() {
          string.clone()
        } else if let Some(string) = e.downcast_ref::<&str>() {
          string.to_string()
        } else {
          format!("panic from Rust code: {:?}", e)
        }
      };
      Error::from_reason(message)
    }).and_then(|v| v) {
      #return_token_stream
      Err(e) => {
        unsafe {
          let mut pending_exception = false;
          let status = napi::sys::napi_is_exception_pending(raw_env, &mut pending_exception);
          debug_assert!(status == napi::sys::Status::napi_ok);
          if pending_exception {
            let mut exception = ptr::null_mut();
            let get_status = napi::sys::napi_get_and_clear_last_exception(raw_env, &mut exception);
            debug_assert!(get_status == napi::sys::Status::napi_ok);
            let throw_status = napi::sys::napi_throw(raw_env, exception);
            debug_assert!(throw_status == napi::sys::Status::napi_ok);
          } else {
            napi::JsError::from(e).throw_into(raw_env);
          }
        };
        ptr::null_mut()
      }
    }
  }
}

#[proc_macro_attribute]
pub fn module_exports(_attr: TokenStream, input: TokenStream) -> TokenStream {
  let input = parse_macro_input!(input as ItemFn);
  let mut js_fn = JsFunction::new();
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
  let expanded = quote! {
    #[inline]
    #signature #(#fn_block)*

    #[no_mangle]
    unsafe extern "C" fn napi_register_module_v1(
      raw_env: napi::sys::napi_env,
      raw_exports: napi::sys::napi_value,
    ) -> napi::sys::napi_value {
      use std::ffi::CString;
      use std::ptr;
      use napi::{Env, JsObject, NapiValue};

      #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
      use napi::shutdown_tokio_rt;
      let env = Env::from_raw(raw_env);
      let exports = JsObject::from_raw_unchecked(raw_env, raw_exports);
      let result: napi::Result<()> = #call_expr;
      #[cfg(all(feature = "tokio_rt", feature = "napi4"))]
      let hook_result = napi::check_status!(unsafe {
        napi::sys::napi_add_env_cleanup_hook(raw_env, Some(shutdown_tokio_rt), ptr::null_mut())
      });
      #[cfg(not(all(feature = "tokio_rt", feature = "napi4")))]
      let hook_result = Ok(());
      match hook_result.and_then(move |_| result) {
        Ok(_) => raw_exports,
        Err(e) => {
          unsafe {
            napi::sys::napi_throw_error(
              raw_env,
              ptr::null(),
              CString::from_vec_unchecked(format!("Error initializing module: {}", e).into())
                .as_ptr(),
            )
          };
          ptr::null_mut()
        }
      }
    }
  };
  // Hand the output tokens back to the compiler
  TokenStream::from(expanded)
}
