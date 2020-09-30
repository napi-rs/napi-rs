extern crate proc_macro;

use std::mem;

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
        .map(|i| i.clone())
        .unwrap_or(Literal::usize_unsuffixed(0)),
    })
  }
}

struct JsFunction {
  args: Vec<FnArg>,
  name: mem::MaybeUninit<Ident>,
  signature: mem::MaybeUninit<Signature>,
  block: Vec<Block>,
  visibility: Visibility,
}

impl JsFunction {
  pub fn new() -> Self {
    JsFunction {
      args: vec![],
      name: mem::MaybeUninit::uninit(),
      signature: mem::MaybeUninit::uninit(),
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
    self.name = mem::MaybeUninit::new(format_ident!("{}", signature.ident));
    let mut new_signature = signature.clone();
    new_signature.ident = format_ident!("_{}", signature.ident);
    self.signature = mem::MaybeUninit::new(new_signature);
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
  let fn_name = unsafe { js_fn.name.assume_init() };
  let fn_block = js_fn.block;
  let signature = unsafe { js_fn.signature.assume_init() };
  let visibility = js_fn.visibility;
  let new_fn_name = signature.ident.clone();
  let execute_js_function = get_execute_js_code(new_fn_name, FunctionKind::JsFunction);
  let expanded = quote! {
    #[inline]
    #signature #(#fn_block)*

    #visibility extern "C" fn #fn_name(
      raw_env: napi::sys::napi_env,
      cb_info: napi::sys::napi_callback_info,
    ) -> napi::sys::napi_value {
      use std::io::Write;
      use std::mem;
      use std::os::raw::c_char;
      use std::ptr;
      use std::panic::{self, AssertUnwindSafe};
      use std::ffi::CString;
      use napi::{JsUnknown, Env, Error, Status, NapiValue, CallContext};
      let mut argc = #arg_len_span as usize;
      let mut raw_args: [napi::sys::napi_value; #arg_len_span] = [ptr::null_mut(); #arg_len_span];
      let mut raw_this = ptr::null_mut();

      let mut has_error = false;

      unsafe {
        let status = napi::sys::napi_get_cb_info(
          raw_env,
          cb_info,
          &mut argc as *mut usize as *mut u64,
          raw_args.as_mut_ptr(),
          &mut raw_this,
          ptr::null_mut(),
        );
        debug_assert!(Status::from(status) == Status::Ok, "napi_get_cb_info failed");
      }

      let mut env = Env::from_raw(raw_env);
      let ctx = CallContext::new(&mut env, cb_info, raw_this, &raw_args, #arg_len_span, argc as usize);
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
  let fn_name = unsafe { js_fn.name.assume_init() };
  let fn_block = js_fn.block;
  let signature = unsafe { js_fn.signature.assume_init() };
  let visibility = js_fn.visibility;
  let new_fn_name = signature.ident.clone();
  let execute_js_function = get_execute_js_code(new_fn_name, FunctionKind::Contextless);

  let expanded = quote! {
    #[inline]
    #signature #(#fn_block)*

    #visibility extern "C" fn #fn_name(
      raw_env: napi::sys::napi_env,
      cb_info: napi::sys::napi_callback_info,
    ) -> napi::sys::napi_value {
      use std::io::Write;
      use std::mem;
      use std::os::raw::c_char;
      use std::ptr;
      use std::panic::{self, AssertUnwindSafe};
      use std::ffi::CString;
      use napi::{Env, NapiValue, Error, Status};
      let mut has_error = false;

      let ctx = Env::from_raw(raw_env);
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
        Ok(Some(v)) => v.raw(),
        Ok(None) => ptr::null_mut(),
      }
    }
    FunctionKind::JsFunction => {
      quote! {
        Ok(v) => v.raw(),
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
        let message = format!("{}", e);
        unsafe {
          napi::sys::napi_throw_error(raw_env, ptr::null(), CString::from_vec_unchecked(message.into()).as_ptr() as *const c_char);
        }
        ptr::null_mut()
      }
    }
  }
}
