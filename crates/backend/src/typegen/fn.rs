use convert_case::{Case, Casing};
use quote::ToTokens;
use std::fmt::{Display, Formatter};
use syn::{Member, Pat, PathArguments, PathSegment};

use super::{r#struct::CLASS_STRUCTS, ty_to_ts_type, ToTypeDef, TypeDef};
use crate::{typegen::JSDoc, CallbackArg, FnKind, NapiFn};

pub(crate) struct FnArg {
  pub(crate) arg: String,
  pub(crate) ts_type: String,
  pub(crate) is_optional: bool,
}

pub(crate) struct FnArgList {
  this: Option<FnArg>,
  args: Vec<FnArg>,
  last_required: Option<usize>,
}

impl Display for FnArgList {
  fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
    if let Some(this) = &self.this {
      write!(f, "this: {}", this.ts_type)?;
    }
    for (i, arg) in self.args.iter().enumerate() {
      if i != 0 || self.this.is_some() {
        write!(f, ", ")?;
      }
      let is_optional = arg.is_optional
        && self
          .last_required
          .is_none_or(|last_required| i > last_required);
      if is_optional {
        write!(f, "{}?: {}", arg.arg, arg.ts_type)?;
      } else {
        write!(f, "{}: {}", arg.arg, arg.ts_type)?;
      }
    }
    Ok(())
  }
}

impl FromIterator<FnArg> for FnArgList {
  fn from_iter<T: IntoIterator<Item = FnArg>>(iter: T) -> Self {
    let mut args = Vec::new();
    let mut this = None;
    for arg in iter.into_iter() {
      if arg.arg != "this" {
        args.push(arg);
      } else {
        this = Some(arg);
      }
    }
    let last_required = args
      .iter()
      .enumerate()
      .rfind(|(_, arg)| !arg.is_optional)
      .map(|(i, _)| i);
    FnArgList {
      this,
      args,
      last_required,
    }
  }
}

impl ToTypeDef for NapiFn {
  fn to_type_def(&self) -> Option<TypeDef> {
    if self.skip_typescript || self.module_exports || self.no_export {
      return None;
    }

    let prefix = self.gen_ts_func_prefix();
    let def = match self.ts_type.as_ref() {
      Some(ts_type) => format!("{prefix} {name}{ts_type}", name = self.js_name),
      None => format!(
        r#"{prefix} {name}{generic}({args}){ret}"#,
        name = &self.js_name,
        generic = &self
          .ts_generic_types
          .as_ref()
          .map(|g| format!("<{g}>"))
          .unwrap_or_default(),
        args = self
          .ts_args_type
          .clone()
          .unwrap_or_else(|| self.gen_ts_func_args()),
        ret = self
          .ts_return_type
          .clone()
          .map(|t| format!(": {t}"))
          .unwrap_or_else(|| self.gen_ts_func_ret()),
      ),
    };

    Some(TypeDef {
      kind: "fn".to_owned(),
      name: self.js_name.clone(),
      original_name: None,
      def,
      js_mod: self.js_mod.to_owned(),
      js_doc: JSDoc::new(&self.comments),
    })
  }
}

fn gen_callback_type(callback: &CallbackArg) -> String {
  format!(
    "({args}) => {ret}",
    args = &callback
      .args
      .iter()
      .enumerate()
      .map(|(i, arg)| {
        let (ts_type, is_optional) = ty_to_ts_type(arg, false, false, false);
        FnArg {
          arg: format!("arg{i}"),
          ts_type,
          is_optional,
        }
      })
      .collect::<FnArgList>(),
    ret = match &callback.ret {
      Some(ty) => ty_to_ts_type(ty, true, false, false).0,
      None => "void".to_owned(),
    }
  )
}

fn gen_ts_func_arg(pat: &Pat) -> String {
  match pat {
    Pat::Struct(s) => format!(
      "{{ {} }}",
      s.fields
        .iter()
        .map(|field| {
          let member_str = match &field.member {
            Member::Named(ident) => ident.to_string(),
            Member::Unnamed(index) => format!("field{}", index.index),
          };
          let nested_str = gen_ts_func_arg(&field.pat);
          if member_str == nested_str {
            member_str.to_case(Case::Camel)
          } else {
            format!("{}: {}", member_str.to_case(Case::Camel), nested_str)
          }
        })
        .collect::<Vec<_>>()
        .join(", ")
        .as_str()
    ),
    Pat::TupleStruct(ts) => format!(
      "{{ {} }}",
      ts.elems
        .iter()
        .enumerate()
        .map(|(index, elem)| {
          let member_str = format!("field{index}");
          let nested_str = gen_ts_func_arg(elem);
          format!("{member_str}: {nested_str}")
        })
        .collect::<Vec<_>>()
        .join(", "),
    ),
    Pat::Tuple(t) => format!(
      "[{}]",
      t.elems
        .iter()
        .map(gen_ts_func_arg)
        .collect::<Vec<_>>()
        .join(", ")
    ),
    Pat::Wild(_) => "_".to_string(),
    _ => pat.to_token_stream().to_string().to_case(Case::Camel),
  }
}

