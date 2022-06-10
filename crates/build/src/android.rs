use std::env;
use std::fs;
use std::io::{Error, Write};
use std::path;

// Workaround from https://github.com/rust-lang/rust/pull/85806#issuecomment-1096266946
pub fn setup() -> Result<(), Error> {
  let out_dir = env::var("OUT_DIR").expect("OUT_DIR not set");
  let mut dist = path::PathBuf::from(&out_dir);
  dist.push("libgcc.a");
  let mut libgcc = fs::File::create(&dist)?;
  let _ = libgcc.write(b"INPUT(-lunwind)")?;
  drop(libgcc);
  println!("cargo:rustc-link-search={}", &out_dir);
  Ok(())
}
