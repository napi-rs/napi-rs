use proc_macro2::Ident;
use syn::Attribute;

#[derive(Debug, Clone)]
pub struct NapiFn {
  pub name: Ident,
  pub js_name: String,
  pub attrs: Vec<Attribute>,
  pub args: Vec<NapiFnArgKind>,
  pub ret: Option<syn::Type>,
  pub is_async: bool,
  pub fn_self: Option<FnSelf>,
  pub kind: FnKind,
  pub vis: syn::Visibility,
  pub parent: Option<Ident>,
  pub strict: bool,
}

#[derive(Debug, Clone)]
pub struct CallbackArg {
  pub pat: Box<syn::Pat>,
  pub args: Vec<syn::Type>,
  pub ret: Option<syn::Type>,
}

#[derive(Debug, Clone)]
pub enum NapiFnArgKind {
  PatType(Box<syn::PatType>),
  Callback(Box<CallbackArg>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum FnKind {
  Normal,
  Constructor,
  Getter,
  Setter,
}

#[derive(Debug, Clone)]
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
  pub gen_default_ctor: bool,
}

#[derive(Debug, Clone)]
pub struct NapiStructField {
  pub name: syn::Member,
  pub js_name: String,
  pub ty: syn::Type,
  pub getter: bool,
  pub setter: bool,
}

#[derive(Debug, Clone)]
pub struct NapiImpl {
  pub name: Ident,
  pub js_name: String,
  pub items: Vec<NapiFn>,
}

#[derive(Debug, Clone)]
pub struct NapiEnum {
  pub name: Ident,
  pub js_name: String,
  pub variants: Vec<NapiEnumVariant>,
}

#[derive(Debug, Clone)]
pub struct NapiEnumVariant {
  pub name: Ident,
  pub val: i32,
  pub comments: Vec<String>,
}
