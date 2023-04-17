use proc_macro2::{Ident, Literal};
use syn::{Attribute, Expr, Type};

#[derive(Debug, Clone)]
pub struct NapiFn {
  pub name: Ident,
  pub js_name: String,
  pub attrs: Vec<Attribute>,
  pub args: Vec<NapiFnArg>,
  pub ret: Option<syn::Type>,
  pub is_ret_result: bool,
  pub is_async: bool,
  pub fn_self: Option<FnSelf>,
  pub kind: FnKind,
  pub vis: syn::Visibility,
  pub parent: Option<Ident>,
  pub strict: bool,
  pub return_if_invalid: bool,
  pub js_mod: Option<String>,
  pub ts_generic_types: Option<String>,
  pub ts_args_type: Option<String>,
  pub ts_return_type: Option<String>,
  pub skip_typescript: bool,
  pub comments: Vec<String>,
  pub parent_is_generator: bool,
  pub writable: bool,
  pub enumerable: bool,
  pub configurable: bool,
  pub catch_unwind: bool,
  pub unsafe_: bool,
}

#[derive(Debug, Clone)]
pub struct CallbackArg {
  pub pat: Box<syn::Pat>,
  pub args: Vec<syn::Type>,
  pub ret: Option<syn::Type>,
}

#[derive(Debug, Clone)]
pub struct NapiFnArg {
  pub kind: NapiFnArgKind,
  pub ts_arg_type: Option<String>,
}

impl NapiFnArg {
  /// if type was overridden with `#[napi(ts_arg_type = "...")]` use that instead
  pub fn use_overridden_type_or(&self, default: impl FnOnce() -> String) -> String {
    self.ts_arg_type.as_ref().cloned().unwrap_or_else(default)
  }
}

#[derive(Debug, Clone)]
pub enum NapiFnArgKind {
  PatType(Box<syn::PatType>),
  Callback(Box<CallbackArg>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FnKind {
  Normal,
  Constructor,
  Factory,
  Getter,
  Setter,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FnSelf {
  Value,
  Ref,
  MutRef,
}

#[derive(Debug, Clone)]
pub struct NapiStruct {
  pub name: Ident,
  pub js_name: String,
  pub vis: syn::Visibility,
  pub fields: Vec<NapiStructField>,
  pub is_tuple: bool,
  pub kind: NapiStructKind,
  pub object_from_js: bool,
  pub object_to_js: bool,
  pub js_mod: Option<String>,
  pub comments: Vec<String>,
  pub implement_iterator: bool,
  pub use_custom_finalize: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NapiStructKind {
  None,
  Constructor,
  Object,
}

#[derive(Debug, Clone)]
pub struct NapiStructField {
  pub name: syn::Member,
  pub js_name: String,
  pub ty: syn::Type,
  pub getter: bool,
  pub setter: bool,
  pub writable: bool,
  pub enumerable: bool,
  pub configurable: bool,
  pub comments: Vec<String>,
  pub skip_typescript: bool,
  pub ts_type: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NapiImpl {
  pub name: Ident,
  pub js_name: String,
  pub items: Vec<NapiFn>,
  pub task_output_type: Option<Type>,
  pub iterator_yield_type: Option<Type>,
  pub iterator_next_type: Option<Type>,
  pub iterator_return_type: Option<Type>,
  pub js_mod: Option<String>,
  pub comments: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct NapiEnum {
  pub name: Ident,
  pub js_name: String,
  pub variants: Vec<NapiEnumVariant>,
  pub js_mod: Option<String>,
  pub comments: Vec<String>,
  pub skip_typescript: bool,
}

#[derive(Debug, Clone)]
pub enum NapiEnumValue {
  String(String),
  Number(i32),
}

impl From<&NapiEnumValue> for Literal {
  fn from(val: &NapiEnumValue) -> Self {
    match val {
      NapiEnumValue::String(string) => Literal::string(string),
      NapiEnumValue::Number(number) => Literal::i32_unsuffixed(number.to_owned()),
    }
  }
}

#[derive(Debug, Clone)]
pub struct NapiEnumVariant {
  pub name: Ident,
  pub val: NapiEnumValue,
  pub comments: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct NapiConst {
  pub name: Ident,
  pub js_name: String,
  pub type_name: Type,
  pub value: Expr,
  pub js_mod: Option<String>,
  pub comments: Vec<String>,
  pub skip_typescript: bool,
}

#[derive(Debug, Clone)]
pub struct NapiMod {
  pub name: Ident,
  pub js_name: String,
}
