use proc_macro2::{Literal, TokenStream};
use quote::ToTokens;

use crate::{codegen::get_register_ident, BindgenResult, NapiEnum, TryToTokens};

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
      let val = Literal::i32_unsuffixed(v.val);
      let v_name = &v.name;

      from_napi_branches.push(quote! { #val => Ok(#name::#v_name) });
      to_napi_branches.push(quote! { #name::#v_name => #val });
    });

    quote! {
      impl TypeName for #name {
        fn type_name() -> &'static str {
          #name_str
        }

        fn value_type() -> napi::ValueType {
          napi::ValueType::Object
        }
      }

      impl ValidateNapiValue for #name {
        unsafe fn validate(env: sys::napi_env, napi_val: sys::napi_value) -> Result<()> {
          assert_type_of!(env, napi_val, ValueType::Number)
        }
      }

      impl FromNapiValue for #name {
        unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> Result<Self> {
          let val = i32::from_napi_value(env, napi_val).map_err(|e| {
            error!(
              e.status,
              "Failed to convert napi value into enum `{}`. {}",
              #name_str,
              e,
            )
          })?;

          match val {
            #(#from_napi_branches,)*
            _ => {
              Err(error!(
                Status::InvalidArg,
                "value `{}` does not match any variant of enum `{}`",
                val,
                #name_str
              ))
            }
          }
        }
      }

      impl ToNapiValue for #name {
        unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> Result<sys::napi_value> {
          let val = match val {
            #(#to_napi_branches,)*
          };

          i32::to_napi_value(env, val)
        }
      }
    }
  }

  fn gen_module_register(&self) -> TokenStream {
    let name_str = self.name.to_string();
    let js_name_lit = Literal::string(&self.js_name);
    let register_name = get_register_ident(&name_str);

    let mut define_properties = vec![];

    for variant in self.variants.iter() {
      let name_lit = Literal::string(&variant.name.to_string());
      let val_lit = Literal::i32_unsuffixed(variant.val);

      define_properties.push(quote! {
        {
          let name = CString::new(#name_lit).unwrap();
          check_status!(
            sys::napi_set_named_property(env, obj_ptr, name.as_ptr(), i32::to_napi_value(env, #val_lit)?),
            "Failed to defined enum `{}`",
            #js_name_lit
          )?;
        };
      })
    }

    quote! {
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      #[ctor]
      fn #register_name() {
        use std::ffi::CString;
        use std::ptr;

        unsafe fn cb(env: sys::napi_env) -> Result<sys::napi_value> {
          let mut obj_ptr = ptr::null_mut();

          check_status!(
            sys::napi_create_object(env, &mut obj_ptr),
            "Failed to create napi object"
          )?;

          #(#define_properties)*

          Ok(obj_ptr)
        }

        register_module_export(#js_name_lit, cb);
      }
    }
  }
}
