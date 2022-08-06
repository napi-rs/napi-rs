use proc_macro2::{Ident, Span, TokenStream};
use quote::ToTokens;

use crate::{
  codegen::{get_intermediate_ident, get_register_ident, js_mod_to_token_stream},
  BindgenResult, CallbackArg, FnKind, FnSelf, NapiFn, NapiFnArgKind, TryToTokens,
};

impl TryToTokens for NapiFn {
  fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()> {
    let name_str = self.name.to_string();
    let intermediate_ident = get_intermediate_ident(&name_str);
    let args_len = self.args.len();

    let (arg_conversions, arg_names) = self.gen_arg_conversions()?;
    let receiver = self.gen_fn_receiver();
    let receiver_ret_name = Ident::new("_ret", Span::call_site());
    let ret = self.gen_fn_return(&receiver_ret_name);
    let register = self.gen_fn_register();
    let attrs = &self.attrs;

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
        napi::bindgen_prelude::execute_tokio_future(env, async move { #call }, |env, #receiver_ret_name| {
          #ret
        })
      }
    };

    let function_call = if args_len == 0
      && self.fn_self.is_none()
      && self.kind != FnKind::Constructor
      && self.kind != FnKind::Factory
    {
      quote! { #native_call }
    } else if self.kind == FnKind::Constructor {
      quote! {
        // constructor function is called from class `factory`
        // so we should skip the original `constructor` logic
        let inner = napi::__private::___CALL_FROM_FACTORY.get_or_default();
        if inner.load(std::sync::atomic::Ordering::Relaxed) {
          return std::ptr::null_mut();
        }
        napi::bindgen_prelude::CallbackInfo::<#args_len>::new(env, cb, None).and_then(|mut cb| {
          #(#arg_conversions)*
          #native_call
        })
      }
    } else {
      quote! {
        napi::bindgen_prelude::CallbackInfo::<#args_len>::new(env, cb, None).and_then(|mut cb| {
          #(#arg_conversions)*
          #native_call
        })
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
  fn gen_arg_conversions(&self) -> BindgenResult<(Vec<TokenStream>, Vec<TokenStream>)> {
    let mut arg_conversions = vec![];
    let mut args = vec![];

    // fetch this
    if let Some(parent) = &self.parent {
      match self.fn_self {
        Some(FnSelf::Ref) => {
          arg_conversions.push(quote! {
            let this_ptr = unsafe { cb.unwrap_raw::<#parent>()? };
            let this: &#parent = Box::leak(Box::from_raw(this_ptr));
          });
        }
        Some(FnSelf::MutRef) => {
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
                  if !is_in_class {
                    bail_span!(p, "`This` is only allowed in class methods");
                  }
                  args.push(
                    quote! { <napi::bindgen_prelude::This as napi::NapiValue>::from_raw_unchecked(env, cb.this) },
                  );
                  skipped_arg_count += 1;
                  continue;
                }
              }
            }
            arg_conversions.push(self.gen_ty_arg_conversion(&ident, i, path));
            args.push(quote! { #ident });
          }
        }
        NapiFnArgKind::Callback(cb) => {
          arg_conversions.push(self.gen_cb_arg_conversion(&ident, i, cb));
          args.push(quote! { #ident });
        }
      }
    }

    Ok((arg_conversions, args))
  }

  fn gen_ty_arg_conversion(
    &self,
    arg_name: &Ident,
    index: usize,
    path: &syn::PatType,
  ) -> TokenStream {
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
        quote! {
          let #arg_name = {
            #type_check
            <#elem as napi::bindgen_prelude::FromNapiMutRef>::from_napi_mut_ref(env, cb.get_arg(#index))?
          };
        }
      }
      syn::Type::Reference(syn::TypeReference { elem, .. }) => {
        quote! {
          let #arg_name = {
            #type_check
            <#elem as napi::bindgen_prelude::FromNapiRef>::from_napi_ref(env, cb.get_arg(#index))?
          };
        }
      }
      _ => {
        quote! {
          let #arg_name = {
            #type_check
            <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb.get_arg(#index))?
          };
        }
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

        napi::bindgen_prelude::check_status!(
          napi::bindgen_prelude::sys::napi_call_function(
            env,
            cb.this(),
            cb.get_arg(#index),
            args.len(),
            args.as_ptr(),
            &mut ret_ptr
          ),
          "Failed to call napi callback",
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
        unimplemented!();
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
      let name_len = js_name.len();
      let module_register_name = get_register_ident(&name_str);
      let intermediate_ident = get_intermediate_ident(&name_str);
      let js_mod_ident = js_mod_to_token_stream(self.js_mod.as_ref());
      let cb_name = Ident::new(&format!("{}_js_function", name_str), Span::call_site());
      quote! {
        #[allow(non_snake_case)]
        #[allow(clippy::all)]
        unsafe fn #cb_name(env: napi::bindgen_prelude::sys::napi_env) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
          let mut fn_ptr = std::ptr::null_mut();

          napi::bindgen_prelude::check_status!(
            napi::bindgen_prelude::sys::napi_create_function(
              env,
              #js_name.as_ptr() as *const _,
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
        #[cfg(all(not(test), not(feature = "noop")))]
        #[napi::bindgen_prelude::ctor]
        fn #module_register_name() {
          napi::bindgen_prelude::register_module_export(#js_mod_ident, #js_name, #cb_name);
        }
      }
    }
  }
}
