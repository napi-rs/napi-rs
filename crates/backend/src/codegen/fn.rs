use proc_macro2::{Ident, Span, TokenStream};
use quote::ToTokens;
use syn::{spanned::Spanned, Type, TypePath};

use crate::{
  codegen::{get_intermediate_ident, js_mod_to_token_stream},
  BindgenResult, CallbackArg, Diagnostic, FnKind, FnSelf, NapiFn, NapiFnArgKind, TryToTokens,
  TYPEDARRAY_SLICE_TYPES,
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
    let attrs = &self.attrs;
    let arg_ref_count = refs.len();
    let receiver = self.gen_fn_receiver();
    let receiver_ret_name = Ident::new("_ret", Span::call_site());
    let ret = self.gen_fn_return(&receiver_ret_name)?;
    let register = self.gen_fn_register();

    if self.module_exports {
      (quote! {
        #(#attrs)*
        #[doc(hidden)]
        #[allow(non_snake_case)]
        #[allow(clippy::all)]
        unsafe extern "C" fn #intermediate_ident(
          env: napi::bindgen_prelude::sys::napi_env,
          _napi_module_exports_: napi::bindgen_prelude::sys::napi_value,
        ) -> napi::Result<napi::bindgen_prelude::sys::napi_value> {
          let __wrapped_env = napi::bindgen_prelude::Env::from(env);
          #(#arg_conversions)*
          let #receiver_ret_name = {
            #receiver(#(#arg_names),*)
          };
          #ret
        }

        #register
      })
      .to_tokens(tokens);

      return Ok(());
    }

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

          #[cfg(debug_assertions)]
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
      if self.within_async_runtime {
        quote! {
          napi::bindgen_prelude::within_runtime_if_available(move || {
            let #receiver_ret_name = {
              #receiver(#(#arg_names),*)
            };
            #ret
          })
        }
      } else {
        quote! {
          let #receiver_ret_name = {
            #receiver(#(#arg_names),*)
          };
          #ret
        }
      }
    } else {
      let call = if self.is_ret_result {
        quote! { #receiver(#(#arg_names),*).await }
      } else {
        let ret_type = if let Some(t) = &self.ret {
          quote! { #t }
        } else {
          quote! { () }
        };
        quote! { Ok::<#ret_type, napi::Error>(#receiver(#(#arg_names),*).await) }
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
      napi::bindgen_prelude::CallbackInfo::<#args_len>::new(env, cb, None, #use_after_async).and_then(|#[allow(unused_mut)] mut cb| {
          let __wrapped_env = napi::bindgen_prelude::Env::from(env);
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
      let return_from_factory = if self.catch_unwind {
        quote! { return Ok(std::ptr::null_mut()); }
      } else {
        quote! { return std::ptr::null_mut(); }
      };
      quote! {
        // constructor function is called from class `factory`
        // so we should skip the original `constructor` logic
        if napi::__private::___CALL_FROM_FACTORY.with(|inner| inner.get()) {
            #return_from_factory
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

    // fetch this
    if let Some(parent) = &self.parent {
      match self.fn_self {
        Some(FnSelf::Ref) => {
          refs.push(make_ref(quote! { cb.this }));
          arg_conversions.push(quote! {
            let this_ptr = cb.unwrap_raw::<#parent>()?;
            let this: &#parent = Box::leak(Box::from_raw(this_ptr));
          });
        }
        Some(FnSelf::MutRef) => {
          refs.push(make_ref(quote! { cb.this }));
          arg_conversions.push(quote! {
            let this_ptr = cb.unwrap_raw::<#parent>()?;
            let this: &mut #parent = Box::leak(Box::from_raw(this_ptr));
          });
        }
        _ => {}
      };
    }

    let mut skipped_arg_count = 0;
    for (i, arg) in self.args.iter().enumerate() {
      let i = i - skipped_arg_count;
      let ident = Ident::new(&format!("arg{i}"), Span::call_site());

      match &arg.kind {
        NapiFnArgKind::PatType(path) => {
          if &path.ty.to_token_stream().to_string() == "Env" {
            args.push(quote! { __wrapped_env });
            skipped_arg_count += 1;
          } else {
            let is_in_class = self.parent.is_some();
            // get `f64` in `foo: f64`
            if let syn::Type::Path(path) = path.ty.as_ref() {
              // get `Reference` in `napi::bindgen_prelude::Reference`
              if let Some(p) = path.path.segments.last() {
                if p.ident == "Reference" {
                  if !is_in_class {
                    bail_span!(p, "`Reference` is only allowed in class methods");
                  }
                  // get `FooStruct` in `Reference<FooStruct>`
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
                          args.push(quote! {
                            napi::bindgen_prelude::Reference::from_value_ptr(this_ptr.cast(), env)?
                          });
                          skipped_arg_count += 1;
                          continue;
                        }
                      }
                    }
                  }
                } else if p.ident == "This" {
                  // get `FooStruct` in `This<FooStruct>`
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
                                <#ident as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb.this)?.into()
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
                              quote! { <#ident as napi::bindgen_prelude::FromNapiMutRef>::from_napi_mut_ref(env, cb.this)?.into() }
                            } else {
                              quote! { <#ident as napi::bindgen_prelude::FromNapiRef>::from_napi_ref(env, cb.this)?.into() }
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
                  args.push(quote! { <napi::bindgen_prelude::This as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb.this)? });
                  skipped_arg_count += 1;
                  continue;
                }
              }
            }
            let (arg_conversion, arg_type) = self.gen_ty_arg_conversion(&ident, i, path)?;
            if NapiArgType::MutRef == arg_type {
              mut_ref_spans.push(path.ty.span());
            }
            if arg_type.is_ref() {
              refs.push(make_ref(quote! { cb.get_arg(#i) }));
            }
            if arg_type == NapiArgType::Env {
              args.push(quote! { &__wrapped_env });
              skipped_arg_count += 1;
              continue;
            }
            arg_conversions.push(arg_conversion);
            args.push(quote! { #ident });
          }
        }
        NapiFnArgKind::Callback(cb) => {
          arg_conversions.push(self.gen_cb_arg_conversion(&ident, i, cb)?);
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
  ) -> BindgenResult<(TokenStream, NapiArgType)> {
    let mut ty = *path.ty.clone();
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

    let arg_conversion = if self.module_exports {
      quote! { _napi_module_exports_ }
    } else {
      quote! { cb.get_arg(#index) }
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
        Ok((q, NapiArgType::MutRef))
      }
      syn::Type::Reference(syn::TypeReference {
        mutability, elem, ..
      }) => {
        if let syn::Type::Slice(slice) = &*elem {
          if let syn::Type::Path(ele) = &*slice.elem {
            if let Some(syn::PathSegment { ident, .. }) = ele.path.segments.first() {
              if TYPEDARRAY_SLICE_TYPES.contains_key(&&*ident.to_string()) {
                let q = quote! {
                  let #arg_name = {
                    #type_check
                    <&mut #elem as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb.get_arg(#index))?
                  };
                };
                return Ok((q, NapiArgType::Ref));
              }
            }
          }
        }
        let q = if mutability.is_some() {
          quote! {
            let #arg_name = {
              #type_check
              <#elem as napi::bindgen_prelude::FromNapiMutRef>::from_napi_mut_ref(env, cb.get_arg(#index))?
            }
          }
        } else {
          if let syn::Type::Path(ele) = &*elem {
            if let Some(syn::PathSegment { ident, .. }) = ele.path.segments.last() {
              if ident == "Env" {
                return Ok((quote! {}, NapiArgType::Env));
              } else if ident == "str" {
                bail_span!(
                  elem,
                  "JavaScript String is primitive and cannot be passed by reference"
                );
              }
            }
          }
          quote! {
            let #arg_name = {
              #type_check
              <#elem as napi::bindgen_prelude::FromNapiRef>::from_napi_ref(env, cb.get_arg(#index))?
            };
          }
        };
        Ok((
          q,
          if mutability.is_some() {
            NapiArgType::MutRef
          } else {
            NapiArgType::Ref
          },
        ))
      }
      _ => {
        hidden_ty_lifetime(&mut ty)?;
        let mut arg_type = NapiArgType::Value;
        let mut is_array = false;
        if let syn::Type::Path(path) = &ty {
          // Detect cases where the type is `Vec<&S>`.
          // For example, in `async fn foo(v: Vec<&S>) {}`, we need to handle `v` as a reference.
          if let Some(syn::PathSegment { ident, arguments }) = path.path.segments.first() {
            // Check if the type is a `Vec`.
            if ident == "Vec" {
              is_array = true;
              if let syn::PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments {
                args: angle_bracketed_args,
                ..
              }) = &arguments
              {
                // Check if the generic argument of `Vec` is a reference type (e.g., `&S`).
                if let Some(syn::GenericArgument::Type(syn::Type::Reference(
                  syn::TypeReference { .. },
                ))) = angle_bracketed_args.first()
                {
                  // If the type is `Vec<&S>`, set the argument type to `Ref`.
                  arg_type = NapiArgType::Ref;
                }
              }
            }
          }
        }
        // Array::validate only validates by the `Array.isArray`
        // For the elements of the Array, we need to return rather than throw if they are invalid when `return_if_invalid` is true
        let from_napi_value = if is_array && self.return_if_invalid {
          quote! {
            match <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, #arg_conversion) {
              Ok(value) => value,
              Err(err) => {
                // InvalidArg, ObjectExpected, StringExpected ...
                if err.status < napi::bindgen_prelude::Status::GenericFailure {
                  return Ok(std::ptr::null_mut());
                } else {
                  return Err(err);
                }
              }
            }
          }
        } else {
          quote! {
            <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, #arg_conversion)?
          }
        };
        let q = quote! {
          let #arg_name = {
            #type_check
            #from_napi_value
          };
        };
        Ok((q, arg_type))
      }
    }
  }

  fn gen_cb_arg_conversion(
    &self,
    arg_name: &Ident,
    index: usize,
    cb: &CallbackArg,
  ) -> BindgenResult<TokenStream> {
    let mut inputs = vec![];
    let mut arg_conversions = vec![];

    for (i, ty) in cb.args.iter().enumerate() {
      let cb_arg_ident = Ident::new(&format!("callback_arg_{i}"), Span::call_site());
      inputs.push(quote! { #cb_arg_ident: #ty });
      let mut maybe_has_lifetime_ty = ty.clone();
      hidden_ty_lifetime(&mut maybe_has_lifetime_ty)?;
      arg_conversions.push(
        quote! { <#maybe_has_lifetime_ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, #cb_arg_ident)? },
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

    Ok(quote! {
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
    })
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

  fn gen_fn_return(&self, ret: &Ident) -> BindgenResult<TokenStream> {
    let js_name = &self.js_name;

    if let Some(ty) = &self.ret {
      let ty_string = ty.into_token_stream().to_string();
      let is_return_self = ty_string == "& Self" || ty_string == "&mut Self";
      if self.kind == FnKind::Constructor {
        let parent = self
          .parent
          .as_ref()
          .expect("Parent must exist for constructor");
        if self.is_ret_result {
          if self.parent_is_generator {
            Ok(quote! { cb.construct_generator::<false, _>(#js_name, #ret?) })
          } else {
            Ok(quote! {
              match #ret {
                Ok(value) => {
                  cb.construct::<false, _>(#js_name, value)
                }
                Err(err) => {
                  napi::bindgen_prelude::JsError::from(err).throw_into(env);
                  Ok(std::ptr::null_mut())
                }
              }
            })
          }
        } else if self.parent_is_generator {
          Ok(quote! { cb.construct_generator::<false, #parent>(#js_name, #ret) })
        } else {
          Ok(quote! { cb.construct::<false, #parent>(#js_name, #ret) })
        }
      } else if self.kind == FnKind::Factory {
        if self.is_ret_result {
          if self.parent_is_generator {
            Ok(quote! { cb.generator_factory(#js_name, #ret?) })
          } else if self.is_async {
            Ok(quote! { cb.factory(#js_name, #ret) })
          } else {
            Ok(quote! {
              match #ret {
                Ok(value) => {
                  cb.factory(#js_name, value)
                }
                Err(err) => {
                  napi::bindgen_prelude::JsError::from(err).throw_into(env);
                  Ok(std::ptr::null_mut())
                }
              }
            })
          }
        } else if self.parent_is_generator {
          Ok(quote! { cb.generator_factory(#js_name, #ret) })
        } else {
          Ok(quote! { cb.factory(#js_name, #ret) })
        }
      } else if self.is_ret_result {
        if self.is_async {
          Ok(quote! {
            <#ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, #ret)
          })
        } else if is_return_self {
          Ok(quote! { #ret.map(|_| cb.this) })
        } else {
          Ok(quote! {
            match #ret {
              Ok(value) => napi::bindgen_prelude::ToNapiValue::to_napi_value(env, value),
              Err(err) => {
                napi::bindgen_prelude::JsError::from(err).throw_into(env);
                Ok(std::ptr::null_mut())
              },
            }
          })
        }
      } else if is_return_self {
        Ok(quote! { Ok(cb.this) })
      } else {
        let mut return_ty = ty.clone();
        hidden_ty_lifetime(&mut return_ty)?;
        Ok(quote! {
          <#return_ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, #ret)
        })
      }
    } else {
      Ok(quote! {
        <() as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, ())
      })
    }
  }

  fn gen_fn_register(&self) -> TokenStream {
    if self.parent.is_some() || cfg!(test) {
      quote! {}
    } else {
      let name_str = self.name.to_string();
      let js_name = format!("{}\0", &self.js_name);
      let name_len = self.js_name.len();
      let module_register_name = &self.register_name;
      let intermediate_ident = get_intermediate_ident(&name_str);
      let js_mod_ident = js_mod_to_token_stream(self.js_mod.as_ref());
      let cb_name = Ident::new(
        &format!("_napi_rs_internal_register_{name_str}"),
        Span::call_site(),
      );

      if self.module_exports {
        return quote! {
          #[doc(hidden)]
          #[allow(non_snake_case)]
          #[allow(clippy::all)]
          unsafe fn #cb_name(env: napi::bindgen_prelude::sys::napi_env, exports: napi::bindgen_prelude::sys::napi_value) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
            #intermediate_ident(env, exports)?;
            Ok(exports)
          }

          #[doc(hidden)]
          #[allow(clippy::all)]
          #[allow(non_snake_case)]
          #[cfg(all(not(test), not(target_family = "wasm")))]
          #[napi::ctor::ctor(crate_path=::napi::ctor)]
          fn #module_register_name() {
            napi::bindgen_prelude::register_module_export_hook(#cb_name);
          }

          #[allow(clippy::all)]
          #[allow(non_snake_case)]
          #[cfg(all(not(test), target_family = "wasm"))]
          #[no_mangle]
          extern "C" fn #module_register_name() {
            napi::bindgen_prelude::register_module_export_hook(#cb_name);
          }
        };
      }

      let register_module_export_tokens = if self.no_export {
        quote! {}
      } else {
        quote! {
          #[doc(hidden)]
          #[allow(clippy::all)]
          #[allow(non_snake_case)]
          #[cfg(all(not(test), not(target_family = "wasm")))]
          #[napi::ctor::ctor(crate_path=::napi::ctor)]
          fn #module_register_name() {
            napi::bindgen_prelude::register_module_export(#js_mod_ident, #js_name, #cb_name);
          }

          #[doc(hidden)]
          #[allow(clippy::all)]
          #[allow(non_snake_case)]
          #[cfg(all(not(test), target_family = "wasm"))]
          #[no_mangle]
          extern "C" fn #module_register_name() {
            napi::bindgen_prelude::register_module_export(#js_mod_ident, #js_name, #cb_name);
          }
        }
      };

      quote! {
        #[doc(hidden)]
        #[allow(non_snake_case)]
        #[allow(clippy::all)]
        unsafe fn #cb_name(env: napi::bindgen_prelude::sys::napi_env) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
          let mut fn_ptr = std::ptr::null_mut();

          napi::bindgen_prelude::check_status!(
            napi::bindgen_prelude::sys::napi_create_function(
              env,
              #js_name.as_ptr().cast(),
              #name_len as isize,
              Some(#intermediate_ident),
              std::ptr::null_mut(),
              &mut fn_ptr,
            ),
            "Failed to register function `{}`",
            #name_str,
          )?;
          Ok(fn_ptr)
        }

        #register_module_export_tokens
      }
    }
  }
}

fn hidden_ty_lifetime(ty: &mut syn::Type) -> BindgenResult<()> {
  if let Type::Path(TypePath {
    path: syn::Path { segments, .. },
    ..
  }) = ty
  {
    if let Some(syn::PathSegment {
      arguments:
        syn::PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments { args, .. }),
      ..
    }) = segments.last_mut()
    {
      let mut has_lifetime = false;
      if let Some(syn::GenericArgument::Lifetime(lt)) = args.first_mut() {
        *lt = syn::Lifetime::new("'_", Span::call_site());
        has_lifetime = true;
      }
      for arg in args.iter_mut().skip(if has_lifetime { 1 } else { 0 }) {
        if let syn::GenericArgument::Type(ty) = arg {
          hidden_ty_lifetime(ty)?;
        }
      }
    }
  }
  Ok(())
}

fn make_ref(input: TokenStream) -> TokenStream {
  quote! {
    _args_array[_arg_write_index] = _make_ref(
      ::std::ptr::NonNull::new(#input)
        .ok_or_else(|| napi::Error::new(napi::Status::InvalidArg, "referenced ptr is null".to_owned()))?
    )?;
    _arg_write_index += 1;
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
  Env,
}

impl NapiArgType {
  fn is_ref(&self) -> bool {
    matches!(self, NapiArgType::Ref | NapiArgType::MutRef)
  }
}
