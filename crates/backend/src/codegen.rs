use proc_macro2::{Ident, Span, TokenStream};

use crate::BindgenResult;

mod r#const;
mod r#enum;
mod r#fn;
mod r#struct;

pub use r#struct::rm_raw_prefix;

pub const PROPERTY_ATTRIBUTE_DEFAULT: i32 = 0;
pub const PROPERTY_ATTRIBUTE_WRITABLE: i32 = 1 << 0;
pub const PROPERTY_ATTRIBUTE_ENUMERABLE: i32 = 1 << 1;
pub const PROPERTY_ATTRIBUTE_CONFIGURABLE: i32 = 1 << 2;

pub trait TryToTokens {
  fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()>;

  fn try_to_token_stream(&self) -> BindgenResult<TokenStream> {
    let mut tokens = TokenStream::default();
    self.try_to_tokens(&mut tokens)?;

    Ok(tokens)
  }
}

fn get_intermediate_ident(name: &str) -> Ident {
  let new_name = format!("__napi__{}", name);
  Ident::new(&new_name, Span::call_site())
}

fn js_mod_to_token_stream(js_mod: Option<&String>) -> TokenStream {
  js_mod
    .map(|i| {
      let i = format!("{}\0", i);
      quote! { Some(#i) }
    })
    .unwrap_or_else(|| quote! { None })
}
