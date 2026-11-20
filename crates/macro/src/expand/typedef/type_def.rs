use std::env;
use std::ffi::OsStr;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, OnceLock};

use napi_derive_backend::{BindgenResult, Diagnostic, Napi, ToTypeDef, TypeDef};

static PKG_NAME: LazyLock<String> =
  LazyLock::new(|| env::var("CARGO_PKG_NAME").expect("Expected `CARGO_PKG_NAME` to be set"));
static TYPE_DEF_FOLDER: LazyLock<Option<PathBuf>> = LazyLock::new(|| {
  env::var_os("NAPI_TYPE_DEF_TMP_FOLDER")
    .filter(|v| !v.is_empty())
    .map(PathBuf::from)
});

fn resolve_type_def_file<'a>(
  folder: Option<&OsStr>,
  pkg_name: impl FnOnce() -> &'a str,
  is_bin_target: bool,
  has_legacy_tmp_path: impl FnOnce() -> bool,
) -> Option<PathBuf> {
  if is_bin_target {
    return None;
  }

  if let Some(folder) = folder.filter(|v| !v.is_empty()).map(PathBuf::from) {
    Some(folder.join(pkg_name()))
  } else {
    // the environment variable set by old `@napi-rs/cli`
    if has_legacy_tmp_path() {
      panic!(
        "[napi-rs] missing environment variables. please upgrade `@napi-rs/cli` to the latest version."
      );
    }
    None
  }
}

fn get_type_def_file() -> Option<PathBuf> {
  resolve_type_def_file(
    TYPE_DEF_FOLDER.as_deref().map(Path::as_os_str),
    || &PKG_NAME,
    env::var_os("CARGO_BIN_NAME").is_some(),
    || env::var_os("TYPE_DEF_TMP_PATH").is_some(),
  )
}

pub fn prepare_type_def_file() -> BindgenResult<()> {
  static INIT: OnceLock<Result<(), String>> = OnceLock::new();
  INIT
    .get_or_init(|| match get_type_def_file() {
      Some(file) => init_type_def_file(&file),
      None => Ok(()),
    })
    .as_ref()
    .map(|_| ())
    .map_err(|msg| Diagnostic::error(msg.clone()))
}

fn init_type_def_file(file: &Path) -> Result<(), String> {
  match fs::remove_file(file) {
    Ok(()) => {}
    Err(err) if err.kind() == io::ErrorKind::NotFound => {}
    Err(err) => {
      return Err(format!(
        "Failed to remove existing type def file {}: {err}",
        file.display()
      ));
    }
  }

  fs::OpenOptions::new()
    .write(true)
    .create(true)
    .truncate(true)
    .open(file)
    .map(|_| ())
    .map_err(|err| format!("Failed to create type def file {}: {err}", file.display()))
}

fn append_type_def(file: &Path, type_def: &TypeDef) -> BindgenResult<()> {
  let mut buf = type_def.to_string();
  buf.push('\n');
  fs::OpenOptions::new()
    .append(true)
    .create(true)
    .open(file)
    .and_then(|mut file| file.write_all(buf.as_bytes()))
    .map_err(|err| {
      Diagnostic::error(format!(
        "Failed to write type def file {}: {err}",
        file.display()
      ))
    })
}

