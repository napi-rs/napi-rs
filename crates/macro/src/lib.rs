mod parser;

#[macro_use]
extern crate syn;
#[macro_use]
extern crate backend;
#[macro_use]
extern crate quote;
use backend::{Diagnostic, TryToTokens};
use parser::ParseNapi;
use proc_macro::TokenStream as RawStream;
use proc_macro2::TokenStream;
use std::env;

/// ```ignore
/// #[napi]
/// fn test(ctx: CallContext, name: String) {
///   "hello" + name
/// }
/// ```
#[proc_macro_attribute]
pub fn napi(attr: RawStream, input: RawStream) -> RawStream {
  match expand(attr.into(), input.into()) {
    Ok(tokens) => {
      if env::var("DEBUG_GENERATED_CODE").is_ok() {
        println!("{}", tokens.to_string());
      }
      tokens.into()
    }
    Err(diagnostic) => {
      println!("`napi` macro expand failed.");

      (quote! { #diagnostic }).into()
    }
  }
}

fn expand(attr: TokenStream, input: TokenStream) -> Result<TokenStream, Diagnostic> {
  let mut item = syn::parse2::<syn::Item>(input)?;
  let opts = syn::parse2(attr)?;

  let mut tokens = proc_macro2::TokenStream::new();

  let napi = item.parse_napi(&mut tokens, opts)?;
  napi.try_to_tokens(&mut tokens)?;

  Ok(tokens)
}
