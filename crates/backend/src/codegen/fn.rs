use proc_macro2::{Ident, Span, TokenStream};
use quote::ToTokens;
use syn::spanned::Spanned;

use crate::{
  codegen::{get_intermediate_ident, get_register_ident, js_mod_to_token_stream},
  BindgenResult, CallbackArg, Diagnostic, FnKind, FnSelf, NapiFn, NapiFnArgKind, TryToTokens,
};

impl TryToTokens for NapiFn {
  fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()> {
    let name_str = self.name.to_string();
    let intermediate_ident = get_intermediate_ident(&name_str);
    let args_len = self.args.len();

    let ArgConversions {
      arg_conversions,
      args: arg_names,
      refs,
      mut_ref_spans,
      unsafe_,
    } = self.gen_arg_conversions()?;
    // The JS engine can't properly track mutability in an async context, so refuse to compile
    // code that tries to use async and mutability together without `unsafe` mark.
    if self.is_async && !mut_ref_spans.is_empty() && !unsafe_ {
      return Diagnostic::from_vec(
        mut_ref_spans
          .into_iter()
          .map(|s| Diagnostic::span_error(s, "mutable reference is unsafe with async"))
          .collect(),
      );
    }
    if Some(FnSelf::MutRef) == self.fn_self && self.is_async && !self.unsafe_ {
      return Err(Diagnostic::span_error(
        self.name.span(),
        "&mut self in async napi methods should be marked as unsafe",
      ));
    }
    let arg_ref_count = refs.len();
    let receiver = self.gen_fn_receiver();
    let receiver_ret_name = Ident::new("_ret", Span::call_site());
    let ret = self.gen_fn_return(&receiver_ret_name);
    let register = self.gen_fn_register();
    let attrs = &self.attrs;

    let build_ref_container = if self.is_async {
      quote! {
          struct NapiRefContainer([napi::sys::napi_ref; #arg_ref_count]);
          impl NapiRefContainer {
            fn drop(self, env: napi::sys::napi_env) {
              for r in self.0.into_iter() {
                assert_eq!(
                  unsafe { napi::sys::napi_reference_unref(env, r, &mut 0) },
                  napi::sys::Status::napi_ok,
                  "failed to delete napi ref"
                );
                assert_eq!(
                  unsafe { napi::sys::napi_delete_reference(env, r) },
                  napi::sys::Status::napi_ok,
                  "failed to delete napi ref"
                );
              }
            }
          }
          unsafe impl Send for NapiRefContainer {}
          unsafe impl Sync for NapiRefContainer {}
          let _make_ref = |a: ::std::ptr::NonNull<napi::bindgen_prelude::sys::napi_value__>| {
            let mut node_ref = ::std::mem::MaybeUninit::uninit();
            napi::bindgen_prelude::check_status!(unsafe {
                napi::bindgen_prelude::sys::napi_create_reference(env, a.as_ptr(), 1, node_ref.as_mut_ptr())
              },
              "failed to create napi ref"
            )?;
            Ok::<napi::sys::napi_ref, napi::Error>(unsafe { node_ref.assume_init() })
          };
          let mut _args_array = [::std::ptr::null_mut::<napi::bindgen_prelude::sys::napi_ref__>(); #arg_ref_count];
          let mut _arg_write_index = 0;

          #(#refs)*

          #[cfg(debug_assert)]
          {
              for a in &_args_array {
                assert!(!a.is_null(), "failed to initialize napi ref");
              }
          }
          let _args_ref = NapiRefContainer(_args_array);
      }
    } else {
      quote! {}
    };
    let native_call = if !self.is_async {
      quote! {
        napi::bindgen_prelude::within_runtime_if_available(move || {
          let #receiver_ret_name = {
            #receiver(#(#arg_names),*)
          };
          #ret
        })
      }
    } else {
      let call = if self.is_ret_result {
        quote! { #receiver(#(#arg_names),*).await }
      } else {
        quote! { Ok(#receiver(#(#arg_names),*).await) }
      };
      quote! {
        napi::bindgen_prelude::execute_tokio_future(env, async move { #call }, move |env, #receiver_ret_name| {
          _args_ref.drop(env);
          #ret
        })
      }
    };

    // async factory only
    let use_after_async = if self.is_async && self.parent.is_some() && self.fn_self.is_none() {
      quote! { true }
    } else {
      quote! { false }
    };

    let function_call_inner = quote! {
      napi::bindgen_prelude::CallbackInfo::<#args_len>::new(env, cb, None, #use_after_async).and_then(|mut cb| {
          #build_ref_container
          #(#arg_conversions)*
          #native_call
        })
    };

    let function_call = if args_len == 0
      && self.fn_self.is_none()
      && self.kind != FnKind::Constructor
      && self.kind != FnKind::Factory
      && !self.is_async
    {
      quote! { #native_call }
    } else if self.kind == FnKind::Constructor {
      quote! {
        // constructor function is called from class `factory`
        // so we should skip the original `constructor` logic
        if napi::__private::___CALL_FROM_FACTORY.with(|inner| inner.load(std::sync::atomic::Ordering::Relaxed)) {
          return std::ptr::null_mut();
        }
        #function_call_inner
      }
    } else {
      function_call_inner
    };

    let function_call = if self.catch_unwind {
      quote! {
        {
          std::panic::catch_unwind(|| { #function_call })
            .map_err(|e| {
              let message = {
                if let Some(string) = e.downcast_ref::<String>() {
                  string.clone()
                } else if let Some(string) = e.downcast_ref::<&str>() {
                  string.to_string()
                } else {
                  format!("panic from Rust code: {:?}", e)
                }
              };
              napi::Error::new(napi::Status::GenericFailure, message)
            })
            .and_then(|r| r)
        }
      }
    } else {
      quote! {
        #function_call
      }
    };

    (quote! {
      #(#attrs)*
      #[doc(hidden)]
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      extern "C" fn #intermediate_ident(
        env: napi::bindgen_prelude::sys::napi_env,
        cb: napi::bindgen_prelude::sys::napi_callback_info
      ) -> napi::bindgen_prelude::sys::napi_value {
        unsafe {
          #function_call.unwrap_or_else(|e| {
            napi::bindgen_prelude::JsError::from(e).throw_into(env);
            std::ptr::null_mut::<napi::bindgen_prelude::sys::napi_value__>()
          })
        }
      }

      #register
    })
    .to_tokens(tokens);

    Ok(())
  }
}

impl NapiFn {
  fn gen_arg_conversions(&self) -> BindgenResult<ArgConversions> {
    let mut arg_conversions = vec![];
    let mut args = vec![];
    let mut refs = vec![];
    let mut mut_ref_spans = vec![];
    let make_ref = |input| {
      quote! {
        _args_array[_arg_write_index] = _make_ref(
          ::std::ptr::NonNull::new(#input)
            .ok_or_else(|| napi::Error::new(napi::Status::InvalidArg, "referenced ptr is null".to_owned()))?
        )?;
        _arg_write_index += 1;
      }
    };

    // fetch this
    if let Some(parent) = &self.parent {
      match self.fn_self {
        Some(FnSelf::Ref) => {
          refs.push(make_ref(quote! { cb.this }));
          arg_conversions.push(quote! {
            let this_ptr = unsafe { cb.unwrap_raw::<#parent>()? };
            let this: &#parent = Box::leak(Box::from_raw(this_ptr));
          });
        }
        Some(FnSelf::MutRef) => {
          refs.push(make_ref(quote! { cb.this }));
          arg_conversions.push(quote! {
            let this_ptr = unsafe { cb.unwrap_raw::<#parent>()? };
            let this: &mut #parent = Box::leak(Box::from_raw(this_ptr));
          });
        }
        _ => {}
      };
    }

    let mut skipped_arg_count = 0;
    for (i, arg) in self.args.iter().enumerate() {
      let i = i - skipped_arg_count;
      let ident = Ident::new(&format!("arg{}", i), Span::call_site());

      match &arg.kind {
        NapiFnArgKind::PatType(path) => {
          if &path.ty.to_token_stream().to_string() == "Env" {
            args.push(quote! { napi::bindgen_prelude::Env::from(env) });
            skipped_arg_count += 1;
          } else {
            let is_in_class = self.parent.is_some();
            if let syn::Type::Path(path) = path.ty.as_ref() {
              if let Some(p) = path.path.segments.last() {
                if p.ident == "Reference" {
                  if !is_in_class {
                    bail_span!(p, "`Reference` is only allowed in class methods");
                  }
                  if let syn::PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments {
                    args: angle_bracketed_args,
                    ..
                  }) = &p.arguments
                  {
                    if let Some(syn::GenericArgument::Type(syn::Type::Path(path))) =
                      angle_bracketed_args.first()
                    {
                      if let Some(p) = path.path.segments.first() {
                        if p.ident == *self.parent.as_ref().unwrap() {
                          args.push(
                            quote! { napi::bindgen_prelude::Reference::from_value_ptr(this_ptr as *mut std::ffi::c_void, env)? },
                          );
                          skipped_arg_count += 1;
                          continue;
                        }
                      }
                    }
                  }
                } else if p.ident == "This" {
                  if let syn::PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments {
                    args: angle_bracketed_args,
                    ..
                  }) = &p.arguments
                  {
                    if let Some(syn::GenericArgument::Type(generic_type)) =
                      angle_bracketed_args.first()
                    {
                      if let syn::Type::Path(syn::TypePath {
                        path: syn::Path { segments, .. },
                        ..
                      }) = generic_type
                      {
                        if let Some(syn::PathSegment { ident, .. }) = segments.first() {
                          if let Some((primitive_type, _)) =
                            crate::PRIMITIVE_TYPES.iter().find(|(p, _)| ident == *p)
                          {
                            bail_span!(
                              ident,
                              "This type must not be {} \nthis in JavaScript function must be `Object` type or `undefined`",
                              primitive_type
                            );
                          }
                          args.push(
                            quote! {
                              {
                                <#ident as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb.this)?
                              }
                            },
                          );
                          skipped_arg_count += 1;
                          continue;
                        }
                      } else if let syn::Type::Reference(syn::TypeReference {
                        elem,
                        mutability,
                        ..
                      }) = generic_type
                      {
                        if let syn::Type::Path(syn::TypePath {
                          path: syn::Path { segments, .. },
                          ..
                        }) = elem.as_ref()
                        {
                          if let Some(syn::PathSegment { ident, .. }) = segments.first() {
                            refs.push(make_ref(quote! { cb.this }));
                            let token = if mutability.is_some() {
                              mut_ref_spans.push(generic_type.span());
                              quote! { <#ident as napi::bindgen_prelude::FromNapiMutRef>::from_napi_mut_ref(env, cb.this)? }
                            } else {
                              quote! { <#ident as napi::bindgen_prelude::FromNapiRef>::from_napi_ref(env, cb.this)? }
                            };
                            args.push(token);
                            skipped_arg_count += 1;
                            continue;
                          }
                        }
                      }
                    }
                  }
                  refs.push(make_ref(quote! { cb.this }));
                  args.push(quote! { <napi::bindgen_prelude::This as napi::NapiValue>::from_raw_unchecked(env, cb.this) });
                  skipped_arg_count += 1;
                  continue;
                }
              }
            }
            let (arg_conversion, arg_type) = self.gen_ty_arg_conversion(&ident, i, path);
            if NapiArgType::MutRef == arg_type {
              mut_ref_spans.push(path.ty.span());
            }
            if arg_type.is_ref() {
              refs.push(make_ref(quote! { cb.get_arg(#i) }));
            }
            arg_conversions.push(arg_conversion);
            args.push(quote! { #ident });
          }
        }
        NapiFnArgKind::Callback(cb) => {
          arg_conversions.push(self.gen_cb_arg_conversion(&ident, i, cb));
          args.push(quote! { #ident });
        }
      }
    }

    Ok(ArgConversions {
      arg_conversions,
      args,
      refs,
      mut_ref_spans,
      unsafe_: self.unsafe_,
    })
  }

  /// Returns a type conversion, and a boolean indicating whether this value needs to have a reference created to extend the lifetime
  /// for async functions.
  fn gen_ty_arg_conversion(
    &self,
    arg_name: &Ident,
    index: usize,
    path: &syn::PatType,
  ) -> (TokenStream, NapiArgType) {
    let ty = &*path.ty;
    let type_check = if self.return_if_invalid {
      quote! {
        if let Ok(maybe_promise) = <#ty as napi::bindgen_prelude::ValidateNapiValue>::validate(env, cb.get_arg(#index)) {
          if !maybe_promise.is_null() {
            return Ok(maybe_promise);
          }
        } else {
          return Ok(std::ptr::null_mut());
        }
      }
    } else if self.strict {
      quote! {
        let maybe_promise = <#ty as napi::bindgen_prelude::ValidateNapiValue>::validate(env, cb.get_arg(#index))?;
        if !maybe_promise.is_null() {
          return Ok(maybe_promise);
        }
      }
    } else {
      quote! {}
    };

    match ty {
      syn::Type::Reference(syn::TypeReference {
        mutability: Some(_),
        elem,
        ..
      }) => {
        let q = quote! {
          let #arg_name = {
            #type_check
            <#elem as napi::bindgen_prelude::FromNapiMutRef>::from_napi_mut_ref(env, cb.get_arg(#index))?
          };
        };
        (q, NapiArgType::MutRef)
      }
      syn::Type::Reference(syn::TypeReference { elem, .. }) => {
        let q = quote! {
          let #arg_name = {
            #type_check
            <#elem as napi::bindgen_prelude::FromNapiRef>::from_napi_ref(env, cb.get_arg(#index))?
          };
        };
        (q, NapiArgType::Ref)
      }
      _ => {
        let q = quote! {
          let #arg_name = {
            #type_check
            <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb.get_arg(#index))?
          };
        };
        (q, NapiArgType::Value)
      }
    }
  }

  fn gen_cb_arg_conversion(&self, arg_name: &Ident, index: usize, cb: &CallbackArg) -> TokenStream {
    let mut inputs = vec![];
    let mut arg_conversions = vec![];

    for (i, ty) in cb.args.iter().enumerate() {
      let cb_arg_ident = Ident::new(&format!("callback_arg_{}", i), Span::call_site());
      inputs.push(quote! { #cb_arg_ident: #ty });
      arg_conversions.push(
        quote! { <#ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, #cb_arg_ident)? },
      );
    }

    let ret = match &cb.ret {
      Some(ty) => {
        quote! {
          let ret = <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, ret_ptr)?;

          Ok(ret)
        }
      }
      None => quote! { Ok(()) },
    };

    quote! {
      napi::bindgen_prelude::assert_type_of!(env, cb.get_arg(#index), napi::bindgen_prelude::ValueType::Function)?;
      let #arg_name = |#(#inputs),*| {
        let args = vec![
          #(#arg_conversions),*
        ];

        let mut ret_ptr = std::ptr::null_mut();

        napi::bindgen_prelude::check_pending_exception!(
          env,
          napi::bindgen_prelude::sys::napi_call_function(
            env,
            cb.this(),
            cb.get_arg(#index),
            args.len(),
            args.as_ptr(),
            &mut ret_ptr
          )
        )?;

        #ret
      };
    }
  }

  fn gen_fn_receiver(&self) -> TokenStream {
    let name = &self.name;

    match self.fn_self {
      Some(FnSelf::Value) => {
        // impossible, panic! in parser
        unreachable!();
      }
      Some(FnSelf::Ref) | Some(FnSelf::MutRef) => quote! { this.#name },
      None => match &self.parent {
        Some(class) => quote! { #class::#name },
        None => quote! { #name },
      },
    }
  }

  fn gen_fn_return(&self, ret: &Ident) -> TokenStream {
    let js_name = &self.js_name;

    if let Some(ty) = &self.ret {
      let ty_string = ty.into_token_stream().to_string();
      let is_return_self = ty_string == "& Self" || ty_string == "&mut Self";
      if self.kind == FnKind::Constructor {
        if self.is_ret_result {
          if self.parent_is_generator {
            quote! { cb.construct_generator(#js_name, #ret?) }
          } else {
            quote! { cb.construct(#js_name, #ret?) }
          }
        } else if self.parent_is_generator {
          quote! { cb.construct_generator(#js_name, #ret) }
        } else {
          quote! { cb.construct(#js_name, #ret) }
        }
      } else if self.kind == FnKind::Factory {
        if self.is_ret_result {
          if self.parent_is_generator {
            quote! { cb.generator_factory(#js_name, #ret?) }
          } else if self.is_async {
            quote! { cb.factory(#js_name, #ret) }
          } else {
            quote! { cb.factory(#js_name, #ret?) }
          }
        } else if self.parent_is_generator {
          quote! { cb.generator_factory(#js_name, #ret) }
        } else {
          quote! { cb.factory(#js_name, #ret) }
        }
      } else if self.is_ret_result {
        if self.is_async {
          quote! {
            <#ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, #ret)
          }
        } else if is_return_self {
          quote! { #ret.map(|_| cb.this) }
        } else {
          quote! {
            match #ret {
              Ok(value) => napi::bindgen_prelude::ToNapiValue::to_napi_value(env, value),
              Err(err) => {
                napi::bindgen_prelude::JsError::from(err).throw_into(env);
                Ok(std::ptr::null_mut())
              },
            }
          }
        }
      } else if is_return_self {
        quote! { Ok(cb.this) }
      } else {
        quote! {
          <#ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, #ret)
        }
      }
    } else {
      quote! {
        <() as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, ())
      }
    }
  }

  fn gen_fn_register(&self) -> TokenStream {
    if self.parent.is_some() {
      quote! {}
    } else {
      let name_str = self.name.to_string();
      let js_name = format!("{}\0", &self.js_name);
      let name_len = self.js_name.len();
      let module_register_name = get_register_ident(&name_str);
      let intermediate_ident = get_intermediate_ident(&name_str);
      let js_mod_ident = js_mod_to_token_stream(self.js_mod.as_ref());
      let cb_name = Ident::new(&format!("{}_js_function", name_str), Span::call_site());
      crate::codegen::REGISTER_IDENTS.with(|c| {
        c.borrow_mut().push(module_register_name.to_string());
      });
      quote! {
        #[allow(non_snake_case)]
        #[allow(clippy::all)]
        unsafe fn #cb_name(env: napi::bindgen_prelude::sys::napi_env) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
          let mut fn_ptr = std::ptr::null_mut();

          napi::bindgen_prelude::check_status!(
            napi::bindgen_prelude::sys::napi_create_function(
              env,
              #js_name.as_ptr().cast(),
              #name_len,
              Some(#intermediate_ident),
              std::ptr::null_mut(),
              &mut fn_ptr,
            ),
            "Failed to register function `{}`",
            #name_str,
          )?;
          napi::bindgen_prelude::register_js_function(#js_name, #cb_name, Some(#intermediate_ident));
          Ok(fn_ptr)
        }

        #[allow(clippy::all)]
        #[allow(non_snake_case)]
        #[cfg(all(not(test), not(feature = "noop"), not(target_family = "wasm")))]
        #[napi::bindgen_prelude::ctor]
        fn #module_register_name() {
          napi::bindgen_prelude::register_module_export(#js_mod_ident, #js_name, #cb_name);
        }

        #[allow(clippy::all)]
        #[allow(non_snake_case)]
        #[cfg(all(not(test), not(feature = "noop"), target_family = "wasm"))]
        #[no_mangle]
        extern "C" fn #module_register_name() {
          napi::bindgen_prelude::register_module_export(#js_mod_ident, #js_name, #cb_name);
        }
      }
    }
  }
}

struct ArgConversions {
  pub args: Vec<TokenStream>,
  pub arg_conversions: Vec<TokenStream>,
  pub refs: Vec<TokenStream>,
  pub mut_ref_spans: Vec<Span>,
  pub unsafe_: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum NapiArgType {
  Ref,
  MutRef,
  Value,
}

impl NapiArgType {
  fn is_ref(&self) -> bool {
    matches!(self, NapiArgType::Ref | NapiArgType::MutRef)
  }
}
