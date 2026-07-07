use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};

use proc_macro2::{Ident, Literal, Span, TokenStream};
use quote::ToTokens;

use crate::util::to_case;

use crate::{
  codegen::{get_intermediate_ident, js_mod_to_token_stream},
  BindgenResult, FnKind, NapiImpl, NapiStruct, NapiStructKind, TryToTokens,
};
use crate::{NapiArray, NapiClass, NapiObject, NapiStructuredEnum, NapiTransparent};

static NAPI_IMPL_ID: AtomicU32 = AtomicU32::new(0);

const STRUCT_FIELD_SPECIAL_CASE: &[&str] = &["Option", "Result"];

fn class_type_id_type(name: &Ident, has_lifetime: bool) -> TokenStream {
  if has_lifetime {
    quote! { #name<'static> }
  } else {
    quote! { #name }
  }
}

#[cfg(feature = "tracing")]
fn gen_tracing_debug(class_name: &str, method_name: &str) -> TokenStream {
  let full_name = format!("{}::{}", class_name, method_name);
  quote! {
    napi::bindgen_prelude::tracing::debug!(target: "napi", "{}", #full_name);
  }
}

#[cfg(not(feature = "tracing"))]
fn gen_tracing_debug(_class_name: &str, _method_name: &str) -> TokenStream {
  quote! {}
}

// Generate trait implementations for given Struct.
fn gen_napi_value_map_impl(
  name: &Ident,
  js_mod: Option<&String>,
  to_napi_val_impl: TokenStream,
  has_lifetime: bool,
) -> TokenStream {
  let rust_type = class_type_id_type(name, has_lifetime);
  let name_str = name.to_string();
  let name = if has_lifetime {
    quote! { #name<'_> }
  } else {
    quote! { #name }
  };
  let js_mod = js_mod_to_token_stream(js_mod);
  let validate = quote! {
    unsafe fn validate(env: napi::sys::napi_env, napi_val: napi::sys::napi_value) -> napi::Result<napi::sys::napi_value> {
      if let Some(ctor_ref) =
        napi::__private::codegen_v1::get_class_constructor_for_env_by_type(
          env,
          std::any::TypeId::of::<#rust_type>(),
          #js_mod,
        )
      {
        let mut ctor = std::ptr::null_mut();
        napi::check_status!(
          napi::sys::napi_get_reference_value(env, ctor_ref, &mut ctor),
          "Failed to get constructor reference of class `{}`",
          #name_str
        )?;
        let mut is_instance_of = false;
        napi::check_status!(
          napi::sys::napi_instanceof(env, napi_val, ctor, &mut is_instance_of),
          "Failed to get external value of class `{}`",
          #name_str
        )?;
        if is_instance_of {
          Ok(std::ptr::null_mut())
        } else {
          Err(napi::Error::new(
            napi::Status::InvalidArg,
            format!("Value is not instanceof class `{}`", #name_str)
          ))
        }
      } else {
        Err(napi::Error::new(
          napi::Status::InvalidArg,
          format!("Failed to get constructor of class `{}`", #name_str)
        ))
      }
    }
  };
  quote! {
    #[automatically_derived]
    impl napi::bindgen_prelude::TypeName for #name {
      fn type_name() -> &'static str {
        #name_str
      }

      fn value_type() -> napi::ValueType {
        napi::ValueType::Function
      }
    }

    #[automatically_derived]
    impl napi::bindgen_prelude::TypeName for &#name {
      fn type_name() -> &'static str {
        #name_str
      }

      fn value_type() -> napi::ValueType {
        napi::ValueType::Object
      }
    }

    #[automatically_derived]
    impl napi::bindgen_prelude::TypeName for &mut #name {
      fn type_name() -> &'static str {
        #name_str
      }

      fn value_type() -> napi::ValueType {
        napi::ValueType::Object
      }
    }

    #to_napi_val_impl

    #[automatically_derived]
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

        napi::__private::codegen_v1::register_native_borrow_with_value(
          env,
          napi_val,
          wrapped_val.cast::<#name>(),
          false,
        )?;
        Ok(&*(wrapped_val as *const #name))
      }
    }

    #[automatically_derived]
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

        napi::__private::codegen_v1::register_native_borrow_with_value(
          env,
          napi_val,
          wrapped_val.cast::<#name>(),
          true,
        )?;
        Ok(&mut *(wrapped_val as *mut #name))
      }
    }

    #[automatically_derived]
    impl napi::bindgen_prelude::ValidateNapiValue for &#name {
      #validate
    }

    #[automatically_derived]
    impl napi::bindgen_prelude::ValidateNapiValue for &mut #name {
      #validate
    }
  }
}

fn is_option_type(ty: &syn::Type) -> bool {
  if let syn::Type::Path(syn::TypePath {
    path: syn::Path { segments, .. },
    ..
  }) = ty
  {
    matches!(segments.last(), Some(last_path) if last_path.ident == "Option")
  } else {
    false
  }
}

fn gen_field_name_c_string(field_js_name: &str) -> TokenStream {
  if field_js_name.contains('\0') {
    return quote! {
      compile_error!("napi object field names and structured enum discriminants cannot contain NUL bytes")
    };
  }

  let field_js_name_lit = Literal::string(&format!("{field_js_name}\0"));
  quote! {
    std::ffi::CStr::from_bytes_with_nul_unchecked(#field_js_name_lit.as_bytes()).as_ptr()
  }
}

fn gen_named_property_descriptor(
  field_name_c_string: &TokenStream,
  value_var: &Ident,
) -> TokenStream {
  quote! {
    napi::bindgen_prelude::sys::napi_property_descriptor {
      utf8name: #field_name_c_string,
      name: std::ptr::null_mut(),
      method: None,
      getter: None,
      setter: None,
      value: #value_var,
      attributes: napi::bindgen_prelude::sys::PropertyAttributes::writable
        | napi::bindgen_prelude::sys::PropertyAttributes::enumerable
        | napi::bindgen_prelude::sys::PropertyAttributes::configurable,
      data: std::ptr::null_mut(),
    }
  }
}

struct RawFieldGetter<'a> {
  value_ident: &'a Ident,
  raw_ident: &'a Ident,
  ty: &'a syn::Type,
  field_js_name: &'a str,
  field_name_c_string: &'a TokenStream,
  struct_name: &'a str,
  is_optional_field: bool,
  use_nullable: bool,
  obj_raw: TokenStream,
}

fn gen_raw_field_getter(
  RawFieldGetter {
    value_ident,
    raw_ident,
    ty,
    field_js_name,
    field_name_c_string,
    struct_name,
    is_optional_field,
    use_nullable,
    obj_raw,
  }: RawFieldGetter<'_>,
) -> TokenStream {
  let read_helper = if is_optional_field && !use_nullable {
    quote! { from_raw_optional_field }
  } else {
    quote! { from_raw_required_field }
  };

  quote! {
    let #raw_ident = napi::bindgen_prelude::get_named_property_raw(env, #obj_raw, #field_name_c_string)?;
    let #value_ident: #ty = napi::bindgen_prelude::#read_helper(env, #raw_ident, #struct_name, #field_js_name)?;
  }
}

