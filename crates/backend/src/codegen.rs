use proc_macro2::{Ident, Span, TokenStream};

use crate::BindgenResult;

mod r#enum;
mod r#fn;
mod r#struct;

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

fn get_register_ident(name: &str) -> Ident {
  let new_name = format!("__napi_register__{}", name);
  Ident::new(&new_name, Span::call_site())
}