pub fn output_type_def(napi: &Napi) -> BindgenResult<()> {
  if let Some(file) = get_type_def_file() {
    if let Some(type_def) = napi.to_type_def() {
      append_type_def(&file, &type_def)?;
    }
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use quote::ToTokens;
  use std::sync::atomic::{AtomicUsize, Ordering};

  struct TempDir(PathBuf);

  impl TempDir {
    fn new(prefix: &str) -> Self {
      static COUNTER: AtomicUsize = AtomicUsize::new(0);
      let dir = env::temp_dir().join(format!(
        "napi-derive-{prefix}-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
      ));
      fs::create_dir_all(&dir).expect("create temp test dir");
      Self(dir)
    }

    fn path(&self) -> &Path {
      &self.0
    }
  }

  impl Drop for TempDir {
    fn drop(&mut self) {
      let _ = fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn empty_env_var_disables_type_def() {
    let resolved = resolve_type_def_file(Some(OsStr::new("")), || "my_crate", false, || false);
    assert_eq!(resolved, None);

    let unset = resolve_type_def_file(None, || "my_crate", false, || false);
    assert_eq!(unset, None);
  }

  #[test]
  fn cargo_bin_name_skips_type_def() {
    let resolved = resolve_type_def_file(
      Some(OsStr::new("/tmp/napi-typedefs")),
      || panic!("PKG_NAME should not be read for binary targets"),
      true,
      || true,
    );
    assert_eq!(resolved, None);
  }

  #[test]
  #[should_panic(expected = "upgrade `@napi-rs/cli`")]
  fn legacy_type_def_tmp_path_panics_when_folder_missing() {
    let _ = resolve_type_def_file(Some(OsStr::new("")), || "my_crate", false, || true);
  }

  #[cfg(unix)]
  #[test]
  fn preserves_non_utf8_folder_path() {
    use std::os::unix::ffi::OsStrExt;

    let raw_folder = OsStr::from_bytes(b"/tmp/napi-\xff-typedefs");
    let resolved = resolve_type_def_file(Some(raw_folder), || "my_crate", false, || false);
    assert_eq!(resolved, Some(PathBuf::from(raw_folder).join("my_crate")));
  }

  #[test]
  fn init_creates_zero_byte_file_and_truncates_existing() {
    let dir = TempDir::new("init");
    let file = dir.path().join("my_crate");

    init_type_def_file(&file).expect("create initial 0-byte typedef file");
    assert!(file.is_file());
    assert_eq!(fs::metadata(&file).unwrap().len(), 0);

    fs::write(&file, "stale typedef line\n").unwrap();
    init_type_def_file(&file).expect("replace stale typedef file with 0-byte file");
    assert!(file.is_file());
    assert_eq!(fs::metadata(&file).unwrap().len(), 0);
  }

  #[cfg(unix)]
  #[test]
  fn init_replaces_dangling_symlink_with_zero_byte_file() {
    use std::os::unix::fs::symlink;

    let dir = TempDir::new("symlink");
    let file = dir.path().join("my_crate");
    let dangling_target = dir.path().join("does-not-exist");
    symlink(&dangling_target, &file).expect("create dangling symlink");

    assert!(
      !file.exists(),
      "dangling symlink reports exists() == false before init"
    );
    assert!(fs::symlink_metadata(&file).is_ok());

    init_type_def_file(&file).expect("replace dangling symlink");

    let meta = fs::symlink_metadata(&file).expect("file metadata after init");
    assert!(meta.file_type().is_file());
    assert!(!meta.file_type().is_symlink());
    assert_eq!(meta.len(), 0);
    assert!(
      !dangling_target.exists(),
      "dangling symlink target must not be created"
    );
  }

  #[test]
  fn append_writes_single_buffer_over_8kib() {
    let dir = TempDir::new("large-write");
    let file = dir.path().join("my_crate");
    init_type_def_file(&file).unwrap();

    let large_def = format!("export type Big = '{}';", "a".repeat(12 * 1024));
    let type_def = TypeDef {
      kind: "type".to_owned(),
      name: "Big".to_owned(),
      def: large_def,
      ..Default::default()
    };
    let expected_line = format!("{type_def}\n");
    assert!(expected_line.len() > 8 * 1024);

    append_type_def(&file, &type_def).expect("write first >8KiB line");
    append_type_def(&file, &type_def).expect("write second >8KiB line");

    let contents = fs::read_to_string(&file).expect("read typedef file");
    assert_eq!(contents, format!("{expected_line}{expected_line}"));
  }

  #[test]
  fn io_errors_are_reported_as_diagnostics() {
    let dir = TempDir::new("io-errors");

    // Parent directory does not exist -> init_type_def_file returns Err
    let missing_parent_file = dir.path().join("missing-subdir").join("my_crate");
    let init_err = init_type_def_file(&missing_parent_file)
      .expect_err("missing parent dir must fail init_type_def_file");
    assert!(init_err.contains("Failed to create type def file"));

    // Existing path is a directory -> fs::remove_file fails with non-NotFound error
    let dir_as_file = dir.path().join("is-a-dir");
    fs::create_dir(&dir_as_file).unwrap();
    let remove_err = init_type_def_file(&dir_as_file)
      .expect_err("directory at target path must fail init_type_def_file");
    assert!(remove_err.contains("Failed to remove existing type def file"));

    // append_type_def returns Err(Diagnostic::error(...)) on I/O failure
    let type_def = TypeDef {
      kind: "fn".to_owned(),
      name: "hello".to_owned(),
      def: "export declare function hello(): void".to_owned(),
      ..Default::default()
    };
    let write_err = append_type_def(&missing_parent_file, &type_def)
      .expect_err("missing parent dir must return Diagnostic error");
    let rendered = write_err.to_token_stream().to_string();
    assert!(rendered.contains("compile_error"));
    assert!(rendered.contains("Failed to write type def file"));
  }
}