fn gen_optional_conditional_setter(
  value_ident: &Ident,
  field_name_c_string: &TokenStream,
  obj_raw: TokenStream,
) -> TokenStream {
  quote! {
    if let Some(inner) = #value_ident {
      let value = napi::bindgen_prelude::ToNapiValue::to_napi_value(env, inner)?;
      napi::bindgen_prelude::set_named_property_raw(env, #obj_raw, #field_name_c_string, value)?;
    }
  }
}

impl TryToTokens for NapiStruct {
  fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()> {
    let napi_value_map_impl = self.gen_napi_value_map_impl();

    let class_helper_mod = match &self.kind {
      NapiStructKind::Class(class) => self.gen_helper_mod(class),
      _ => quote! {},
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
  fn gen_helper_mod(&self, class: &NapiClass) -> TokenStream {
    let mod_name = Ident::new(&format!("__napi_helper__{}", self.name), Span::call_site());

    let ctor = if class.ctor {
      self.gen_default_ctor(class)
    } else {
      quote! {}
    };

    let mut getters_setters = self.gen_default_getters_setters(class);
    getters_setters.sort_by(|a, b| a.0.cmp(&b.0));
    let register = self.gen_register(class);

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

  fn gen_default_ctor(&self, class: &NapiClass) -> TokenStream {
    let name = &self.name;
    let js_name_str = &self.js_name;
    let fields_len = class.fields.len();
    let mut fields = vec![];

    for (i, field) in class.fields.iter().enumerate() {
      let ty = &field.ty;
      match &field.name {
        syn::Member::Named(ident) => fields
          .push(quote! { #ident: <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb.get_arg(#i))? }),
        syn::Member::Unnamed(_) => {
          fields.push(quote! { <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, cb.get_arg(#i))? });
        }
      }
    }

    let construct = if class.is_tuple {
      quote! { #name (#(#fields),*) }
    } else {
      quote! { #name {#(#fields),*} }
    };

    let is_empty_struct_hint = fields_len == 0;

    let constructor = if class.implement_iterator {
      quote! { unsafe { cb.construct_generator::<#is_empty_struct_hint, #name>(#js_name_str, #construct) } }
    } else {
      quote! { unsafe { cb.construct::<#is_empty_struct_hint, #name>(#js_name_str, #construct) } }
    };

    let tracing_debug = gen_tracing_debug(js_name_str, "constructor");

    quote! {
      extern "C" fn constructor(
        env: napi::bindgen_prelude::sys::napi_env,
        cb: napi::bindgen_prelude::sys::napi_callback_info
      ) -> napi::bindgen_prelude::sys::napi_value {
        #tracing_debug
        napi::bindgen_prelude::CallbackInfo::<#fields_len>::new(env, cb, None, false)
          .and_then(|cb| #constructor)
          .unwrap_or_else(|e| {
            unsafe { napi::bindgen_prelude::JsError::from(e).throw_into(env) };
            std::ptr::null_mut::<napi::bindgen_prelude::sys::napi_value__>()
          })
      }
    }
  }

  fn gen_napi_value_map_impl(&self) -> TokenStream {
    match &self.kind {
      NapiStructKind::Array(array) => self.gen_napi_value_array_impl(array),
      NapiStructKind::Transparent(transparent) => self.gen_napi_value_transparent_impl(transparent),
      NapiStructKind::Class(class) if !class.ctor => gen_napi_value_map_impl(
        &self.name,
        self.js_mod.as_ref(),
        self.gen_to_napi_value_ctor_impl_for_non_default_constructor_struct(class),
        self.has_lifetime,
      ),
      NapiStructKind::Class(class) => gen_napi_value_map_impl(
        &self.name,
        self.js_mod.as_ref(),
        self.gen_to_napi_value_ctor_impl(class),
        self.has_lifetime,
      ),
      NapiStructKind::Object(obj) => self.gen_to_napi_value_obj_impl(obj),
      NapiStructKind::StructuredEnum(structured_enum) => {
        self.gen_to_napi_value_structured_enum_impl(structured_enum)
      }
    }
  }

  fn gen_to_napi_value_ctor_impl_for_non_default_constructor_struct(
    &self,
    class: &NapiClass,
  ) -> TokenStream {
    let name = &self.name;
    let rust_type = class_type_id_type(name, self.has_lifetime);
    let js_name_raw = &self.js_name;
    let js_name_str = format!("{js_name_raw}\0");
    let js_mod = js_mod_to_token_stream(self.js_mod.as_ref());
    let iterator_implementation = self.gen_iterator_property(class, name);
    let async_iterator_implementation = self.gen_async_iterator_property(class, name);
    let (object_finalize_impl, to_napi_value_impl, javascript_class_ext_impl) = if self.has_lifetime
    {
      let name = quote! { #name<'_javascript_function_scope> };
      (
        quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::ObjectFinalize for #name {} },
        quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::ToNapiValue for #name },
        quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::JavaScriptClassExt for #name },
      )
    } else {
      (
        quote! { impl napi::bindgen_prelude::ObjectFinalize for #name {} },
        quote! { impl napi::bindgen_prelude::ToNapiValue for #name },
        quote! { impl napi::bindgen_prelude::JavaScriptClassExt for #name },
      )
    };
    let finalize_trait = if class.use_custom_finalize {
      quote! {}
    } else {
      quote! {
        #[automatically_derived]
        #object_finalize_impl
      }
    };
    quote! {
      #[automatically_derived]
      #to_napi_value_impl {
        unsafe fn to_napi_value(
          env: napi::sys::napi_env,
          val: #name
        ) -> napi::Result<napi::bindgen_prelude::sys::napi_value> {
          if let Some(ctor_ref) =
            napi::__private::codegen_v1::get_class_constructor_for_env_by_type(
              env,
              std::any::TypeId::of::<#rust_type>(),
              #js_mod,
            )
          {
            // Keep ownership in Rust until both instance construction and wrapping succeed.
            let (instance_value, wrapped_value) =
              napi::__private::codegen_v1::new_instance_with_owned_value::<#name>(env, val, ctor_ref)?;
            #iterator_implementation
            #async_iterator_implementation
            let _ = wrapped_value;
            Ok(instance_value)
          } else {
            Err(napi::bindgen_prelude::Error::new(
              napi::bindgen_prelude::Status::InvalidArg, format!("Failed to get constructor of class `{}` in `ToNapiValue`", #js_name_raw))
            )
          }
        }
      }

      #finalize_trait

      #[automatically_derived]
      #javascript_class_ext_impl {
        fn into_instance<'scope>(self, env: &'scope napi::Env) -> napi::Result<napi::bindgen_prelude::ClassInstance<'scope, Self>>
         {
          if let Some(ctor_ref) =
            napi::__private::codegen_v1::get_class_constructor_for_env_by_type(
              env.raw(),
              std::any::TypeId::of::<#rust_type>(),
              #js_mod,
            )
          {
            unsafe {
              let (instance_value, wrapped_value) =
                napi::__private::codegen_v1::new_instance_with_owned_value::<#name>(env.raw(), self, ctor_ref)?;
              napi::__private::codegen_v1::try_new_class_instance(instance_value, env.raw(), wrapped_value)
            }
          } else {
            Err(napi::bindgen_prelude::Error::new(
              napi::bindgen_prelude::Status::InvalidArg, format!("Failed to get constructor of class `{}`", #js_name_raw))
            )
          }
        }

        fn into_reference(self, env: napi::Env) -> napi::Result<napi::bindgen_prelude::Reference<Self>> {
          if let Some(ctor_ref) =
            napi::__private::codegen_v1::get_class_constructor_for_env_by_type(
              env.raw(),
              std::any::TypeId::of::<#rust_type>(),
              #js_mod,
            )
          {
            unsafe {
              let (instance_value, wrapped_value) =
                napi::__private::codegen_v1::new_instance_with_owned_value::<#name>(env.raw(), self, ctor_ref)?;
              {
                let env = env.raw();
                #iterator_implementation
                #async_iterator_implementation
              }
              napi::bindgen_prelude::Reference::<#name>::from_value_ptr(wrapped_value.cast(), env.raw())
            }
          } else {
            Err(napi::bindgen_prelude::Error::new(
              napi::bindgen_prelude::Status::InvalidArg, format!("Failed to get constructor of class `{}`", #js_name_raw))
            )
          }
        }

        fn instance_of<'env, V: napi::JsValue<'env>>(env: &napi::bindgen_prelude::Env, value: &V) -> napi::bindgen_prelude::Result<bool> {
          if let Some(ctor_ref) =
            napi::__private::codegen_v1::get_class_constructor_for_env_by_type(
              env.raw(),
              std::any::TypeId::of::<#rust_type>(),
              #js_mod,
            )
          {
            let mut ctor = std::ptr::null_mut();
            napi::check_status!(
              unsafe { napi::sys::napi_get_reference_value(env.raw(), ctor_ref, &mut ctor) },
              "Failed to get constructor reference of class `{}`",
              #js_name_str
            )?;
            let mut is_instance_of = false;
            napi::check_status!(
              unsafe { napi::sys::napi_instanceof(env.raw(), value.value().value, ctor, &mut is_instance_of) },
              "Failed to run instanceof for class `{}`",
              #js_name_str
            )?;
            Ok(is_instance_of)
          } else {
            Err(napi::Error::new(napi::Status::GenericFailure, format!("Failed to get constructor of class `{}`", #js_name_str)))
          }
        }
      }
    }
  }

  fn gen_iterator_property(&self, class: &NapiClass, name: &Ident) -> TokenStream {
    if !class.implement_iterator {
      return quote! {};
    }
    quote! {
      unsafe { napi::__private::create_iterator::<#name>(env, instance_value, wrapped_value); }
    }
  }

  fn gen_async_iterator_property(&self, class: &NapiClass, name: &Ident) -> TokenStream {
    if !class.implement_async_iterator {
      return quote! {};
    }
    // Note: `create_async_iterator` is NOT unsafe, unlike `create_iterator`.
    // `create_iterator` is unsafe because `ScopedGenerator<'a>` has a lifetime parameter,
    // requiring the caller to uphold lifetime invariants. `create_async_iterator` uses
    // `AsyncGenerator` whose Future must be `Send + 'static`, so all data is owned and
    // no lifetime invariants need to be upheld by the caller.
    quote! {
      napi::__private::create_async_iterator::<#name>(env, instance_value, wrapped_value);
    }
  }

  fn gen_to_napi_value_ctor_impl(&self, class: &NapiClass) -> TokenStream {
    let name = &self.name;
    let rust_type = class_type_id_type(name, self.has_lifetime);
    let js_name_without_null = &self.js_name;
    let js_name_str = format!("{}\0", &self.js_name);
    let js_mod = js_mod_to_token_stream(self.js_mod.as_ref());

    let mut field_conversions = vec![];
    let mut field_destructions = vec![];

    for field in class.fields.iter() {
      let ty = &field.ty;

      match &field.name {
        syn::Member::Named(ident) => {
          // alias here prevents field name shadowing
          let alias_ident = format_ident!("{}_", ident);
          field_destructions.push(quote! { #ident: #alias_ident });
          field_conversions.push(
            quote! { <#ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, #alias_ident)? },
          );
        }
        syn::Member::Unnamed(i) => {
          let arg_name = format_ident!("arg{}", i);
          field_destructions.push(quote! { #arg_name });
          field_conversions.push(
            quote! { <#ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, #arg_name)? },
          );
        }
      }
    }

    let destructed_fields = if class.is_tuple {
      quote! {
        Self (#(#field_destructions),*)
      }
    } else {
      quote! {
        Self {#(#field_destructions),*}
      }
    };

    let finalize_trait = if class.use_custom_finalize {
      quote! {}
    } else if self.has_lifetime {
      quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::ObjectFinalize for #name<'_javascript_function_scope> {} }
    } else {
      quote! { impl napi::bindgen_prelude::ObjectFinalize for #name {} }
    };

    let to_napi_value_impl = if self.has_lifetime {
      quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::ToNapiValue for #name<'_javascript_function_scope> }
    } else {
      quote! { impl napi::bindgen_prelude::ToNapiValue for #name }
    };

    quote! {
      #[automatically_derived]
      #to_napi_value_impl {
        unsafe fn to_napi_value(
          env: napi::bindgen_prelude::sys::napi_env,
          val: #name,
        ) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
          if let Some(ctor_ref) =
            napi::__private::codegen_v1::get_class_constructor_for_env_by_type(
              env,
              std::any::TypeId::of::<#rust_type>(),
              #js_mod,
            )
          {
            let mut ctor = std::ptr::null_mut();

            napi::bindgen_prelude::check_status!(
              napi::bindgen_prelude::sys::napi_get_reference_value(env, ctor_ref, &mut ctor),
              "Failed to get constructor reference of class `{}`",
              #js_name_without_null
            )?;

            let mut instance_value = std::ptr::null_mut();
            let #destructed_fields = val;
            let args = vec![#(#field_conversions),*];

            napi::bindgen_prelude::check_status!(
              napi::bindgen_prelude::sys::napi_new_instance(env, ctor, args.len(), args.as_ptr(), &mut instance_value),
              "Failed to construct class `{}`",
              #js_name_without_null
            )?;

            Ok(instance_value)
          } else {
            Err(napi::bindgen_prelude::Error::new(
              napi::bindgen_prelude::Status::InvalidArg, format!("Failed to get constructor of class `{}`", #js_name_str))
            )
          }
        }
      }
      #finalize_trait
    }
  }

  fn gen_to_napi_value_obj_impl(&self, obj: &NapiObject) -> TokenStream {
    let name = &self.name;
    let name_str = self.name.to_string();

    let mut obj_field_getters = vec![];
    let mut field_destructions = vec![];

    // For optimized object creation: separate always-set fields from conditionally-set fields
    let mut value_conversions = vec![];
    let mut property_descriptors = vec![];
    let mut conditional_setters = vec![];
    let mut value_names = vec![];

    for (idx, field) in obj.fields.iter().enumerate() {
      let field_js_name = &field.js_name;
      let field_name_c_string = gen_field_name_c_string(field_js_name);
      let mut ty = field.ty.clone();
      remove_lifetime_in_type(&mut ty);
      let is_optional_field = is_option_type(&ty);

      // Determine if this field is always set or conditionally set
      let is_always_set = !is_optional_field || self.use_nullable;

      match &field.name {
        syn::Member::Named(ident) => {
          let alias_ident = format_ident!("{}_", ident);
          field_destructions.push(quote! { #ident: #alias_ident });

          if is_always_set {
            // This field is always set - use batched approach
            let value_var = Ident::new(&format!("__obj_value_{}", idx), Span::call_site());
            value_names.push(value_var.clone());

            if is_optional_field {
              // Optional with use_nullable=true: set to value or null
              value_conversions.push(quote! {
                let #value_var = if let Some(inner) = #alias_ident {
                  napi::bindgen_prelude::ToNapiValue::to_napi_value(env, inner)?
                } else {
                  napi::bindgen_prelude::ToNapiValue::to_napi_value(env, napi::bindgen_prelude::Null)?
                };
              });
            } else {
              // Non-optional: always set
              value_conversions.push(quote! {
                let #value_var = napi::bindgen_prelude::ToNapiValue::to_napi_value(env, #alias_ident)?;
              });
            }

            property_descriptors.push(gen_named_property_descriptor(
              &field_name_c_string,
              &value_var,
            ));
          } else {
            // Optional with use_nullable=false: conditionally set
            conditional_setters.push(gen_optional_conditional_setter(
              &alias_ident,
              &field_name_c_string,
              quote! { obj_ptr },
            ));
          }

          let raw_ident = Ident::new(&format!("__obj_field_raw_{}", idx), Span::call_site());
          obj_field_getters.push(gen_raw_field_getter(RawFieldGetter {
            value_ident: &alias_ident,
            raw_ident: &raw_ident,
            ty: &ty,
            field_js_name,
            field_name_c_string: &field_name_c_string,
            struct_name: &name_str,
            is_optional_field,
            use_nullable: self.use_nullable,
            obj_raw: quote! { napi::bindgen_prelude::JsValue::raw(&obj) },
          }));
        }
        syn::Member::Unnamed(i) => {
          let arg_name = format_ident!("arg{}", i);
          field_destructions.push(quote! { #arg_name });

          if is_always_set {
            // This field is always set - use batched approach
            let value_var = Ident::new(&format!("__obj_value_{}", idx), Span::call_site());
            value_names.push(value_var.clone());

            if is_optional_field {
              // Optional with use_nullable=true: set to value or null
              value_conversions.push(quote! {
                let #value_var = if let Some(inner) = #arg_name {
                  napi::bindgen_prelude::ToNapiValue::to_napi_value(env, inner)?
                } else {
                  napi::bindgen_prelude::ToNapiValue::to_napi_value(env, napi::bindgen_prelude::Null)?
                };
              });
            } else {
              // Non-optional: always set
              value_conversions.push(quote! {
                let #value_var = napi::bindgen_prelude::ToNapiValue::to_napi_value(env, #arg_name)?;
              });
            }

            property_descriptors.push(gen_named_property_descriptor(
              &field_name_c_string,
              &value_var,
            ));
          } else {
            // Optional with use_nullable=false: conditionally set
            conditional_setters.push(gen_optional_conditional_setter(
              &arg_name,
              &field_name_c_string,
              quote! { obj_ptr },
            ));
          }

          let raw_ident = Ident::new(&format!("__obj_field_raw_{}", idx), Span::call_site());
          obj_field_getters.push(gen_raw_field_getter(RawFieldGetter {
            value_ident: &arg_name,
            raw_ident: &raw_ident,
            ty: &ty,
            field_js_name,
            field_name_c_string: &field_name_c_string,
            struct_name: "",
            is_optional_field,
            use_nullable: self.use_nullable,
            obj_raw: quote! { napi::bindgen_prelude::JsValue::raw(&obj) },
          }));
        }
      }
    }

    let destructed_fields = if obj.is_tuple {
      quote! {
        Self (#(#field_destructions),*)
      }
    } else {
      quote! {
        Self {#(#field_destructions),*}
      }
    };

    let name_with_lifetime = if self.has_lifetime {
      quote! { #name<'_javascript_function_scope> }
    } else {
      quote! { #name }
    };
    let (from_napi_value_impl, to_napi_value_impl, validate_napi_value_impl, type_name_impl) =
      if self.has_lifetime {
        (
          quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::FromNapiValue for #name<'_javascript_function_scope> },
          quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::ToNapiValue for #name<'_javascript_function_scope> },
          quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::ValidateNapiValue for #name<'_javascript_function_scope> },
          quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::TypeName for #name<'_javascript_function_scope> },
        )
      } else {
        (
          quote! { impl napi::bindgen_prelude::FromNapiValue for #name },
          quote! { impl napi::bindgen_prelude::ToNapiValue for #name },
          quote! { impl napi::bindgen_prelude::ValidateNapiValue for #name },
          quote! { impl napi::bindgen_prelude::TypeName for #name },
        )
      };

    // Generate object creation code
    let object_creation = if conditional_setters.is_empty() {
      // All fields are always set - use fully batched approach
      quote! {
        // Convert all values first, so error handling works correctly
        #(#value_conversions)*

        let properties = [
          #(#property_descriptors),*
        ];

        let obj_ptr = napi::bindgen_prelude::create_object_with_properties(env, &properties)?;
        Ok(obj_ptr)
      }
    } else {
      // Some fields are conditionally set - use batched for always-set, then add conditionals
      quote! {
        // Convert all always-set values first
        #(#value_conversions)*

        let properties = [
          #(#property_descriptors),*
        ];

        let obj_ptr = napi::bindgen_prelude::create_object_with_properties(env, &properties)?;

        #(#conditional_setters)*

        Ok(obj_ptr)
      }
    };

    let to_napi_value = if obj.object_to_js {
      quote! {
        #[automatically_derived]
        #to_napi_value_impl {
          unsafe fn to_napi_value(env: napi::bindgen_prelude::sys::napi_env, val: #name_with_lifetime) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
            let #destructed_fields = val;
            #object_creation
          }
        }
      }
    } else {
      quote! {}
    };

    let from_napi_value = if obj.object_from_js {
      let return_type = if self.has_lifetime {
        quote! { #name<'_javascript_function_scope> }
      } else {
        quote! { #name }
      };
      quote! {
        #[automatically_derived]
        #from_napi_value_impl {
          unsafe fn from_napi_value(
            env: napi::bindgen_prelude::sys::napi_env,
            napi_val: napi::bindgen_prelude::sys::napi_value
          ) -> napi::bindgen_prelude::Result<#return_type> {
            #[allow(unused_variables)]
            let env_wrapper = napi::bindgen_prelude::Env::from(env);
            #[allow(unused_mut)]
            let mut obj = napi::bindgen_prelude::Object::from_napi_value(env, napi_val)?;

            #(#obj_field_getters)*

            let val = #destructed_fields;

            Ok(val)
          }
        }

        #[automatically_derived]
        #validate_napi_value_impl {}
      }
    } else {
      quote! {}
    };

    quote! {
      #[automatically_derived]
      #type_name_impl {
        fn type_name() -> &'static str {
          #name_str
        }

        fn value_type() -> napi::ValueType {
          napi::ValueType::Object
        }
      }

      #to_napi_value

      #from_napi_value
    }
  }

  fn gen_default_getters_setters(&self, class: &NapiClass) -> Vec<(String, TokenStream)> {
    let mut getters_setters = vec![];
    let struct_name = &self.name;
    let js_name_str = &self.js_name;

    for field in class.fields.iter() {
      let field_ident = &field.name;
      let field_name = match &field.name {
        syn::Member::Named(ident) => ident.to_string(),
        syn::Member::Unnamed(i) => format!("field{}", i.index),
      };
      let ty = &field.ty;

      let getter_name = Ident::new(
        &format!("get_{}", rm_raw_prefix(&field_name)),
        Span::call_site(),
      );
      let setter_name = Ident::new(
        &format!("set_{}", rm_raw_prefix(&field_name)),
        Span::call_site(),
      );
      let accessor_descriptor_name = Ident::new(
        &format!(
          "__napi_field_accessor_descriptor_{}",
          rm_raw_prefix(&field_name)
        ),
        Span::call_site(),
      );

      if field.getter {
        let default_to_napi_value_convert = quote! {
          let val = &mut obj.#field_ident;
          unsafe { <&mut #ty as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, val) }
        };
        let to_napi_value_convert = if let syn::Type::Path(syn::TypePath {
          path: syn::Path { segments, .. },
          ..
        }) = ty
        {
          if let Some(syn::PathSegment { ident, .. }) = segments.last() {
            if STRUCT_FIELD_SPECIAL_CASE.iter().any(|name| ident == name) {
              quote! {
                let val = obj.#field_ident.as_mut();
                unsafe { napi::bindgen_prelude::ToNapiValue::to_napi_value(env, val) }
              }
            } else {
              default_to_napi_value_convert
            }
          } else {
            default_to_napi_value_convert
          }
        } else {
          default_to_napi_value_convert
        };
        let tracing_debug = gen_tracing_debug(js_name_str, &field.js_name);
        getters_setters.push((
          field.js_name.clone(),
          quote! {
            unsafe fn #getter_name(
              env: napi::bindgen_prelude::sys::napi_env,
              this: napi::bindgen_prelude::sys::napi_value
            ) -> napi::Result<napi::bindgen_prelude::sys::napi_value> {
              #tracing_debug
              let this_ptr = unsafe {
                napi::bindgen_prelude::class_accessor_unwrap_this::<#struct_name>(env, this)?
              };
              let _napi_native_borrow =
                napi::__private::codegen_v1::acquire_native_borrow(this_ptr, true)?;
              let obj: &mut #struct_name = unsafe { &mut *this_ptr };
              #to_napi_value_convert
            }
          },
        ));
      }

      if field.setter {
        let setter_tracing_debug =
          gen_tracing_debug(js_name_str, &format!("set_{}", field.js_name));
        getters_setters.push((
          field.js_name.clone(),
          quote! {
            unsafe fn #setter_name(
              env: napi::bindgen_prelude::sys::napi_env,
              this: napi::bindgen_prelude::sys::napi_value,
              value: napi::bindgen_prelude::sys::napi_value
            ) -> napi::Result<napi::bindgen_prelude::sys::napi_value> {
              #setter_tracing_debug
              let this_ptr = unsafe {
                napi::bindgen_prelude::class_accessor_unwrap_this::<#struct_name>(env, this)?
              };
              let _napi_native_borrow =
                napi::__private::codegen_v1::acquire_native_borrow(this_ptr, true)?;
              let val = unsafe {
                <#ty as napi::bindgen_prelude::FromNapiValue>::from_napi_value(env, value)?
              };
              let obj: &mut #struct_name = unsafe { &mut *this_ptr };
              obj.#field_ident = val;
              unsafe { <() as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, ()) }
            }
          },
        ));
      }

      if field.getter {
        let getter = quote! { Some(#getter_name) };
        let setter = if field.setter {
          quote! { Some(#setter_name) }
        } else {
          quote! { None }
        };
        getters_setters.push((
          field.js_name.clone(),
          quote! {
            static #accessor_descriptor_name: napi::bindgen_prelude::ClassAccessorDescriptor = napi::bindgen_prelude::ClassAccessorDescriptor {
              getter: #getter,
              setter: #setter,
            };
          },
        ));
      }
    }

    getters_setters
  }

  fn gen_register(&self, class: &NapiClass) -> TokenStream {
    let name = &self.name;
    let rust_type = class_type_id_type(name, self.has_lifetime);
    let struct_register_name = &self.register_name;
    let js_name = format!("{}\0", self.js_name);
    let implement_iterator = class.implement_iterator;
    let mut props = vec![];

    if class.ctor {
      props.push(quote! { napi::bindgen_prelude::Property::new().with_utf8_name("constructor").unwrap().with_ctor(constructor) });
    }

    for field in class.fields.iter() {
      let field_name = match &field.name {
        syn::Member::Named(ident) => ident.to_string(),
        syn::Member::Unnamed(i) => format!("field{}", i.index),
      };

      if !field.getter {
        continue;
      }

      let js_name = &field.js_name;
      let mut attribute = super::PROPERTY_ATTRIBUTE_DEFAULT;
      if field.writable {
        attribute |= super::PROPERTY_ATTRIBUTE_WRITABLE;
      }
      if field.enumerable {
        attribute |= super::PROPERTY_ATTRIBUTE_ENUMERABLE;
      }
      if field.configurable {
        attribute |= super::PROPERTY_ATTRIBUTE_CONFIGURABLE;
      }

      let mut prop = quote! {
        napi::bindgen_prelude::Property::new().with_utf8_name(#js_name)
          .unwrap()
          .with_property_attributes(napi::bindgen_prelude::PropertyAttributes::from_bits(#attribute).unwrap())
      };

      if field.getter {
        let accessor_descriptor_name = Ident::new(
          &format!(
            "__napi_field_accessor_descriptor_{}",
            rm_raw_prefix(&field_name)
          ),
          Span::call_site(),
        );
        (quote! {
          .with_getter(napi::bindgen_prelude::class_getter_trampoline)
          .with_data(&#accessor_descriptor_name as *const _ as *mut _)
        })
        .to_tokens(&mut prop);
      }

      if field.writable && field.setter {
        let accessor_descriptor_name = Ident::new(
          &format!(
            "__napi_field_accessor_descriptor_{}",
            rm_raw_prefix(&field_name)
          ),
          Span::call_site(),
        );
        (quote! {
          .with_setter(napi::bindgen_prelude::class_setter_trampoline)
          .with_data(&#accessor_descriptor_name as *const _ as *mut _)
        })
        .to_tokens(&mut prop);
      }

      props.push(prop);
    }
    let js_mod_ident = js_mod_to_token_stream(self.js_mod.as_ref());
    quote! {
      #[cfg(all(not(test), not(target_family = "wasm")))]
      napi::ctor::declarative::ctor! {
        #[allow(non_snake_case)]
        #[allow(clippy::all)]
        #[ctor(unsafe)]
        fn #struct_register_name() {
          napi::__private::register_class(std::any::TypeId::of::<#rust_type>(), #js_mod_ident, #js_name, vec![#(#props),*], #implement_iterator);
        }
      }

      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      #[cfg(all(not(test), target_family = "wasm"))]
      #[no_mangle]
      extern "C" fn #struct_register_name() {
        napi::__private::register_class(std::any::TypeId::of::<#rust_type>(), #js_mod_ident, #js_name, vec![#(#props),*], #implement_iterator);
      }
    }
  }

  fn gen_to_napi_value_structured_enum_impl(
    &self,
    structured_enum: &NapiStructuredEnum,
  ) -> TokenStream {
    let name = &self.name;
    let name_str = self.name.to_string();
    let discriminant = structured_enum.discriminant.as_str();
    let discriminant_c_string = gen_field_name_c_string(discriminant);

    let mut variant_arm_setters = vec![];
    let mut variant_arm_getters = vec![];

    for variant in structured_enum.variants.iter() {
      let variant_name = &variant.name;
      let mut variant_name_str = variant_name.to_string();
      if let Some(case) = structured_enum.discriminant_case {
        variant_name_str = to_case(variant_name_str, case);
      }

      let mut obj_field_getters = vec![];
      let mut field_destructions = vec![];

      // For optimized object creation
      let mut value_conversions = vec![];
      let mut property_descriptors = vec![];
      let mut conditional_setters = vec![];

      // First property is always the discriminant
      let discriminant_value_var = Ident::new("__discriminant_value", Span::call_site());
      value_conversions.push(quote! {
        let #discriminant_value_var = napi::bindgen_prelude::ToNapiValue::to_napi_value(env, #variant_name_str)?;
      });
      property_descriptors.push(gen_named_property_descriptor(
        &discriminant_c_string,
        &discriminant_value_var,
      ));

      for (idx, field) in variant.fields.iter().enumerate() {
        let field_js_name = &field.js_name;
        let field_name_c_string = gen_field_name_c_string(field_js_name);
        let mut ty = field.ty.clone();
        remove_lifetime_in_type(&mut ty);
        let is_optional_field = is_option_type(&ty);

        // Determine if this field is always set or conditionally set
        let is_always_set = !is_optional_field || self.use_nullable;

        match &field.name {
          syn::Member::Named(ident) => {
            let alias_ident = format_ident!("{}_", ident);
            field_destructions.push(quote! { #ident: #alias_ident });

            if is_always_set {
              // This field is always set - use batched approach
              let value_var = Ident::new(&format!("__variant_value_{}", idx), Span::call_site());

              if is_optional_field {
                // Optional with use_nullable=true: set to value or null
                value_conversions.push(quote! {
                  let #value_var = if let Some(inner) = #alias_ident {
                    napi::bindgen_prelude::ToNapiValue::to_napi_value(env, inner)?
                  } else {
                    napi::bindgen_prelude::ToNapiValue::to_napi_value(env, napi::bindgen_prelude::Null)?
                  };
                });
              } else {
                // Non-optional: always set
                value_conversions.push(quote! {
                  let #value_var = napi::bindgen_prelude::ToNapiValue::to_napi_value(env, #alias_ident)?;
                });
              }

              property_descriptors.push(gen_named_property_descriptor(
                &field_name_c_string,
                &value_var,
              ));
            } else {
              // Optional with use_nullable=false: conditionally set
              conditional_setters.push(gen_optional_conditional_setter(
                &alias_ident,
                &field_name_c_string,
                quote! { obj_ptr },
              ));
            }

            let raw_ident = Ident::new(&format!("__variant_field_raw_{}", idx), Span::call_site());
            obj_field_getters.push(gen_raw_field_getter(RawFieldGetter {
              value_ident: &alias_ident,
              raw_ident: &raw_ident,
              ty: &ty,
              field_js_name,
              field_name_c_string: &field_name_c_string,
              struct_name: &name_str,
              is_optional_field,
              use_nullable: self.use_nullable,
              obj_raw: quote! { napi::bindgen_prelude::JsValue::raw(&obj) },
            }));
          }
          syn::Member::Unnamed(i) => {
            let arg_name = format_ident!("arg{}", i);
            field_destructions.push(quote! { #arg_name });

            if is_always_set {
              // This field is always set - use batched approach
              let value_var = Ident::new(&format!("__variant_value_{}", idx), Span::call_site());

              if is_optional_field {
                // Optional with use_nullable=true: set to value or null
                value_conversions.push(quote! {
                  let #value_var = if let Some(inner) = #arg_name {
                    napi::bindgen_prelude::ToNapiValue::to_napi_value(env, inner)?
                  } else {
                    napi::bindgen_prelude::ToNapiValue::to_napi_value(env, napi::bindgen_prelude::Null)?
                  };
                });
              } else {
                // Non-optional: always set
                value_conversions.push(quote! {
                  let #value_var = napi::bindgen_prelude::ToNapiValue::to_napi_value(env, #arg_name)?;
                });
              }

              property_descriptors.push(gen_named_property_descriptor(
                &field_name_c_string,
                &value_var,
              ));
            } else {
              // Optional with use_nullable=false: conditionally set
              conditional_setters.push(gen_optional_conditional_setter(
                &arg_name,
                &field_name_c_string,
                quote! { obj_ptr },
              ));
            }

            let raw_ident = Ident::new(&format!("__variant_field_raw_{}", idx), Span::call_site());
            obj_field_getters.push(gen_raw_field_getter(RawFieldGetter {
              value_ident: &arg_name,
              raw_ident: &raw_ident,
              ty: &ty,
              field_js_name,
              field_name_c_string: &field_name_c_string,
              struct_name: "",
              is_optional_field,
              use_nullable: self.use_nullable,
              obj_raw: quote! { napi::bindgen_prelude::JsValue::raw(&obj) },
            }));
          }
        }
      }

      let destructed_fields = if variant.is_tuple {
        quote! {
          Self::#variant_name (#(#field_destructions),*)
        }
      } else {
        quote! {
          Self::#variant_name {#(#field_destructions),*}
        }
      };

      // Generate object creation for this variant
      let variant_object_creation = if conditional_setters.is_empty() {
        // All fields are always set - use fully batched approach
        quote! {
          #(#value_conversions)*

          let properties = [
            #(#property_descriptors),*
          ];

          napi::bindgen_prelude::create_object_with_properties(env, &properties)
        }
      } else {
        // Some fields are conditionally set
        quote! {
          #(#value_conversions)*

          let properties = [
            #(#property_descriptors),*
          ];

          let obj_ptr = napi::bindgen_prelude::create_object_with_properties(env, &properties)?;

          #(#conditional_setters)*

          Ok(obj_ptr)
        }
      };

      variant_arm_setters.push(quote! {
        #destructed_fields => {
          #variant_object_creation
        },
      });

      variant_arm_getters.push(quote! {
        #variant_name_str => {
          #(#obj_field_getters)*
          #destructed_fields
        },
      })
    }

    let to_napi_value = if structured_enum.object_to_js {
      quote! {
        impl napi::bindgen_prelude::ToNapiValue for #name {
          unsafe fn to_napi_value(env: napi::bindgen_prelude::sys::napi_env, val: #name) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
            match val {
              #(#variant_arm_setters)*
            }
          }
        }
      }
    } else {
      quote! {}
    };

    let from_napi_value = if structured_enum.object_from_js {
      quote! {
        impl napi::bindgen_prelude::FromNapiValue for #name {
          unsafe fn from_napi_value(
            env: napi::bindgen_prelude::sys::napi_env,
            napi_val: napi::bindgen_prelude::sys::napi_value
          ) -> napi::bindgen_prelude::Result<Self> {
            #[allow(unused_variables)]
            let env_wrapper = napi::bindgen_prelude::Env::from(env);
            #[allow(unused_mut)]
            let mut obj = napi::bindgen_prelude::Object::from_napi_value(env, napi_val)?;
            let __discriminant_raw = napi::bindgen_prelude::get_named_property_raw(
              env,
              napi::bindgen_prelude::JsValue::raw(&obj),
              #discriminant_c_string,
            )?;
            let type_: String = napi::bindgen_prelude::from_raw_required_field(
              env,
              __discriminant_raw,
              #name_str,
              #discriminant,
            )?;
            let val = match type_.as_str() {
              #(#variant_arm_getters)*
              _ => return Err(napi::bindgen_prelude::Error::new(
                napi::bindgen_prelude::Status::InvalidArg,
                format!("Unknown variant `{}`", type_),
              )),
            };

            Ok(val)
          }
        }

        impl napi::bindgen_prelude::ValidateNapiValue for #name {}
      }
    } else {
      quote! {}
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

      #to_napi_value

      #from_napi_value
    }
  }

  fn gen_napi_value_transparent_impl(&self, transparent: &NapiTransparent) -> TokenStream {
    let name = &self.name;
    let name = if self.has_lifetime {
      quote! { #name<'_> }
    } else {
      quote! { #name }
    };
    let inner_type = transparent.ty.clone().into_token_stream();

    let to_napi_value = if transparent.object_to_js {
      quote! {
        #[automatically_derived]
        impl napi::bindgen_prelude::ToNapiValue for #name {
          unsafe fn to_napi_value(
            env: napi::bindgen_prelude::sys::napi_env,
            val: Self
          ) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
            <#inner_type>::to_napi_value(env, val.0)
          }
        }
      }
    } else {
      quote! {}
    };

    let from_napi_value = if transparent.object_from_js {
      quote! {
        #[automatically_derived]
        impl napi::bindgen_prelude::FromNapiValue for #name {
          unsafe fn from_napi_value(
            env: napi::bindgen_prelude::sys::napi_env,
            napi_val: napi::bindgen_prelude::sys::napi_value
          ) -> napi::bindgen_prelude::Result<Self> {
            Ok(Self(<#inner_type>::from_napi_value(env, napi_val)?))
          }
        }
      }
    } else {
      quote! {}
    };

    quote! {
      #[automatically_derived]
      impl napi::bindgen_prelude::TypeName for #name {
        fn type_name() -> &'static str {
          <#inner_type>::type_name()
        }

        fn value_type() -> napi::ValueType {
          <#inner_type>::value_type()
        }
      }

      #[automatically_derived]
      impl napi::bindgen_prelude::ValidateNapiValue for #name {
        unsafe fn validate(
          env: napi::bindgen_prelude::sys::napi_env,
          napi_val: napi::bindgen_prelude::sys::napi_value
        ) -> napi::bindgen_prelude::Result<napi::sys::napi_value> {
          <#inner_type>::validate(env, napi_val)
        }
      }

      #to_napi_value

      #from_napi_value
    }
  }

  fn gen_napi_value_array_impl(&self, array: &NapiArray) -> TokenStream {
    let name = &self.name;
    let name_str = self.name.to_string();

    let mut obj_field_setters = vec![];
    let mut obj_field_getters = vec![];
    let mut field_destructions = vec![];

    for field in array.fields.iter() {
      let mut ty = field.ty.clone();
      remove_lifetime_in_type(&mut ty);
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

      if let syn::Member::Unnamed(i) = &field.name {
        let arg_name = format_ident!("arg{}", i);
        let field_index = i.index;
        field_destructions.push(quote! { #arg_name });
        if is_optional_field {
          obj_field_setters.push(match self.use_nullable {
            false => quote! {
              if #arg_name.is_some() {
                array.set(#field_index, #arg_name)?;
              }
            },
            true => quote! {
              if let Some(#arg_name) = #arg_name {
                array.set(#field_index, #arg_name)?;
              } else {
                array.set(#field_index, napi::bindgen_prelude::Null)?;
              }
            },
          });
        } else {
          obj_field_setters.push(quote! { array.set(#field_index, #arg_name)?; });
        }
        if is_optional_field && !self.use_nullable {
          obj_field_getters.push(quote! { let #arg_name: #ty = array.get(#field_index)?; });
        } else {
          obj_field_getters.push(quote! {
            let #arg_name: #ty = array.get(#field_index)?.ok_or_else(|| napi::bindgen_prelude::Error::new(
              napi::bindgen_prelude::Status::InvalidArg,
              format!("Failed to get element with index `{}`", #field_index),
            ))?;
          });
        }
      }
    }

    let destructed_fields = quote! {
      Self (#(#field_destructions),*)
    };

    let name_with_lifetime = if self.has_lifetime {
      quote! { #name<'_javascript_function_scope> }
    } else {
      quote! { #name }
    };
    let (from_napi_value_impl, to_napi_value_impl, validate_napi_value_impl, type_name_impl) =
      if self.has_lifetime {
        (
          quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::FromNapiValue for #name<'_javascript_function_scope> },
          quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::ToNapiValue for #name<'_javascript_function_scope> },
          quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::ValidateNapiValue for #name<'_javascript_function_scope> },
          quote! { impl <'_javascript_function_scope> napi::bindgen_prelude::TypeName for #name<'_javascript_function_scope> },
        )
      } else {
        (
          quote! { impl napi::bindgen_prelude::FromNapiValue for #name },
          quote! { impl napi::bindgen_prelude::ToNapiValue for #name },
          quote! { impl napi::bindgen_prelude::ValidateNapiValue for #name },
          quote! { impl napi::bindgen_prelude::TypeName for #name },
        )
      };

    let array_len = array.fields.len() as u32;

    let to_napi_value = if array.object_to_js {
      quote! {
        #[automatically_derived]
        #to_napi_value_impl {
          unsafe fn to_napi_value(env: napi::bindgen_prelude::sys::napi_env, val: #name_with_lifetime) -> napi::bindgen_prelude::Result<napi::bindgen_prelude::sys::napi_value> {
            #[allow(unused_variables)]
            let env_wrapper = napi::bindgen_prelude::Env::from(env);
            #[allow(unused_mut)]
            let mut array = env_wrapper.create_array(#array_len)?;

            let #destructed_fields = val;
            #(#obj_field_setters)*

            napi::bindgen_prelude::Array::to_napi_value(env, array)
          }
        }
      }
    } else {
      quote! {}
    };

    let from_napi_value = if array.object_from_js {
      let return_type = if self.has_lifetime {
        quote! { #name<'_javascript_function_scope> }
      } else {
        quote! { #name }
      };
      quote! {
        #[automatically_derived]
        #from_napi_value_impl {
          unsafe fn from_napi_value(
            env: napi::bindgen_prelude::sys::napi_env,
            napi_val: napi::bindgen_prelude::sys::napi_value
          ) -> napi::bindgen_prelude::Result<#return_type> {
            #[allow(unused_variables)]
            let env_wrapper = napi::bindgen_prelude::Env::from(env);
            #[allow(unused_mut)]
            let mut array = napi::bindgen_prelude::Array::from_napi_value(env, napi_val)?;

            #(#obj_field_getters)*

            let val = #destructed_fields;

            Ok(val)
          }
        }

        #[automatically_derived]
        #validate_napi_value_impl {}
      }
    } else {
      quote! {}
    };

    quote! {
      #[automatically_derived]
      #type_name_impl {
        fn type_name() -> &'static str {
          #name_str
        }

        fn value_type() -> napi::ValueType {
          napi::ValueType::Object
        }
      }

      #to_napi_value

      #from_napi_value
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
    if cfg!(test) {
      return Ok(quote! {});
    }

    let name = &self.name;
    let rust_type = class_type_id_type(name, self.has_lifetime);
    let name_str = self.name.to_string();
    let js_name = format!("{}\0", self.js_name);
    let mod_name = Ident::new(
      &format!(
        "__napi_impl_helper_{}_{}",
        name_str,
        NAPI_IMPL_ID.fetch_add(1, Ordering::SeqCst)
      ),
      Span::call_site(),
    );

    let register_name = &self.register_name;

    let mut methods = vec![];
    let mut props = HashMap::new();
    let mut accessor_descriptors = HashMap::new();
    let mut accessor_descriptor_count = 0u32;

    for item in self.items.iter() {
      let js_name = Literal::string(&item.js_name);
      let item_str = item.name.to_string();
      let intermediate_name = get_intermediate_ident(&item_str);
      methods.push(item.try_to_token_stream()?);

      let mut attribute = super::PROPERTY_ATTRIBUTE_DEFAULT;
      if item.writable {
        attribute |= super::PROPERTY_ATTRIBUTE_WRITABLE;
      }
      if item.enumerable {
        attribute |= super::PROPERTY_ATTRIBUTE_ENUMERABLE;
      }
      if item.configurable {
        attribute |= super::PROPERTY_ATTRIBUTE_CONFIGURABLE;
      }

      let prop = props.entry(&item.js_name).or_insert_with(|| {
        quote! {
          napi::bindgen_prelude::Property::new().with_utf8_name(#js_name).unwrap().with_property_attributes(napi::bindgen_prelude::PropertyAttributes::from_bits(#attribute).unwrap())
        }
      });

      let accessor_descriptor_ident =
        if matches!(item.kind, FnKind::Getter | FnKind::Setter) && !item.is_async {
          let entry = accessor_descriptors
            .entry(item.js_name.clone())
            .or_insert_with(|| {
              let ident = Ident::new(
                &format!("__napi_accessor_descriptor_{accessor_descriptor_count}"),
                Span::call_site(),
              );
              accessor_descriptor_count += 1;
              (ident, None, None)
            });
          match item.kind {
            FnKind::Getter => {
              entry.1 = Some(intermediate_name.clone());
            }
            FnKind::Setter => {
              entry.2 = Some(intermediate_name.clone());
            }
            _ => {}
          }
          Some(entry.0.clone())
        } else {
          None
        };

      let appendix = match item.kind {
        FnKind::Constructor => quote! { .with_ctor(#intermediate_name) },
        FnKind::Getter if accessor_descriptor_ident.is_some() => {
          let accessor_descriptor_ident = accessor_descriptor_ident.as_ref().unwrap();
          quote! {
            .with_getter(napi::bindgen_prelude::class_getter_trampoline)
            .with_data(&#accessor_descriptor_ident as *const _ as *mut _)
          }
        }
        FnKind::Setter if accessor_descriptor_ident.is_some() => {
          let accessor_descriptor_ident = accessor_descriptor_ident.as_ref().unwrap();
          quote! {
            .with_setter(napi::bindgen_prelude::class_setter_trampoline)
            .with_data(&#accessor_descriptor_ident as *const _ as *mut _)
          }
        }
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
    let props_wasm = props.clone();
    let mut accessor_descriptors: Vec<_> = accessor_descriptors.into_values().collect();
    accessor_descriptors.sort_by_key(|(ident, _, _)| ident.to_string());
    let accessor_descriptors = accessor_descriptors
      .into_iter()
      .map(|(ident, getter, setter)| {
        let getter = getter
          .map(|getter| quote! { Some(#getter) })
          .unwrap_or_else(|| quote! { None });
        let setter = setter
          .map(|setter| quote! { Some(#setter) })
          .unwrap_or_else(|| quote! { None });
        quote! {
          static #ident: napi::bindgen_prelude::ClassAccessorDescriptor = napi::bindgen_prelude::ClassAccessorDescriptor {
            getter: #getter,
            setter: #setter,
          };
        }
      });
    let js_mod_ident = js_mod_to_token_stream(self.js_mod.as_ref());
    Ok(quote! {
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      mod #mod_name {
        use super::*;
        #(#accessor_descriptors)*
        #(#methods)*

        #[cfg(all(not(test), not(target_family = "wasm")))]
        napi::ctor::declarative::ctor! {
          #[ctor(unsafe)]
          fn #register_name() {
            napi::__private::register_class(std::any::TypeId::of::<#rust_type>(), #js_mod_ident, #js_name, vec![#(#props),*], false);
          }
        }

        #[cfg(all(not(test), target_family = "wasm"))]
        #[no_mangle]
        extern "C" fn #register_name() {
          napi::__private::register_class(std::any::TypeId::of::<#rust_type>(), #js_mod_ident, #js_name, vec![#(#props_wasm),*], false);
        }
      }
    })
  }
}

pub fn rm_raw_prefix(s: &str) -> &str {
  if let Some(stripped) = s.strip_prefix("r#") {
    stripped
  } else {
    s
  }
}

fn remove_lifetime_in_type(ty: &mut syn::Type) {
  if let syn::Type::Path(syn::TypePath { path, .. }) = ty {
    path.segments.iter_mut().for_each(|segment| {
      if let syn::PathArguments::AngleBracketed(ref mut args) = segment.arguments {
        args.args.iter_mut().for_each(|arg| match arg {
          syn::GenericArgument::Type(ref mut ty) => {
            remove_lifetime_in_type(ty);
          }
          syn::GenericArgument::Lifetime(lifetime) => {
            lifetime.ident = Ident::new("_", lifetime.ident.span());
          }
          _ => {}
        });
      }
    });
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn owning_class_conversions_do_not_release_the_value_before_instance_creation() {
    let class = NapiClass {
      fields: vec![],
      ctor: false,
      implement_iterator: false,
      implement_async_iterator: false,
      is_tuple: false,
      use_custom_finalize: false,
    };
    let napi_struct = NapiStruct {
      name: Ident::new("DropGuardedClass", Span::call_site()),
      js_name: "DropGuardedClass".to_owned(),
      comments: vec![],
      js_mod: None,
      use_nullable: false,
      register_name: Ident::new("__register__DropGuardedClass", Span::call_site()),
      kind: NapiStructKind::Class(class.clone()),
      has_lifetime: false,
      is_generator: false,
      is_async_generator: false,
    };

    let generated = napi_struct
      .gen_to_napi_value_ctor_impl_for_non_default_constructor_struct(&class)
      .to_string();

    assert_eq!(
      generated.matches("new_instance_with_owned_value").count(),
      3,
      "ToNapiValue, into_instance, and into_reference must all use rollback-safe conversion"
    );
    assert!(
      !generated.contains("Box :: into_raw"),
      "generated conversion must not release ownership before fallible instance creation"
    );
  }
}
