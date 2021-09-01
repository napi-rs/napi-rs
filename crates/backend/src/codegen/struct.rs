use std::collections::HashMap;

use proc_macro2::{Ident, Literal, Span, TokenStream};
use quote::ToTokens;

use crate::{
  codegen::{get_intermediate_ident, get_register_ident},
  BindgenResult, FnKind, NapiImpl, NapiStruct, TryToTokens,
};

// Generate trait implementations for given Struct.
fn gen_napi_value_map_impl(name: &Ident, to_napi_val_impl: TokenStream) -> TokenStream {
  let name_str = name.to_string();
  quote! {
    impl TypeName for #name {
      fn type_name() -> &'static str {
        #name_str
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
    let class_helper_mod = self.gen_helper_mod();

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
    let name = &self.name;
    let mod_name = Ident::new(
      &format!("__napi_helper__{}", self.name.to_string()),
      Span::call_site(),
    );

    let ctor = if self.gen_default_ctor {
      self.gen_default_ctor()
    } else {
      quote! {}
    };

    let getters_setters = self.gen_default_getters_setters();
    let register = self.gen_register();

    quote! {
      #[allow(clippy::all)]
      #[allow(non_snake_case)]
      mod #mod_name {
        use std::ptr;
        use super::*;

        static mut CTOR_REF: sys::napi_ref = ptr::null_mut();

        impl JsClassRuntimeHelper for #name {
          fn napi_set_ctor(ctor: sys::napi_ref) {
            unsafe {
              CTOR_REF = ctor;
            }
          }
          fn napi_get_ctor() -> sys::napi_ref {
            unsafe { CTOR_REF }
          }
        }

        #ctor
        #(#getters_setters)*
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
        #[inline(always)]
        unsafe fn call(env: sys::napi_env, cb: sys::napi_callback_info) -> Result<sys::napi_value> {
          let mut cb = CallbackInfo::<#fields_len>::new(env, cb)?;
          cb.construct(#js_name_str, #construct)
        }

        unsafe {
          match call(env, cb) {
            Ok(v) => v,
            Err(e) => {
              unsafe { JsError::from(e).throw_into(env) };
              std::ptr::null_mut::<sys::napi_value__>()
            }
          }
        }
      }
    }
  }

  fn gen_napi_value_map_impl(&self) -> TokenStream {
    if !self.gen_default_ctor {
      return gen_napi_value_map_impl(&self.name, quote! {});
    }

    let name = &self.name;
    let js_name_str = &self.js_name;
    let field_len = self.fields.len();

    let mut fields_conversions = vec![];
    let mut field_destructions = vec![];

    for field in self.fields.iter() {
      let ty = &field.ty;

      match &field.name {
        syn::Member::Named(ident) => {
          field_destructions.push(quote! { #ident });
          fields_conversions.push(quote! { <#ty as ToNapiValue>::to_napi_value(env, #ident)? });
        }
        syn::Member::Unnamed(i) => {
          field_destructions.push(quote! { arg#i });
          fields_conversions.push(quote! { <#ty as ToNapiValue>::to_napi_value(env, arg#i)? });
        }
      }
    }

    let destructed_fields = if self.is_tuple {
      quote! {
        let Self (#(#field_destructions),*)
      }
    } else {
      quote! {
        let Self {#(#field_destructions),*}
      }
    };

    gen_napi_value_map_impl(
      name,
      quote! {
        impl ToNapiValue for #name {
          unsafe fn to_napi_value(env: sys::napi_env, val: #name) -> Result<sys::napi_value> {
            let mut result = std::ptr::null_mut();
            #destructed_fields = val;
            let args = vec![#(#fields_conversions),*];

            let mut ctor = std::ptr::null_mut();
            check_status!(
              sys::napi_get_reference_value(env, #name::napi_get_ctor(), &mut ctor),
              "Failed to get class constructor {}",
              #js_name_str
            )?;

            check_status!(
              sys::napi_new_instance(env, ctor, #field_len, args.as_ptr(), &mut result),
              "Failed to create new instance of class {}",
              #js_name_str
            )?;

            Ok(result)
          }
        }
      },
    )
  }

  fn gen_default_getters_setters(&self) -> Vec<TokenStream> {
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
        getters_setters.push(quote! {
          extern "C" fn #getter_name(
            env: sys::napi_env,
            cb: sys::napi_callback_info
          ) -> sys::napi_value {
            #[inline(always)]
            unsafe fn call(env: sys::napi_env, cb: sys::napi_callback_info) -> Result<sys::napi_value> {
              let mut cb = CallbackInfo::<0>::new(env, cb)?;
              let obj = cb.unwrap_borrow::<#struct_name>()?;
              // TODO: assert Clone/Copy
              let val = obj.#field_ident.to_owned();
              <#ty as ToNapiValue>::to_napi_value(env, val)
            }

            unsafe {
              match call(env, cb) {
                Ok(v) => v,
                Err(e) => {
                  JsError::from(e).throw_into(env);
                  std::ptr::null_mut::<sys::napi_value__>()
                }
              }
            }
          }
        });
      }

      if field.setter {
        getters_setters.push(quote! {
          extern "C" fn #setter_name(
            env: sys::napi_env,
            cb: sys::napi_callback_info
          ) -> sys::napi_value {
            #[inline(always)]
            unsafe fn call(env: sys::napi_env, cb: sys::napi_callback_info) -> Result<sys::napi_value> {
              let mut cb = CallbackInfo::<1>::new(env, cb)?;
              let obj = cb.unwrap_borrow_mut::<#struct_name>()?;
              obj.#field_ident = <#ty as FromNapiValue>::from_napi_value(env, cb.get_arg(0))?;
              Option::<bool>::to_napi_value(env, None)
            }

            unsafe {
              match call(env, cb) {
                Ok(v) => v,
                Err(e) => {
                  JsError::from(e).throw_into(env);
                  std::ptr::null_mut::<sys::napi_value__>()
                }
              }
            }
          }
        });
      }
    }

    getters_setters
  }

  fn gen_register(&self) -> TokenStream {
    let name_str = self.name.to_string();
    let struct_register_name = get_register_ident(&format!("{}_struct", name_str));
    let js_name = &self.js_name;
    let mut props = vec![];

    if self.gen_default_ctor {
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
    let rust_name_lit = Literal::string(&name_str);
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
        _ => quote! { .with_method(#intermediate_name) },
      };

      appendix.to_tokens(prop);
    }

    let props: Vec<_> = props.values().collect();

    Ok(quote! {
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      mod #mod_name {
        use super::*;
        #(#methods)*

        #[ctor]
        fn #register_name() {
          register_class(#rust_name_lit, "", vec![#(#props),*]);
        }
      }
    })
  }
}
