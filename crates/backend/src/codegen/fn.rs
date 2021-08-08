use proc_macro2::{Ident, Span, TokenStream};
use quote::ToTokens;

use crate::{
  codegen::{get_intermediate_ident, get_register_ident},
  BindgenResult, FnKind, FnSelf, NapiFn, TryToTokens,
};

impl TryToTokens for NapiFn {
  fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()> {
    let name_str = self.name.to_string();
    let intermediate_ident = get_intermediate_ident(&name_str);
    let args_len = self.args.len();

    let (arg_conversions, arg_names) = self.gen_arg_conversions();
    let receiver = self.gen_fn_receiver();
    let receiver_ret_name = Ident::new("_ret", Span::call_site());
    let ret = self.gen_fn_return(&receiver_ret_name);
    let register = self.gen_fn_register();

    let attrs = &self.attrs;

    (quote! {
      #(#attrs)*
      #[doc(hidden)]
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      extern "C" fn #intermediate_ident(
        env: sys::napi_env,
        cb: sys::napi_callback_info
      ) -> sys::napi_value {
        #[inline(always)]
        unsafe fn call(env: sys::napi_env, cb: sys::napi_callback_info) -> Result<sys::napi_value> {
          let mut cb = CallbackInfo::<#args_len>::new(env, cb)?;
          #(#arg_conversions)*

          let #receiver_ret_name = {
            #receiver(#(#arg_names),*)
          };

          #ret
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

      #register
    })
    .to_tokens(tokens);

    Ok(())
  }
}

impl NapiFn {
  fn gen_arg_conversions(&self) -> (Vec<TokenStream>, Vec<Ident>) {
    let mut arg_conversions = vec![];
    let mut args = vec![];

    // fetch this
    if let Some(parent) = &self.parent {
      match self.fn_self {
        Some(FnSelf::Ref) => {
          arg_conversions.push(quote! { let this = cb.unwrap_borrow::<#parent>()?; });
        }
        Some(FnSelf::MutRef) => {
          arg_conversions.push(quote! { let this = cb.unwrap_borrow_mut::<#parent>()?; });
        }
        _ => {}
      };
    }

    self.args.iter().enumerate().for_each(|(i, arg)| {
      let ident = Ident::new(&format!("arg{}", i), Span::call_site());
      let ty = &arg.ty;
      match &*arg.ty {
        syn::Type::Reference(syn::TypeReference {
          mutability: Some(_),
          elem,
          ..
        }) => {
          arg_conversions.push(quote! {
            let #ident = unsafe { #elem::from_napi_mut_ref(env, cb.get_arg(#i))? };
          });
        }
        syn::Type::Reference(syn::TypeReference { elem, .. }) => {
          arg_conversions.push(quote! {
            let #ident = unsafe { #elem::from_napi_ref(env, cb.get_arg(#i))? };
          });
        }
        _ => arg_conversions.push(quote! {
          let #ident = unsafe { #ty::from_napi_value(env, cb.get_arg(#i))? };
        }),
      }

      args.push(ident);
    });

    (arg_conversions, args)
  }

  fn gen_fn_receiver(&self) -> TokenStream {
    let name = &self.name;

    match self.fn_self {
      Some(FnSelf::Value) => {
        // impossible, errord in parser
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
    let ret_ty = &self.ret;

    if self.kind == FnKind::Constructor {
      quote! { cb.construct(#ret) }
    } else if let Some(ref ty) = ret_ty {
      quote! {
        #ty::to_napi_value(env, #ret)
      }
    } else {
      quote! {
        Option::<bool>::to_napi_value(env, None)
      }
    }
  }

  fn gen_fn_register(&self) -> TokenStream {
    if self.parent.is_some() {
      quote! {}
    } else {
      let name_str = self.name.to_string();
      let name_len = name_str.len();
      let module_register_name = get_register_ident(&name_str);
      let intermediate_ident = get_intermediate_ident(&name_str);

      quote! {
        #[allow(clippy::all)]
        #[allow(non_snake_case)]
        #[ctor]
        fn #module_register_name() {
          unsafe fn cb(env: sys::napi_env) -> Result<sys::napi_value> {
            let mut fn_ptr = std::ptr::null_mut();
            let js_name = std::ffi::CString::new(#name_str).unwrap();

            check_status!(
              sys::napi_create_function(
                env,
                js_name.as_ptr(),
                #name_len,
                Some(#intermediate_ident),
                std::ptr::null_mut(),
                &mut fn_ptr,
              ),
              "Failed to register function `{}`",
              #name_str,
            )?;

            Ok(fn_ptr)
          }

          register_module_export(#name_str, cb);
        }
      }
    }
  }
}
