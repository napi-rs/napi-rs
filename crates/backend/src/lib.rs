#[macro_use]
extern crate quote;

use proc_macro2::TokenStream;

#[macro_use]
pub mod error;
pub mod ast;
pub mod codegen;
#[cfg(feature = "type-def")]
pub mod typegen;

pub use ast::*;
pub use codegen::*;
pub use error::{BindgenResult, Diagnostic};
#[cfg(feature = "type-def")]
pub use typegen::*;

#[derive(Debug)]
pub struct Napi {
  pub item: NapiItem,
}

macro_rules! napi_ast_impl {
  ( $( ($v:ident, $ast:ident), )* ) => {
    #[derive(Debug)]
    #[allow(clippy::large_enum_variant)]
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

		#[cfg(feature = "type-def")]
		impl ToTypeDef for Napi {
			fn to_type_def(&self) -> Option<TypeDef> {
				match self.item {
          $( NapiItem::$v(ref ast) => ast.to_type_def() ),*
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
 (Const, NapiConst),
}
