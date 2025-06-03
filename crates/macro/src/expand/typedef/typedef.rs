use std::cell::LazyCell;
use std::env;
use std::env::VarError;
use std::fs;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

use napi_derive_backend::{Napi, ToTypeDef};

const PKG_NAME: LazyCell<String> =
  LazyCell::new(|| env::var("CARGO_PKG_NAME").expect("Expected `CARGO_PKG_NAME` to be set"));
const TYPE_DEF_FOLDER: LazyCell<Result<String, VarError>> =
  LazyCell::new(|| env::var("TYPE_DEF_TMP_FOLDER"));

fn get_type_def_file() -> Option<PathBuf> {
  if let Ok(folder) = TYPE_DEF_FOLDER.as_deref() {
    let file = PathBuf::from(folder).join(&*PKG_NAME);
    Some(file)
  } else {
    if let Ok(_) = env::var("TYPE_DEF_TMP_PATH") {
      panic!("Expected `TYPE_DEF_TMP_FOLDER` to be set. It may caused by an older version of '@napi-rs/cli' used. Please upgrade to the latest version.");
    }
    None
  }
}

pub fn prepare_type_def_file() {
  remove_existed_def_file();
}

fn remove_existed_def_file() {
  if let Some(file) = get_type_def_file() {
    if file.exists() {
      if let Err(_e) = fs::remove_file(&file) {
        #[cfg(debug_assertions)]
        {
          println!("Failed to manipulate type def file {:?}: {:?}", file, _e);
        }
      }
    }
  }
}

pub fn output_type_def(napi: &Napi) {
  if let Some(file) = get_type_def_file() {
    if let Some(type_def) = napi.to_type_def() {
      fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&file)
        .and_then(|file| {
          let mut writer = BufWriter::<fs::File>::new(file);
          writer.write_all(type_def.to_string().as_bytes())?;
          writer.write_all("\n".as_bytes())?;
          writer.flush()
        })
        .unwrap_or_else(|e| {
          println!("Failed to write type def file: {:?}", e);
        });
    }
  }
}
