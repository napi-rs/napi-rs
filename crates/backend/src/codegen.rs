use proc_macro2::{Ident, Span, TokenStream};

use crate::{BindgenResult, NapiEnum, NapiFn, NapiImpl, NapiStruct};

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

#[derive(Debug)]
pub struct Napi {
  pub comments: Vec<String>,
  pub item: NapiItem,
}

macro_rules! napi_ast_impl {
  ( $( ($v:ident, $ast:ident), )* ) => {
    #[derive(Debug)]
    pub enum NapiItem {
      $($v($ast)),*
    }

    impl TryToTokens for Napi {
      fn try_to_tokens(&self, tokens: &mut TokenStream) -> BindgenResult<()> {
        match self.item {
          $( NapiItem::$v(ref ast) => ast.try_to_tokens(tokens) ),*
        }
      }
    }
  };
}

napi_ast_impl! {
 (Fn, NapiFn),
 (Struct, NapiStruct),
 (Impl, NapiImpl),
 (Enum, NapiEnum),
}

fn get_intermediate_ident(name: &str) -> Ident {
  let new_name = format!("__napi__{}", name);
  Ident::new(&new_name, Span::call_site())
}

fn get_register_ident(name: &str) -> Ident {
  let new_name = format!("__napi_register__{}", name);
  Ident::new(&new_name, Span::call_site())
}