impl NapiFn {
  fn gen_ts_func_args(&self) -> String {
    format!(
      "{}",
      self
        .args
        .iter()
        .filter_map(|arg| match &arg.kind {
          crate::NapiFnArgKind::PatType(path) => {
            let ty_string = path.ty.to_token_stream().to_string();
            if ty_string == "Env" {
              return None;
            }
            if let syn::Type::Reference(syn::TypeReference { elem, .. }) = &*path.ty {
              if let syn::Type::Path(path) = elem.as_ref() {
                if let Some(PathSegment { ident, .. }) = path.path.segments.last() {
                  if ident == "Env" {
                    return None;
                  }
                }
              }
            }
            if let syn::Type::Path(path) = path.ty.as_ref() {
              if let Some(PathSegment { ident, arguments }) = path.path.segments.last() {
                if ident == "Reference" || ident == "WeakReference" {
                  if let Some(parent) = &self.parent {
                    if let PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments {
                      args: angle_bracketed_args,
                      ..
                    }) = arguments
                    {
                      if let Some(syn::GenericArgument::Type(syn::Type::Path(syn::TypePath {
                        path,
                        ..
                      }))) = angle_bracketed_args.first()
                      {
                        if let Some(segment) = path.segments.first() {
                          if *parent == segment.ident {
                            // If we have a Reference<A> in an impl A block, it shouldn't be an arg
                            return None;
                          }
                        }
                      }
                    }
                  }
                }
                if ident == "This" || ident == "this" {
                  if self.kind != FnKind::Normal {
                    return None;
                  }
                  if let PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments {
                    args: angle_bracketed_args,
                    ..
                  }) = arguments
                  {
                    if let Some(syn::GenericArgument::Type(ty)) = angle_bracketed_args.first() {
                      let (ts_type, _) = ty_to_ts_type(ty, false, false, false);
                      return Some(FnArg {
                        arg: "this".to_owned(),
                        ts_type,
                        is_optional: false,
                      });
                    }
                  } else {
                    return Some(FnArg {
                      arg: "this".to_owned(),
                      ts_type: "this".to_owned(),
                      is_optional: false,
                    });
                  }
                  return None;
                }
              }
            }

            let mut path = path.clone();
            // remove mutability from PatIdent
            if let Pat::Ident(i) = path.pat.as_mut() {
              i.mutability = None;
            }

            let (ts_type, is_optional) = ty_to_ts_type(&path.ty, false, false, false);
            let ts_type = arg.use_overridden_type_or(|| ts_type);
            let arg = gen_ts_func_arg(&path.pat);
            Some(FnArg {
              arg,
              ts_type,
              is_optional,
            })
          }
          crate::NapiFnArgKind::Callback(cb) => {
            let ts_type = arg.use_overridden_type_or(|| gen_callback_type(cb));
            let arg = cb.pat.to_token_stream().to_string().to_case(Case::Camel);

            Some(FnArg {
              arg,
              ts_type,
              is_optional: false,
            })
          }
        })
        .collect::<FnArgList>()
    )
  }

  fn gen_ts_func_prefix(&self) -> &'static str {
    if self.parent.is_some() {
      match self.kind {
        crate::FnKind::Normal => match self.fn_self {
          Some(_) => "",
          None => "static",
        },
        crate::FnKind::Factory => "static",
        crate::FnKind::Constructor => "",
        crate::FnKind::Getter => "get",
        crate::FnKind::Setter => "set",
      }
    } else {
      "function"
    }
  }

  fn gen_ts_func_ret(&self) -> String {
    match self.kind {
      FnKind::Constructor | FnKind::Setter => "".to_owned(),
      FnKind::Factory => self
        .parent
        .clone()
        .map(|i| {
          let origin_name = i.to_string();
          let parent = CLASS_STRUCTS
            .with_borrow(|c| c.get(&origin_name).cloned())
            .unwrap_or_else(|| origin_name.to_case(Case::Pascal));

          if self.is_async {
            format!(": Promise<{parent}>")
          } else {
            format!(": {parent}")
          }
        })
        .unwrap_or_else(|| "".to_owned()),
      _ => {
        let ret = if let Some(ret) = &self.ret {
          let (ts_type, _) = ty_to_ts_type(ret, true, false, false);
          if ts_type == "undefined" {
            "void".to_owned()
          } else if ts_type == "Self" {
            "this".to_owned()
          } else {
            ts_type
          }
        } else {
          "void".to_owned()
        };
        if self.is_async {
          format!(": Promise<{ret}>")
        } else {
          format!(": {ret}")
        }
      }
    }
  }
}
