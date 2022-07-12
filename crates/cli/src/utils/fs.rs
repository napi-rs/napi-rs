use std::{
  fs::{create_dir_all, File},
  io::{Error, Write},
  path::Path,
};

use log::info;

pub fn write_file<P: AsRef<Path>, C: AsRef<str>>(path: P, content: C) -> Result<(), Error> {
  let path = path.as_ref();
  let content = content.as_ref();
  info!("Write file: {}", path.display());
  let dir = path.parent().unwrap();
  create_dir_all(dir)?;
  let mut file = File::create(path)?;
  file.write_all(content.as_bytes())?;

  Ok(())
}
