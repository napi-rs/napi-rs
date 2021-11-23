use proc_macro2::TokenStream;

use crate::{NapiMod, TryToTokens};

impl TryToTokens for NapiMod {
  fn try_to_tokens(&self, _tokens: &mut TokenStream) -> crate::BindgenResult<()> {
    Ok(())
  }
}
