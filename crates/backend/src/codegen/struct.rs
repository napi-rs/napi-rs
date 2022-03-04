use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};

use proc_macro2::{Ident, Literal, Span, TokenStream};
use quote::ToTokens;

use crate::{
  codegen::{get_intermediate_ident, get_register_ident, js_mod_to_token_stream},
  BindgenResult, FnKind, NapiImpl, NapiStruct, NapiStructKind, TryToTokens,
};

static NAPI_IMPL_ID: AtomicU32 = AtomicU32::new(0);

// Generate trait implementations for given Struct.
fn gen_napi_value_map_impl(name: &Ident, to_napi_val_impl: TokenStream) -> TokenStream {
  let name_str = name.to_string();
  quote! {
    impl napi::bindgen_prelude::TypeName for #name {
      fn type_name() -> &'static str {
        #name_str
      }

      fn value_type() -> napi::ValueType {
        napi::ValueType::Function
      }
    }

    impl napi::bindgen_prelude::TypeName for &#name {
      fn type_name() -> &'static str {
        #name_str
      }

      fn value_type() -> napi::ValueType {
        napi::ValueType::Object
      }
    }

    impl napi::bindgen_prelude::TypeName for &mut #name {
      fn type_name() -> &'static str {
        #name_str
      }

      fn value_type() -> napi::ValueType {
        napi::ValueType::Object
      }
    }

    #to_napi_val_impl

    impl napi::bindgen_prelude::FromNapiRef for #name {
      unsafe fn from_napi_ref(
        env: napi::bindgen_prelude::sys::napi_env,
        napi_val: napi::bindgen_prelude::sys::napi_value
      ) -> napi::bindgen_prelude::Result<&'static Self> {
        let mut wrapped_val: *mut std::ffi::c_void = std::ptr::null_mut();

        napi::bindgen_prelude::check_status!(
          napi::bindgen_prelude::sys::napi_unwrap(env, napi_val, &mut wrapped_val),
          "Failed to recover `{}` type from napi value",
          #name_str,
        )?;

        Ok(&*(wrapped_val as *const #name))
      }
    }

    impl napi::bindgen_prelude::FromNapiMutRef for #name {
      unsafe fn from_napi_mut_ref(
        env: napi::bindgen_prelude::sys::napi_env,
        napi_val: napi::bindgen_prelude::sys::napi_value
      ) -> napi::bindgen_prelude::Result<&'static mut Self> {
        let mut wrapped_val: *mut std::ffi::c_void = std::ptr::null_mut();

        napi::bindgen_prelude::check_status!(
          napi::bindgen_prelude::sys::napi_unwrap(env, napi_val, &mut wrapped_val),
          "Failed to recover `{}` type from napi value",
          #name_str,
        )?;

        Ok(&mut *(wrapped_val as *mut #name))
      }
    }

    impl napi::bindgen_prelude::FromNapiValue for &#name {
      unsafe fn from_napi_value(
        env: napi::bindgen_prelude::sys::napi_env,
        napi_val: napi::bindgen_prelude::sys::napi_value
      ) -> napi::bindgen_prelude::Result<Self> {
        napi::bindgen_prelude::FromNapiRef::from_napi_ref(env, napi_val)
      }
    }

    impl napi::bindgen_prelude::FromNapiValue for &mut #name {
      unsafe fn from_napi_value(
        env: napi::bindgen_prelude::sys::napi_env,
        napi_val: napi::bindgen_prelude::sys::napi_value
      ) -> napi::bindgen_prelude::Result<Self> {
        napi::bindgen_prelude::FromNapiMutRef::from_napi_mut_ref(env, napi_val)
      }
    }

    impl napi::NapiRaw for &#name {
      unsafe fn raw(&self) -> napi::sys::napi_value {
        unreachable!()
      }
    }

    impl napi::NapiRaw for &mut #name {
      unsafe fn raw(&self) -> napi::sys::napi_value {
        unreachable!()
      }
    }
  }
}

impl TryToTokens for NapiStruct {
  fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()> {
    let napi_value_map_impl = self.gen_napi_value_map_impl();

    let class_helper_mod = if self.kind == NapiStructKind::Object {
      quote! {}
    } else {
      self.gen_helper_mod()
    };

    (quote! {
      #napi_value_map_impl
      #class_helper_mod
    })
    .to_tokens(tokens);

    Ok(())
  }
}

