use std::collections::HashMap;

use proc_macro2::{Ident, Literal, Span, TokenStream};
use quote::ToTokens;

use crate::{
  codegen::{get_intermediate_ident, get_register_ident},
  BindgenResult, FnKind, NapiImpl, NapiStruct, NapiStructKind, TryToTokens,
};

// Generate trait implementations for given Struct.
fn gen_napi_value_map_impl(name: &Ident, to_napi_val_impl: TokenStream) -> TokenStream {
  let name_str = name.to_string();
  quote! {
    impl TypeName for #name {
      fn type_name() -> &'static str {
        #name_str
      }

      fn value_type() -> napi::ValueType {
        napi::ValueType::Function
      }
    }

    #to_napi_val_impl

    impl FromNapiRef for #name {
      unsafe fn from_napi_ref(env: sys::napi_env, napi_val: sys::napi_value) -> Result<&'static Self> {
        let mut wrapped_val: *mut std::ffi::c_void = std::ptr::null_mut();

        check_status!(
          sys::napi_unwrap(env, napi_val, &mut wrapped_val),
          "Failed to recover `{}` type from napi value",
          #name_str,
        )?;

        Ok(&*(wrapped_val as *const #name))
      }
    }

    impl FromNapiMutRef for #name {
      unsafe fn from_napi_mut_ref(env: sys::napi_env, napi_val: sys::napi_value) -> Result<&'static mut Self> {
        let mut wrapped_val: *mut std::ffi::c_void = std::ptr::null_mut();

        check_status!(
          sys::napi_unwrap(env, napi_val, &mut wrapped_val),
          "Failed to recover `{}` type from napi value",
          #name_str,
        )?;

        Ok(&mut *(wrapped_val as *mut #name))
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
    if crate::typegen::r#struct::TASK_STRUCTS.with(|t| {
      println!("{:?}", t);
      t.borrow().get(&self.name.to_string()).is_some()
    }) {
      return quote! {};
    }

    let mod_name = Ident::new(
      &format!("__napi_helper__{}", self.name.to_string()),
      Span::call_site(),
    );

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
          .push(quote! { #ident: <#ty as FromNapiValue>::from_napi_value(env, cb.get_arg(#i))? }),
        syn::Member::Unnamed(_) => {
          fields.push(quote! { <#ty as FromNapiValue>::from_napi_value(env, cb.get_arg(#i))? });
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
        env: sys::napi_env,
        cb: sys::napi_callback_info
      ) -> sys::napi_value {
        CallbackInfo::<#fields_len>::new(env, cb, None)
          .and_then(|cb| unsafe { cb.construct(#js_name_str, #construct) })
          .unwrap_or_else(|e| {
            unsafe { JsError::from(e).throw_into(env) };
            std::ptr::null_mut::<sys::napi_value__>()
          })
      }
    }
  }

  fn gen_napi_value_map_impl(&self) -> TokenStream {
    match self.kind {
      NapiStructKind::None => gen_napi_value_map_impl(&self.name, quote! {}),
      NapiStructKind::Constructor => {
        gen_napi_value_map_impl(&self.name, self.gen_to_napi_value_ctor_impl())
      }
      NapiStructKind::Object => self.gen_to_napi_value_obj_impl(),
    }
  }

  fn gen_to_napi_value_ctor_impl(&self) -> TokenStream {
    let name = &self.name;
    let js_name_str = &self.js_name;

    let mut field_conversions = vec![];
    let mut field_destructions = vec![];

    for field in self.fields.iter() {
      let ty = &field.ty;

      match &field.name {
        syn::Member::Named(ident) => {
          field_destructions.push(quote! { #ident });
          field_conversions.push(quote! { <#ty as ToNapiValue>::to_napi_value(env, #ident)? });
        }
        syn::Member::Unnamed(i) => {
          field_destructions.push(quote! { arg#i });
          field_conversions.push(quote! { <#ty as ToNapiValue>::to_napi_value(env, arg#i)? });
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
      impl ToNapiValue for #name {
        unsafe fn to_napi_value(env: sys::napi_env, val: #name) -> Result<sys::napi_value> {
          if let Some(ctor_ref) = get_class_constructor(#js_name_str) {
            let mut ctor = std::ptr::null_mut();

            check_status!(
              sys::napi_get_reference_value(env, ctor_ref, &mut ctor),
              "Failed to get constructor of class `{}`",
              #js_name_str
            )?;

            let mut result = std::ptr::null_mut();
            let #destructed_fields = val;
            let args = vec![#(#field_conversions),*];

            check_status!(
              sys::napi_new_instance(env, ctor, args.len(), args.as_ptr(), &mut result),
              "Failed to construct class `{}`",
              #js_name_str
            )?;

            Ok(result)
          } else {
            Err(Error::new(Status::InvalidArg, format!("Failed to get constructor of class `{}`", #js_name_str)))
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

      match &field.name {
        syn::Member::Named(ident) => {
          field_destructions.push(quote! { #ident });
          obj_field_setters.push(quote! { obj.set(#field_js_name, #ident)?; });
          obj_field_getters.push(quote! { let #ident: #ty = obj.get(#field_js_name)?.expect(&format!("Field {} should exist", #field_js_name)); });
        }
        syn::Member::Unnamed(i) => {
          field_destructions.push(quote! { arg#i });
          obj_field_setters.push(quote! { obj.set(#field_js_name, arg#1)?; });
          obj_field_getters.push(quote! { let arg#i: #ty = obj.get(#field_js_name)?.expect(&format!("Field {} should exist", #field_js_name)); });
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
      impl TypeName for #name {
        fn type_name() -> &'static str {
          #name_str
        }

        fn value_type() -> napi::ValueType {
          napi::ValueType::Object
        }
      }

      impl ToNapiValue for #name {
        unsafe fn to_napi_value(env: sys::napi_env, val: #name) -> Result<sys::napi_value> {
          let env_wrapper = Env::from(env);
          let mut obj = env_wrapper.create_object()?;

          let #destructed_fields = val;
          #(#obj_field_setters)*

          Object::to_napi_value(env, obj)
        }
      }

      impl FromNapiValue for #name {
        unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
          let env_wrapper = Env::from(env);
          let mut obj = Object::from_napi_value(env, napi_val)?;

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
              env: sys::napi_env,
              cb: sys::napi_callback_info
            ) -> sys::napi_value {
              CallbackInfo::<0>::new(env, cb, Some(0))
                .and_then(|mut cb| unsafe { cb.unwrap_borrow::<#struct_name>() })
                .and_then(|obj| {
                  let val = obj.#field_ident.to_owned();
                  unsafe { <#ty as ToNapiValue>::to_napi_value(env, val) }
                })
                .unwrap_or_else(|e| {
                  unsafe { JsError::from(e).throw_into(env) };
                  std::ptr::null_mut::<sys::napi_value__>()
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
              env: sys::napi_env,
              cb: sys::napi_callback_info
            ) -> sys::napi_value {
              CallbackInfo::<1>::new(env, cb, Some(1))
                .and_then(|mut cb_info| unsafe {
                  cb_info.unwrap_borrow_mut::<#struct_name>()
                    .and_then(|obj| {
                      <#ty as FromNapiValue>::from_napi_value(env, cb_info.get_arg(0))
                        .and_then(move |val| {
                          obj.#field_ident = val;
                          <() as ToNapiValue>::to_napi_value(env, ())
                        })
                    })
                })
                .unwrap_or_else(|e| {
                  unsafe { JsError::from(e).throw_into(env) };
                  std::ptr::null_mut::<sys::napi_value__>()
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
    let js_name = &self.js_name;
    let mut props = vec![];

    if self.kind == NapiStructKind::Constructor {
      props.push(quote! { Property::new("constructor").unwrap().with_ctor(constructor) });
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
        Property::new(#js_name)
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

    quote! {
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      #[ctor]
      fn #struct_register_name() {
        register_class(#name_str, #js_name, vec![#(#props),*]);
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
    let js_name = &self.js_name;
    let mod_name = Ident::new(
      &format!("__napi_impl_helper__{}", name_str),
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
          Property::new(#js_name).unwrap()
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
            quote! { .with_method(#intermediate_name).with_property_attributes(PropertyAttributes::Static) }
          }
        }
      };

      appendix.to_tokens(prop);
    }

    let mut props: Vec<_> = props.into_iter().collect();
    props.sort_by_key(|(_, prop)| prop.to_string());
    let props = props.into_iter().map(|(_, prop)| prop);

    Ok(quote! {
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      mod #mod_name {
        use super::*;
        #(#methods)*

        #[ctor]
        fn #register_name() {
          register_class(#name_str, #js_name, vec![#(#props),*]);
        }
      }
    })
  }
}
