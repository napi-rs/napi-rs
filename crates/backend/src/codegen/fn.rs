use proc_macro2::{Ident, Span, TokenStream};
use quote::ToTokens;

use crate::{
  codegen::{get_intermediate_ident, get_register_ident},
  BindgenResult, CallbackArg, FnKind, FnSelf, NapiFn, NapiFnArgKind, TryToTokens,
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
  fn gen_arg_conversions(&self) -> (Vec<TokenStream>, Vec<TokenStream>) {
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

    let mut non_callback_arg_count = 0;
    self.args.iter().enumerate().for_each(|(i, arg)| {
      let i = i - non_callback_arg_count;
      let ident = Ident::new(&format!("arg{}", i), Span::call_site());

      match arg {
        NapiFnArgKind::PatType(path) => {
          if &path.ty.to_token_stream().to_string() == "Env" {
            args.push(quote! { Env::from(env) });
            non_callback_arg_count += 1;
          } else {
            arg_conversions.push(NapiFn::gen_ty_arg_conversion(&ident, i, path));
            args.push(quote! { #ident });
          }
        }
        NapiFnArgKind::Callback(cb) => {
          arg_conversions.push(NapiFn::gen_cb_arg_conversion(&ident, i, cb));
          args.push(quote! { #ident });
        }
      }
    });

    (arg_conversions, args)
  }

  fn gen_ty_arg_conversion(arg_name: &Ident, index: usize, path: &syn::PatType) -> TokenStream {
    let ty = &*path.ty;
    match ty {
      syn::Type::Reference(syn::TypeReference {
        mutability: Some(_),
        elem,
        ..
      }) => {
        quote! {
          let #arg_name = unsafe { <#elem as FromNapiMutRef>::from_napi_mut_ref(env, cb.get_arg(#index))? };
        }
      }
      syn::Type::Reference(syn::TypeReference { elem, .. }) => {
        quote! {
          let #arg_name = unsafe { <#elem as FromNapiRef>::from_napi_ref(env, cb.get_arg(#index))? };
        }
      }
      _ => quote! {
        let #arg_name = unsafe { <#ty as FromNapiValue>::from_napi_value(env, cb.get_arg(#index))? };
      },
    }
  }

  fn gen_cb_arg_conversion(arg_name: &Ident, index: usize, cb: &CallbackArg) -> TokenStream {
    let mut inputs = vec![];
    let mut arg_conversions = vec![];

    for (i, ty) in cb.args.iter().enumerate() {
      let cb_arg_ident = Ident::new(&format!("callback_arg_{}", i), Span::call_site());
      inputs.push(quote! { #cb_arg_ident: #ty });
      arg_conversions.push(quote! { <#ty as ToNapiValue>::to_napi_value(env, #cb_arg_ident)? });
    }

    let ret = match &cb.ret {
      Some(ty) => {
        quote! {
          let ret = <#ty as FromNapiValue>::from_napi_value(env, ret_ptr)?;

          Ok(ret)
        }
      }
      None => quote! { Ok(()) },
    };

    quote! {
      let #arg_name = |#(#inputs),*| {
        let args = vec![
          #(#arg_conversions),*
        ];

        let mut ret_ptr = std::ptr::null_mut();

        check_status!(
          sys::napi_call_function(
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
    let js_name = &self.js_name;
    let ret_ty = &self.ret;

    if self.kind == FnKind::Constructor {
      quote! { cb.construct(#js_name, #ret) }
    } else if let Some(ref ty) = ret_ty {
      quote! {
        <#ty as ToNapiValue>::to_napi_value(env, #ret)
      }
    } else {
      quote! {
        <() as ToNapiValue>::to_napi_value(env, ())
      }
    }
  }

  fn gen_fn_register(&self) -> TokenStream {
    if self.parent.is_some() {
      quote! {}
    } else {
      let name_str = self.name.to_string();
      let name_len = name_str.len();
      let js_name = &self.js_name;
      let module_register_name = get_register_ident(&name_str);
      let intermediate_ident = get_intermediate_ident(&name_str);

      quote! {
        #[allow(clippy::all)]
        #[allow(non_snake_case)]
        #[ctor]
        fn #module_register_name() {
          unsafe fn cb(env: sys::napi_env) -> Result<sys::napi_value> {
            let mut fn_ptr = std::ptr::null_mut();
            let js_name = std::ffi::CString::new(#js_name).unwrap();

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

          register_module_export(#js_name, cb);
        }
      }
    }
  }
}
