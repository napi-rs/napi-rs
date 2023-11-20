use proc_macro2::{Ident, Literal, Span, TokenStream};
use quote::ToTokens;

use crate::{
  codegen::{get_register_ident, js_mod_to_token_stream},
  BindgenResult, NapiEnum, TryToTokens,
};

impl TryToTokens for NapiEnum {
  fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()> {
    let register = self.gen_module_register();
    let napi_value_conversion = self.gen_napi_value_map_impl();

    (quote! {
      #napi_value_conversion
      #register
    })
    .to_tokens(tokens);

    Ok(())
  }
}

impl NapiEnum {
  fn gen_napi_value_map_impl(&self) -> TokenStream {
    let name = &self.name;
    let name_str = self.name.to_string();
    let mut from_napi_branches = vec![];
    let mut to_napi_branches = vec![];

    self.variants.iter().for_each(|v| {
      let val: Literal = (&v.val).into();
      let v_name = &v.name;

      from_napi_branches.push(quote! { #val => Ok(#name::#v_name) });
      to_napi_branches.push(quote! { #name::#v_name => #val });
    });

    quote! {
      impl napi::bindgen_prelude::TypeName for #name {
        fn type_name() -> &'static str {
          #name_str
        }

        fn value_type() -> napi::ValueType {
          napi::ValueType::Object
        }
      }

      impl napi::bindgen_prelude::ValidateNapiValue for #name {
        unsafe fn validate(
          env: napi::bindgen_prelude::sys::napi_env,
          napi_val: napi::bindgen_prelude::sys::napi_value
        ) -> napi::bindgen_prelude::Result<napi::sys::napi_value> {
          napi::bindgen_prelude::assert_type_of!(env, napi_val, napi::bindgen_prelude::ValueType::Number)?;
          Ok(std::ptr::null_mut())
        }
      }

      impl napi::bindgen_prelude::FromNapiValue for #name {
        unsafe fn from_napi_value(
          env: napi::bindgen_prelude::sys::napi_env,
          napi_val: napi::bindgen_prelude::sys::napi_value
        ) -> napi::bindgen_prelude::Result<Self> {
          let val = napi::bindgen_prelude::FromNapiValue::from_napi_value(env, napi_val).map_err(|e| {
            napi::bindgen_prelude::error!(
              e.status,
              "Failed to convert napi value into enum `{}`. {}",
              #name_str,
              e,
            )
          })?;

          match val {
            #(#from_napi_branches,)*
            _ => {
              Err(napi::bindgen_prelude::error!(
                napi::bindgen_prelude::Status::InvalidArg,
                "value `{:?}` does not match any variant of enum `{}`",
                val,
                #name_str
              ))
            }
          }
        }
      }

      impl napi::bindgen_prelude::ToNapiValue for #name {
        unsafe fn to_napi_value(
          env: napi::bindgen_prelude::sys::napi_env,
          val: Self
        ) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
          let val = match val {
            #(#to_napi_branches,)*
          };

          napi::bindgen_prelude::ToNapiValue::to_napi_value(env, val)
        }
      }
    }
  }

  fn gen_module_register(&self) -> TokenStream {
    let name_str = self.name.to_string();
    let js_name_lit = Literal::string(&format!("{}\0", &self.js_name));
    let register_name = get_register_ident(&name_str);

    let mut define_properties = vec![];

    for variant in self.variants.iter() {
      let name_lit = Literal::string(&format!("{}\0", variant.name));
      let val_lit: Literal = (&variant.val).into();

      define_properties.push(quote! {
        {
          let name = std::ffi::CStr::from_bytes_with_nul_unchecked(#name_lit.as_bytes());
          napi::bindgen_prelude::check_status!(
            napi::bindgen_prelude::sys::napi_set_named_property(
              env,
              obj_ptr, name.as_ptr(),
              napi::bindgen_prelude::ToNapiValue::to_napi_value(env, #val_lit)?
            ),
            "Failed to defined enum `{}`",
            #js_name_lit
          )?;
        };
      })
    }

    let callback_name = Ident::new(
      &format!("__register__enum__{}_callback__", name_str),
      Span::call_site(),
    );

    let js_mod_ident = js_mod_to_token_stream(self.js_mod.as_ref());

    crate::codegen::REGISTER_IDENTS.with(|c| {
      c.borrow_mut().push(register_name.to_string());
    });

    quote! {
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      unsafe fn #callback_name(env: napi::bindgen_prelude::sys::napi_env) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
        use std::ffi::CString;
        use std::ptr;

        let mut obj_ptr = ptr::null_mut();

        napi::bindgen_prelude::check_status!(
          napi::bindgen_prelude::sys::napi_create_object(env, &mut obj_ptr),
          "Failed to create napi object"
        )?;

        #(#define_properties)*

        Ok(obj_ptr)
      }
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      #[cfg(all(not(test), not(feature = "noop"), not(target_family = "wasm")))]
      #[napi::bindgen_prelude::ctor]
      fn #register_name() {
        napi::bindgen_prelude::register_module_export(#js_mod_ident, #js_name_lit, #callback_name);
      }
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      #[cfg(all(not(test), not(feature = "noop"), target_family = "wasm"))]
      #[no_mangle]
      extern "C" fn #register_name() {
        napi::bindgen_prelude::register_module_export(#js_mod_ident, #js_name_lit, #callback_name);
      }
    }
  }
}
