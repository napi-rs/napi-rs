use proc_macro2::TokenStream;
use quote::ToTokens;

use crate::{BindgenResult, NapiType, TryToTokens};

impl TryToTokens for NapiType {
  fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()> {
    (quote! {}).to_tokens(tokens);
    Ok(())
  }
}