impl NapiStruct {
  fn gen_helper_mod(&self) -> TokenStream {
    let mod_name = Ident::new(&format!("__napi_helper__{}", self.name), Span::call_site());

    let ctor = if self.kind == NapiStructKind::Constructor {
      self.gen_default_ctor()
    } else {
      quote! {}
    };

    let mut getters_setters = self.gen_default_getters_setters();
    getters_setters.sort_by(|a, b| a.0.cmp(&b.0));
    let register = self.gen_register();

    let getters_setters_token = getters_setters.into_iter().map(|(_, token)| token);

    quote! {
      #[allow(clippy::all)]
      #[allow(non_snake_case)]
      mod #mod_name {
        use std::ptr;
        use super::*;

        #ctor
        #(#getters_setters_token)*
        #register
      }
    }
  }

  fn gen_default_ctor(&self) -> TokenStream {
    let name = &self.name;
    let js_name_str = &self.js_name;
    let fields_len = self.fields.len();
    let mut fields = vec![];

    for (i, field) in self.fields.iter().enumerate() {
      let ty = &field.ty;
      match &field.name {
        syn::Member::Named(ident) => fields
          .push(quote! { #ident: <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb.get_arg(#i))? }),
        syn::Member::Unnamed(_) => {
          fields.push(quote! { <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb.get_arg(#i))? });
        }
      }
    }

    let construct = if self.is_tuple {
      quote! { #name (#(#fields),*) }
    } else {
      quote! { #name {#(#fields),*} }
    };

    quote! {
      extern "C" fn constructor(
        env: napi::bindgen_prelude::sys::napi_env,
        cb: napi::bindgen_prelude::sys::napi_callback_info
      ) -> napi::bindgen_prelude::sys::napi_value {
        napi::bindgen_prelude::CallbackInfo::<#fields_len>::new(env, cb, None)
          .and_then(|cb| unsafe { cb.construct(#js_name_str, #construct) })
          .unwrap_or_else(|e| {
            unsafe { napi::bindgen_prelude::JsError::from(e).throw_into(env) };
            std::ptr::null_mut::<napi::bindgen_prelude::sys::napi_value__>()
          })
      }
    }
  }

  fn gen_napi_value_map_impl(&self) -> TokenStream {
    match self.kind {
      NapiStructKind::None => gen_napi_value_map_impl(
        &self.name,
        self.gen_to_napi_value_ctor_impl_for_non_default_constructor_struct(),
      ),
      NapiStructKind::Constructor => {
        gen_napi_value_map_impl(&self.name, self.gen_to_napi_value_ctor_impl())
      }
      NapiStructKind::Object => self.gen_to_napi_value_obj_impl(),
    }
  }

  fn gen_to_napi_value_ctor_impl_for_non_default_constructor_struct(&self) -> TokenStream {
    let name = &self.name;
    let js_name_str = format!("{}\0", &self.js_name);
    quote! {
      impl napi::bindgen_prelude::ToNapiValue for #name {
        unsafe fn to_napi_value(
          env: napi::sys::napi_env, val: #name
        ) -> napi::Result<napi::bindgen_prelude::sys::napi_value> {
          if let Some(ctor_ref) = napi::bindgen_prelude::get_class_constructor(#js_name_str) {
            let mut ctor = std::ptr::null_mut();

            napi::check_status!(
              napi::sys::napi_get_reference_value(env, ctor_ref, &mut ctor),
              "Failed to get constructor of class `{}`",
              #js_name_str
            )?;

            let mut result = std::ptr::null_mut();
            napi::bindgen_prelude::___CALL_FROM_FACTORY.with(|inner| inner.store(true, std::sync::atomic::Ordering::Relaxed));
            napi::check_status!(
              napi::sys::napi_new_instance(env, ctor, 0, std::ptr::null_mut(), &mut result),
              "Failed to construct class `{}`",
              #js_name_str
            )?;
            napi::check_status!(
              napi::sys::napi_wrap(
                env,
                result,
                Box::into_raw(Box::new(val)) as *mut std::ffi::c_void,
                Some(napi::bindgen_prelude::raw_finalize_unchecked::<#name>),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
              ),
              "Failed to wrap native object of class `{}`",
              #js_name_str
            )?;
            napi::bindgen_prelude::___CALL_FROM_FACTORY.with(|inner| inner.store(false, std::sync::atomic::Ordering::Relaxed));
            Ok(result)
          } else {
            Err(napi::bindgen_prelude::Error::new(
              napi::bindgen_prelude::Status::InvalidArg, format!("Failed to get constructor of class `{}`", #js_name_str))
            )
          }
        }
      }
    }
  }

  fn gen_to_napi_value_ctor_impl(&self) -> TokenStream {
    let name = &self.name;
    let js_name_str = format!("{}\0", &self.js_name);

    let mut field_conversions = vec![];
    let mut field_destructions = vec![];

    for field in self.fields.iter() {
      let ty = &field.ty;

      match &field.name {
        syn::Member::Named(ident) => {
          field_destructions.push(quote! { #ident });
          field_conversions.push(
            quote! { <#ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, #ident)? },
          );
        }
        syn::Member::Unnamed(i) => {
          field_destructions.push(quote! { arg #i });
          field_conversions.push(
            quote! { <#ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, arg #i)? },
          );
        }
      }
    }

    let destructed_fields = if self.is_tuple {
      quote! {
        Self (#(#field_destructions),*)
      }
    } else {
      quote! {
        Self {#(#field_destructions),*}
      }
    };

    quote! {
      impl napi::bindgen_prelude::ToNapiValue for #name {
        unsafe fn to_napi_value(
          env: napi::bindgen_prelude::sys::napi_env, val: #name
        ) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
          if let Some(ctor_ref) = napi::bindgen_prelude::get_class_constructor(#js_name_str) {
            let mut ctor = std::ptr::null_mut();

            napi::bindgen_prelude::check_status!(
              napi::bindgen_prelude::sys::napi_get_reference_value(env, ctor_ref, &mut ctor),
              "Failed to get constructor of class `{}`",
              #js_name_str
            )?;

            let mut result = std::ptr::null_mut();
            let #destructed_fields = val;
            let args = vec![#(#field_conversions),*];

            napi::bindgen_prelude::check_status!(
              napi::bindgen_prelude::sys::napi_new_instance(env, ctor, args.len(), args.as_ptr(), &mut result),
              "Failed to construct class `{}`",
              #js_name_str
            )?;

            Ok(result)
          } else {
            Err(napi::bindgen_prelude::Error::new(
              napi::bindgen_prelude::Status::InvalidArg, format!("Failed to get constructor of class `{}`", #js_name_str))
            )
          }
        }
      }
    }
  }

  fn gen_to_napi_value_obj_impl(&self) -> TokenStream {
    let name = &self.name;
    let name_str = self.name.to_string();

    let mut obj_field_setters = vec![];
    let mut obj_field_getters = vec![];
    let mut field_destructions = vec![];

    for field in self.fields.iter() {
      let field_js_name = &field.js_name;
      let ty = &field.ty;
      let is_optional_field = if let syn::Type::Path(syn::TypePath {
        path: syn::Path { segments, .. },
        ..
      }) = &ty
      {
        if let Some(last_path) = segments.last() {
          last_path.ident == "Option"
        } else {
          false
        }
      } else {
        false
      };
      match &field.name {
        syn::Member::Named(ident) => {
          field_destructions.push(quote! { #ident });
          if is_optional_field {
            obj_field_setters.push(quote! {
              if #ident.is_some() {
                obj.set(#field_js_name, #ident)?;
              }
            });
          } else {
            obj_field_setters.push(quote! { obj.set(#field_js_name, #ident)?; });
          }
          if is_optional_field {
            obj_field_getters.push(quote! { let #ident: #ty = obj.get(#field_js_name)?; });
          } else {
            obj_field_getters.push(quote! {
              let #ident: #ty = obj.get(#field_js_name)?.ok_or_else(|| napi::bindgen_prelude::Error::new(
                napi::bindgen_prelude::Status::InvalidArg,
                format!("Missing field `{}`", #field_js_name),
              ))?;
            });
          }
        }
        syn::Member::Unnamed(i) => {
          field_destructions.push(quote! { arg #i });
          if is_optional_field {
            obj_field_setters.push(quote! {
              if arg #1.is_some() {
                obj.set(#field_js_name, arg #i)?;
              }
            });
          } else {
            obj_field_setters.push(quote! { obj.set(#field_js_name, arg #1)?; });
          }
          if is_optional_field {
            obj_field_getters.push(quote! { let arg #i: #ty = obj.get(#field_js_name)?; });
          } else {
            obj_field_getters.push(quote! {
              let arg #i: #ty = obj.get(#field_js_name)?.ok_or_else(|| napi::bindgen_prelude::Error::new(
                napi::bindgen_prelude::Status::InvalidArg,
                format!("Missing field `{}`", #field_js_name),
              ))?;
            });
          }
        }
      }
    }

    let destructed_fields = if self.is_tuple {
      quote! {
        Self (#(#field_destructions),*)
      }
    } else {
      quote! {
        Self {#(#field_destructions),*}
      }
    };

    quote! {
      impl napi::bindgen_prelude::TypeName for #name {
        fn type_name() -> &'static str {
          #name_str
        }

        fn value_type() -> napi::ValueType {
          napi::ValueType::Object
        }
      }

      impl napi::bindgen_prelude::ToNapiValue for #name {
        unsafe fn to_napi_value(env: napi::bindgen_prelude::sys::napi_env, val: #name) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
          let env_wrapper = napi::bindgen_prelude::Env::from(env);
          let mut obj = env_wrapper.create_object()?;

          let #destructed_fields = val;
          #(#obj_field_setters)*

          napi::bindgen_prelude::Object::to_napi_value(env, obj)
        }
      }

      impl napi::bindgen_prelude::FromNapiValue for #name {
        unsafe fn from_napi_value(
          env: napi::bindgen_prelude::sys::napi_env,
          napi_val: napi::bindgen_prelude::sys::napi_value
        ) -> napi::bindgen_prelude::Result<Self> {
          let env_wrapper = napi::bindgen_prelude::Env::from(env);
          let mut obj = napi::bindgen_prelude::Object::from_napi_value(env, napi_val)?;

          #(#obj_field_getters)*

          let val = #destructed_fields;

          Ok(val)
        }
      }
    }
  }

  fn gen_default_getters_setters(&self) -> Vec<(String, TokenStream)> {
    let mut getters_setters = vec![];
    let struct_name = &self.name;

    for field in self.fields.iter() {
      let field_ident = &field.name;
      let field_name = match &field.name {
        syn::Member::Named(ident) => ident.to_string(),
        syn::Member::Unnamed(i) => format!("field{}", i.index),
      };
      let ty = &field.ty;

      let getter_name = Ident::new(&format!("get_{}", field_name), Span::call_site());
      let setter_name = Ident::new(&format!("set_{}", field_name), Span::call_site());

      if field.getter {
        getters_setters.push((
          field.js_name.clone(),
          quote! {
            extern "C" fn #getter_name(
              env: napi::bindgen_prelude::sys::napi_env,
              cb: napi::bindgen_prelude::sys::napi_callback_info
            ) -> napi::bindgen_prelude::sys::napi_value {
              napi::bindgen_prelude::CallbackInfo::<0>::new(env, cb, Some(0))
                .and_then(|mut cb| unsafe { cb.unwrap_borrow::<#struct_name>() })
                .and_then(|obj| {
                  let val = obj.#field_ident.to_owned();
                  unsafe { <#ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, val) }
                })
                .unwrap_or_else(|e| {
                  unsafe { napi::bindgen_prelude::JsError::from(e).throw_into(env) };
                  std::ptr::null_mut::<napi::bindgen_prelude::sys::napi_value__>()
                })
            }
          },
        ));
      }

      if field.setter {
        getters_setters.push((
          field.js_name.clone(),
          quote! {
            extern "C" fn #setter_name(
              env: napi::bindgen_prelude::sys::napi_env,
              cb: napi::bindgen_prelude::sys::napi_callback_info
            ) -> napi::bindgen_prelude::sys::napi_value {
              napi::bindgen_prelude::CallbackInfo::<1>::new(env, cb, Some(1))
                .and_then(|mut cb_info| unsafe {
                  cb_info.unwrap_borrow_mut::<#struct_name>()
                    .and_then(|obj| {
                      <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb_info.get_arg(0))
                        .and_then(move |val| {
                          obj.#field_ident = val;
                          <() as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, ())
                        })
                    })
                })
                .unwrap_or_else(|e| {
                  unsafe { napi::bindgen_prelude::JsError::from(e).throw_into(env) };
                  std::ptr::null_mut::<napi::bindgen_prelude::sys::napi_value__>()
                })
            }
          },
        ));
      }
    }

    getters_setters
  }

  fn gen_register(&self) -> TokenStream {
    let name_str = self.name.to_string();
    let struct_register_name = get_register_ident(&format!("{}_struct", name_str));
    let js_name = format!("{}\0", self.js_name);
    let mut props = vec![];

    if self.kind == NapiStructKind::Constructor {
      props.push(quote! { napi::bindgen_prelude::Property::new("constructor").unwrap().with_ctor(constructor) });
    }

    for field in self.fields.iter() {
      let field_name = match &field.name {
        syn::Member::Named(ident) => ident.to_string(),
        syn::Member::Unnamed(i) => format!("field{}", i.index),
      };

      if !field.getter {
        continue;
      }

      let js_name = &field.js_name;
      let mut prop = quote! {
        napi::bindgen_prelude::Property::new(#js_name)
          .unwrap()
      };

      if field.getter {
        let getter_name = Ident::new(&format!("get_{}", field_name), Span::call_site());
        (quote! { .with_getter(#getter_name) }).to_tokens(&mut prop);
      }

      if field.setter {
        let setter_name = Ident::new(&format!("set_{}", field_name), Span::call_site());
        (quote! { .with_setter(#setter_name) }).to_tokens(&mut prop);
      }

      props.push(prop);
    }
    let js_mod_ident = js_mod_to_token_stream(self.js_mod.as_ref());
    quote! {
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      #[cfg(all(not(test), not(feature = "noop")))]
      #[napi::bindgen_prelude::ctor]
      fn #struct_register_name() {
        napi::bindgen_prelude::register_class(#name_str, #js_mod_ident, #js_name, vec![#(#props),*]);
      }
    }
  }
}

impl TryToTokens for NapiImpl {
  fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()> {
    self.gen_helper_mod()?.to_tokens(tokens);

    Ok(())
  }
}

impl NapiImpl {
  fn gen_helper_mod(&self) -> BindgenResult<TokenStream> {
    let name_str = self.name.to_string();
    let js_name = format!("{}\0", self.js_name);
    let mod_name = Ident::new(
      &format!(
        "__napi_impl_helper__{}__{}",
        name_str,
        NAPI_IMPL_ID.fetch_add(1, Ordering::SeqCst)
      ),
      Span::call_site(),
    );

    let register_name = get_register_ident(&format!("{}_impl", name_str));

    let mut methods = vec![];
    let mut props = HashMap::new();

    for item in self.items.iter() {
      let js_name = Literal::string(&item.js_name);
      let item_str = item.name.to_string();
      let intermediate_name = get_intermediate_ident(&item_str);
      methods.push(item.try_to_token_stream()?);

      let prop = props.entry(&item.js_name).or_insert_with(|| {
        quote! {
          napi::bindgen_prelude::Property::new(#js_name).unwrap()
        }
      });

      let appendix = match item.kind {
        FnKind::Constructor => quote! { .with_ctor(#intermediate_name) },
        FnKind::Getter => quote! { .with_getter(#intermediate_name) },
        FnKind::Setter => quote! { .with_setter(#intermediate_name) },
        _ => {
          if item.fn_self.is_some() {
            quote! { .with_method(#intermediate_name) }
          } else {
            quote! { .with_method(#intermediate_name).with_property_attributes(napi::bindgen_prelude::PropertyAttributes::Static) }
          }
        }
      };

      appendix.to_tokens(prop);
    }

    let mut props: Vec<_> = props.into_iter().collect();
    props.sort_by_key(|(_, prop)| prop.to_string());
    let props = props.into_iter().map(|(_, prop)| prop);
    let js_mod_ident = js_mod_to_token_stream(self.js_mod.as_ref());
    Ok(quote! {
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      mod #mod_name {
        use super::*;
        #(#methods)*

        #[cfg(all(not(test), not(feature = "noop")))]
        #[napi::bindgen_prelude::ctor]
        fn #register_name() {
          napi::bindgen_prelude::register_class(#name_str, #js_mod_ident, #js_name, vec![#(#props),*]);
        }
      }
    })
  }
}
