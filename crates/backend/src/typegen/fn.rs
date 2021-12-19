use convert_case::{Case, Casing};
use quote::ToTokens;
use syn::Pat;

use super::{ty_to_ts_type, ToTypeDef, TypeDef};
use crate::{js_doc_from_comments, CallbackArg, FnKind, NapiFn};

impl ToTypeDef for NapiFn {
  fn to_type_def(&self) -> Option<TypeDef> {
    if self.skip_typescript {
      return None;
    }

    let def = format!(
      r#"{prefix} {name}({args}){ret}"#,
      prefix = self.gen_ts_func_prefix(),
      name = &self.js_name,
      args = self
        .ts_args_type
        .clone()
        .unwrap_or_else(|| self.gen_ts_func_args()),
      ret = self
        .ts_return_type
        .clone()
        .map(|t| format!(": {}", t))
        .unwrap_or_else(|| self.gen_ts_func_ret()),
    );

    Some(TypeDef {
      kind: "fn".to_owned(),
      name: self.js_name.clone(),
      def,
      js_mod: self.js_mod.to_owned(),
      js_doc: js_doc_from_comments(&self.comments),
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
        let (arg, is_optional) = ty_to_ts_type(arg, false);
        if is_optional {
          format!("arg{}?: {}", i, arg)
        } else {
          format!("arg{}: {}", i, arg)
        }
      })
      .collect::<Vec<_>>()
      .join(", "),
    ret = match &callback.ret {
      Some(ty) => ty_to_ts_type(ty, true).0,
      None => "void".to_owned(),
    }
  )
}

impl NapiFn {
  fn gen_ts_func_args(&self) -> String {
    self
      .args
      .iter()
      .filter_map(|arg| match arg {
        crate::NapiFnArgKind::PatType(path) => {
          if path.ty.to_token_stream().to_string() == "Env" {
            return None;
          }
          let mut path = path.clone();
          // remove mutability from PatIdent
          if let Pat::Ident(i) = path.pat.as_mut() {
            i.mutability = None;
          }
          let mut arg = path.pat.to_token_stream().to_string().to_case(Case::Camel);
          let (ts_arg, is_optional) = ty_to_ts_type(&path.ty, false);
          arg.push_str(if is_optional { "?: " } else { ": " });
          arg.push_str(&ts_arg);

          Some(arg)
        }
        crate::NapiFnArgKind::Callback(cb) => {
          let mut arg = cb.pat.to_token_stream().to_string().to_case(Case::Camel);
          arg.push_str(": ");
          arg.push_str(&gen_callback_type(cb));

          Some(arg)
        }
      })
      .collect::<Vec<_>>()
      .join(", ")
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
      "export function"
    }
  }

  fn gen_ts_func_ret(&self) -> String {
    match self.kind {
      FnKind::Constructor | FnKind::Setter => "".to_owned(),
      FnKind::Factory => self
        .parent
        .clone()
        .map(|i| format!(": {}", i.to_string().to_case(Case::Pascal)))
        .unwrap_or_else(|| "".to_owned()),
      _ => {
        let ret = if let Some(ret) = &self.ret {
          let (ts_type, _) = ty_to_ts_type(ret, true);
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
          format!(": Promise<{}>", ret)
        } else {
          format!(": {}", ret)
        }
      }
    }
  }
}
