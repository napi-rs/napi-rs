use convert_case::{Case, Casing};
use quote::ToTokens;

use super::{ty_to_ts_type, ToTypeDef, TypeDef};
use crate::{CallbackArg, FnKind, NapiFn};

impl ToTypeDef for NapiFn {
  fn to_type_def(&self) -> TypeDef {
    let def = format!(
      r#"{prefix} {name}({args}){ret}"#,
      prefix = self.gen_ts_func_prefix(),
      name = &self.js_name,
      args = self.gen_ts_func_args(),
      ret = self.gen_ts_func_ret(),
    );

    TypeDef {
      kind: "fn".to_owned(),
      name: self.js_name.clone(),
      def,
    }
  }
}

fn gen_callback_type(callback: &CallbackArg) -> String {
  format!(
    "({args}) => {ret}",
    args = &callback
      .args
      .iter()
      .enumerate()
      .map(|(i, arg)| { format!("arg{}: {}", i, ty_to_ts_type(arg)) })
      .collect::<Vec<_>>()
      .join(", "),
    ret = match &callback.ret {
      Some(ty) => ty_to_ts_type(ty),
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
          let mut arg = path.pat.to_token_stream().to_string().to_case(Case::Camel);
          arg.push_str(": ");
          arg.push_str(&ty_to_ts_type(&path.ty));

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
      _ => {
        let ret = if let Some(ref ret) = self.ret {
          ty_to_ts_type(ret)
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
