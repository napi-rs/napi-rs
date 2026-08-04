#[cfg(feature = "compat-mode")]
mod compat_macro;
mod expand;
#[cfg(not(feature = "noop"))]
mod parser;

#[cfg(not(feature = "noop"))]
#[macro_use]
extern crate napi_derive_backend;
#[macro_use]
extern crate quote;

use std::env;

use proc_macro::TokenStream;
#[cfg(feature = "compat-mode")]
use syn::fold::Fold;
use syn::{parse_macro_input, ItemFn};

/// ```ignore
/// #[napi]
/// fn test(name: String) {
///   "hello" + name
/// }
/// ```
///
/// # Single inheritance: `#[napi(extends = Parent)]`
///
/// A `#[napi]` class may declare a single parent class (issue #1164). Multi-level
/// chains (`A` ← `B` ← `C`) are supported; multiple parents (mixins) are not —
/// each class has exactly one `extends`.
///
/// ```ignore
/// #[napi]
/// pub struct Base {
///   value: i32,
/// }
///
/// #[napi]
/// impl Base {
///   #[napi(getter)]
///   pub fn get_value(&self) -> i32 { self.value }
///   #[napi]
///   pub fn doubled(&self) -> i32 { self.value * 2 }
/// }
///
/// #[napi(extends = Base)]
/// #[repr(C)]
/// pub struct Sub {
///   base: Base, // MUST be the first field
///   extra: i32,
/// }
/// ```
///
/// ## Layout requirements
///
/// The child must be `#[repr(C)]` and embed the parent as its **first field**,
/// so the parent's portion sits at offset 0 and a `*mut Child` can be borrowed
/// as `&Parent`. Both are enforced at compile time by generated assertions: the
/// first field's type must be *exactly* the parent (`Box<Parent>`/`Rc<Parent>`/
/// newtype wrappers are rejected, with a `#[diagnostic::on_unimplemented]`
/// message that names the misuse), and `offset_of!(Child, parent)` must be `0`.
/// A `#[napi(constructor)]` cannot be combined with `#[napi(extends)]`;
/// construct the child through a `#[napi(factory)]` instead.
///
/// ## Runtime semantics (v1 — instance-only)
///
/// Only the **instance** prototype chain is wired
/// (`Object.setPrototypeOf(Sub.prototype, Base.prototype)`), so `sub instanceof
/// Base` holds and inherited getters, setters, and plain methods resolve through
/// the prototype chain. The **constructor/static** chain is deliberately not
/// re-parented: a parent's `static`s and factories are **not** inherited
/// (`Sub.baseStatic` stays `undefined`). Inheriting a plain method on a
/// descendant additionally requires the `napi8` feature (non-wasm); without it
/// the inherited method still hits V8's receiver-signature check and throws.
/// `#[napi(extends)]` cannot be combined with the iterator/generator protocols.
///
/// ## Generated TypeScript
///
/// Inheritance is emitted as instance-only **declaration merging**, a sibling
/// `export interface Sub extends Base {}` next to `export declare class Sub`, so
/// the child's instance type gains the parent's instance members while its
/// static side is left untouched — matching the runtime, which does not inherit
/// statics. (It is deliberately not `class Sub extends Base`, which TypeScript
/// would read as also inheriting the parent's statics.)
///
/// ## Not yet supported (growth path)
///
/// This is the first, deliberately narrow version of inheritance. The embedded
/// `#[repr(C)]` + parent-first-field model is its main constraint: a child that
/// wants to *wrap* rather than embed its parent (e.g. `struct Sub { inner:
/// PureType }`, or a `#[serde(transparent)]` newtype) cannot use it. The planned
/// growth path is an opt-in composition variant,
/// `#[napi(extends = Parent, via = AsRef)]`, where the child proves
/// `AsRef<Parent>` (and `AsMut<Parent>` for `&mut self` parent methods) instead
/// of embedding the parent at offset 0 — lifting the layout constraint while
/// reusing the same tag hierarchy and prototype wiring. Inherited statics and
/// factories, and combining `extends` with the iterator/generator protocols,
/// also remain out of scope.
#[proc_macro_attribute]
pub fn napi(attr: TokenStream, input: TokenStream) -> TokenStream {
  match expand::expand(attr.into(), input.into()) {
    Ok(tokens) => {
      if env::var("NAPI_DEBUG_GENERATED_CODE").is_ok() {
        println!("{tokens}");
      }
      tokens.into()
    }
    Err(diagnostic) => {
      println!("`napi` macro expand failed.");

      (quote! { #diagnostic }).into()
    }
  }
}

#[cfg(feature = "compat-mode")]
#[proc_macro_attribute]
pub fn contextless_function(_attr: TokenStream, input: TokenStream) -> TokenStream {
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
  TokenStream::from(expanded)
}

#[cfg(feature = "compat-mode")]
#[proc_macro_attribute]
pub fn js_function(attr: TokenStream, input: TokenStream) -> TokenStream {
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
  TokenStream::from(expanded)
}

#[cfg(feature = "compat-mode")]
#[proc_macro_attribute]
pub fn module_exports(_attr: TokenStream, input: TokenStream) -> TokenStream {
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
    #[cfg(not(target_family = "wasm"))]
    napi::ctor::declarative::ctor! {
      #[ctor(unsafe)]
      fn __napi_explicit_module_register() {
        unsafe fn register(raw_env: napi::sys::napi_env, raw_exports: napi::sys::napi_value) -> napi::Result<()> {
          use napi::{Env, JsObject, NapiValue};

          let env = Env::from_raw(raw_env);
          let exports = JsObject::from_raw_unchecked(raw_env, raw_exports);

          #call_expr
        }

        napi::bindgen_prelude::register_module_exports(register)
      }
    }
  };

  (quote! {
    #[inline]
    #signature #(#fn_block)*

    #register
  })
  .into()
}

#[proc_macro_attribute]
pub fn module_init(_: TokenStream, input: TokenStream) -> TokenStream {
  let input = parse_macro_input!(input as ItemFn);
  quote! {
    napi::ctor::declarative::ctor! {
      #[ctor(unsafe)]
      #input
    }
  }
  .into()
}
