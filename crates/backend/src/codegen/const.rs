use proc_macro2::{Ident, Literal, TokenStream};
use quote::ToTokens;

use crate::{codegen::js_mod_to_token_stream, BindgenResult, NapiConst, TryToTokens};

impl TryToTokens for NapiConst {
  fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()> {
    let register = self.gen_module_register();
    (quote! {
      #register
    })
    .to_tokens(tokens);

    Ok(())
  }
}

impl NapiConst {
  fn gen_module_register(&self) -> TokenStream {
    if cfg!(test) {
      return quote! {};
    }

    let name_ident = &self.name;
    let js_name_lit = Literal::string(&format!("{}\0", self.name));
    let register_name = &self.register_name;
    let type_name = &self.type_name;
    let cb_name = Ident::new(
      &format!("__register__const__{register_name}_callback__"),
      self.name.span(),
    );
    let js_mod_ident = js_mod_to_token_stream(self.js_mod.as_ref());

    quote! {
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      unsafe fn #cb_name(env: napi::sys::napi_env) -> napi::Result<napi::sys::napi_value> {
        <#type_name as napi::bindgen_prelude::ToNapiValue>::to_napi_value(env, #name_ident)
      }
      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      #[cfg(all(not(test), not(target_family = "wasm")))]
      #[napi::ctor::ctor(crate_path=::napi::ctor)]
      fn #register_name() {
        napi::bindgen_prelude::register_module_export(#js_mod_ident, #js_name_lit, #cb_name);
      }

      #[allow(non_snake_case)]
      #[allow(clippy::all)]
      #[cfg(all(not(test), target_family = "wasm"))]
      #[no_mangle]
      unsafe extern "C" fn #register_name() {
        napi::bindgen_prelude::register_module_export(#js_mod_ident, #js_name_lit, #cb_name);
      }
    }
  }
}
