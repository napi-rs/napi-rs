use std::{
  env,
  ffi::OsStr,
  fs,
  path::{Path, PathBuf},
  process::Command,
};

fn rustc_sysroot(rustc: &OsStr) -> Result<PathBuf, String> {
  let output = Command::new(rustc)
    .args(["--print", "sysroot"])
    .output()
    .map_err(|err| format!("failed to execute {}: {err}", rustc.to_string_lossy()))?;
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    return Err(format!(
      "{} --print sysroot exited with {}: {}",
      rustc.to_string_lossy(),
      output.status,
      stderr.trim()
    ));
  }
  let stdout = String::from_utf8(output.stdout)
    .map_err(|err| format!("rustc returned a non-UTF-8 sysroot: {err}"))?;
  let sysroot = stdout.trim();
  if sysroot.is_empty() {
    return Err("rustc returned an empty sysroot".to_owned());
  }
  Ok(PathBuf::from(sysroot))
}

fn reactor_crt_path(sysroot: &Path, target: &str) -> PathBuf {
  sysroot
    .join("lib")
    .join("rustlib")
    .join(target)
    .join("lib")
    .join("self-contained")
    .join("crt1-reactor.o")
}

fn wasi_sysroot_lib_dir(wasi_sdk_path: &Path, wasi_target: &str) -> PathBuf {
  wasi_sdk_path
    .join("share")
    .join("wasi-sysroot")
    .join("lib")
    .join(wasi_target)
}

fn emnapi_link_library(has_threads: bool) -> &'static str {
  // The `napi-rs` archive variants reference `napi_*` symbols through the
  // default `env` wasm import module, matching the plain `extern "C"`
  // declarations in `crates/sys` (only `napi_add_env_cleanup_hook` and
  // `napi_remove_env_cleanup_hook` use the `napi` import module, see
  // `crates/napi/src/lib.rs`). The plain `libemnapi(-mt).a` archives use the
  // `napi` import module for every `napi_*` reference and do not link against
  // the Rust objects.
  //
  // The threaded archive (`emnapi-napi-rs-mt`) ships the FULL emnapi
  // composition: the C `async_work.c` / `threadsafe_function.c`
  // implementations backed by the uv threadpool, matching emscripten's
  // `emnapi-mt`. The non-threaded archive (`emnapi-basic-napi-rs`) follows
  // the "basic" model: async work and thread-safe functions stay wasm
  // imports resolved by the `@emnapi/core/plugins` JavaScript
  // implementations that every generated loader wires up.
  if has_threads {
    "emnapi-napi-rs-mt"
  } else {
    "emnapi-basic-napi-rs"
  }
}

/// Export that the reactor startup object contributes.
const REACTOR_INIT_EXPORT: &str = "_initialize";

fn read_leb128_u32(bytes: &[u8], cursor: &mut usize) -> Option<u32> {
  let mut result: u32 = 0;
  let mut shift = 0;
  loop {
    let byte = *bytes.get(*cursor)?;
    *cursor += 1;
    result |= u32::from(byte & 0x7f).checked_shl(shift)?;
    if byte & 0x80 == 0 {
      return Some(result);
    }
    shift += 7;
    if shift > 31 {
      return None;
    }
  }
}

/// Whether a wasm module exports `_initialize`.
///
/// The name also occurs inside the linked standard library, so searching the
/// whole module for the string matches whether or not the startup object was
/// linked. Only the export section answers the question.
fn wasm_exports_reactor_init(module: &[u8]) -> bool {
  const EXPORT_SECTION_ID: u8 = 7;
  if module.len() < 8 || &module[..4] != b"\0asm" {
    return false;
  }
  let mut cursor = 8;
  while cursor < module.len() {
    let Some(&section_id) = module.get(cursor) else {
      return false;
    };
    cursor += 1;
    let Some(section_len) = read_leb128_u32(module, &mut cursor) else {
      return false;
    };
    let section_end = cursor + section_len as usize;
    if section_end > module.len() {
      return false;
    }
    if section_id == EXPORT_SECTION_ID {
      let Some(count) = read_leb128_u32(module, &mut cursor) else {
        return false;
      };
      for _ in 0..count {
        let Some(name_len) = read_leb128_u32(module, &mut cursor) else {
          return false;
        };
        let name_end = cursor + name_len as usize;
        let Some(name) = module.get(cursor..name_end) else {
          return false;
        };
        if name == REACTOR_INIT_EXPORT.as_bytes() {
          return true;
        }
        // name, then the export kind byte, then the index.
        cursor = name_end + 1;
        if read_leb128_u32(module, &mut cursor).is_none() {
          return false;
        }
      }
      return false;
    }
    cursor = section_end;
  }
  false
}

/// The `-C link-self-contained` flags Cargo will use for the real link.
///
/// `link-self-contained=no` tells rustc to leave out its own crt objects, so
/// a probe run without the flag would see `_initialize` and wrongly report
/// that rustc supplies the startup object. The real link would then have
/// neither ours nor rustc's, and the module would silently ship without the
/// export.
///
/// Only this one flag is forwarded. Passing the user's whole rustflags would
/// break the probe on anything that does not apply to an empty crate — a
/// `-C link-arg=--export=napi_register_wasm_v1` alone makes the probe fail to
/// link, which turns into `None` and brings back the duplicate symbol on a
/// toolchain that does supply the object.
///
/// Cargo hands build scripts `CARGO_ENCODED_RUSTFLAGS`, never `RUSTFLAGS`,
/// and separates arguments with a unit separator.
fn link_self_contained_flags() -> Vec<String> {
  env::var("CARGO_ENCODED_RUSTFLAGS")
    .map(|encoded| parse_link_self_contained_flags(&encoded))
    .unwrap_or_default()
}

/// Picks the `-C link-self-contained` flags out of `CARGO_ENCODED_RUSTFLAGS`.
fn parse_link_self_contained_flags(encoded: &str) -> Vec<String> {
  const FLAG: &str = "link-self-contained=";
  // Splitting an empty string yields one empty element, not none.
  if encoded.is_empty() {
    return Vec::new();
  }
  let mut flags = Vec::new();
  let mut args = encoded.split('\u{1f}').peekable();
  while let Some(arg) = args.next() {
    // Cargo emits either `-C` followed by the value, or one glued `-C<value>`.
    if arg == "-C" {
      if let Some(value) = args.peek() {
        if value.starts_with(FLAG) {
          flags.push("-C".to_owned());
          flags.push((*value).to_owned());
        }
      }
    } else if let Some(value) = arg.strip_prefix("-C") {
      if value.starts_with(FLAG) {
        flags.push(arg.to_owned());
      }
    }
  }
  flags
}

/// Whether `rustc` already contributes the reactor startup object itself.
///
/// rust-lang/rust#161421 added `crt1-reactor.o` to the pre-link crt objects
/// for the dylib output kinds on WASI, landing in Rust 1.100. It was omitted
/// before that, which is why this crate passes the object by hand to obtain
/// the conventional `_initialize`. Passing it to a toolchain that already
/// links it makes `wasm-ld` fail with `duplicate symbol: _initialize`.
///
/// Probe instead of comparing versions: link a trivial `cdylib` for the target
/// and look at its exports. One short `rustc` invocation, exact on every
/// channel, and no guessing about nightly dates.
///
/// Returns `None` when the probe cannot run, so the caller keeps the previous
/// behaviour rather than dropping a startup object the toolchain needs.
fn rustc_links_reactor_crt(rustc: &OsStr, target: &str, out_dir: &Path) -> Option<bool> {
  let source = out_dir.join("napi_build_reactor_probe.rs");
  let artifact = out_dir.join("napi_build_reactor_probe.wasm");
  fs::write(&source, b"").ok()?;
  let output = Command::new(rustc)
    .args(["--crate-type", "cdylib", "--target", target])
    .args(["-C", "debuginfo=0"])
    .args(link_self_contained_flags())
    .arg("-o")
    .arg(&artifact)
    .arg(&source)
    .output()
    .ok()?;
  if !output.status.success() {
    return None;
  }
  let module = fs::read(&artifact).ok()?;
  Some(wasm_exports_reactor_init(&module))
}

pub fn setup() {
  let link_dir = env::var("EMNAPI_LINK_DIR").expect("EMNAPI_LINK_DIR must be set");
  let target = env::var("TARGET").expect("TARGET must be set by Cargo");
  let has_threads = matches!(
    target.as_str(),
    "wasm32-wasi" | "wasm32-wasi-preview1-threads" | "wasm32-wasip1-threads"
  ) || target.ends_with("-threads");

  println!("cargo:rerun-if-env-changed=CARGO_ENCODED_RUSTFLAGS");
  println!("cargo:rerun-if-env-changed=EMNAPI_LINK_DIR");
  println!("cargo:rerun-if-env-changed=RUSTC");
  println!("cargo:rerun-if-env-changed=TARGET");
  println!("cargo:rerun-if-env-changed=WASI_SDK_PATH");
  println!("cargo:rustc-link-search={link_dir}");
  let emnapi_library = emnapi_link_library(has_threads);
  let emnapi_archive = Path::new(&link_dir).join(format!("lib{emnapi_library}.a"));
  assert!(
    emnapi_archive.is_file(),
    "emnapi archive for {target} is missing at {}. Install emnapi v2 with support for the {target} archive",
    emnapi_archive.display()
  );
  println!("cargo:rustc-link-lib=static={emnapi_library}");
  println!("cargo:rustc-link-arg=--export=malloc");
  println!("cargo:rustc-link-arg=--export=free");
  // `@emnapi/core` v2 creates and destroys the native environment through
  // these archive-defined exports during `napiModule.init()`; without them
  // loading fails at runtime with `_emnapi_create_env is not a function`.
  println!("cargo:rustc-link-arg=--export=emnapi_create_env");
  println!("cargo:rustc-link-arg=--export=emnapi_delete_env");
  println!("cargo:rustc-link-arg=--export=napi_register_wasm_v1");
  // `napi` defines `napi_prepare_wasm_env_cleanup`, but `napi-build` and `napi`
  // are versioned independently: a new `napi-build` can be unified with a `napi`
  // that predates the symbol. Keep the export conditional so that combination
  // still links instead of failing with an unresolved export. The generated
  // loaders guard the call with `typeof … === 'function'` for the same reason,
  // which is why `examples/napi/__tests__/wasi-env-cleanup-export.spec.ts`
  // asserts the export really is present in the built artifact — a missing
  // barrier is otherwise completely silent.
  println!("cargo:rustc-link-arg=--export-if-defined=napi_prepare_wasm_env_cleanup");
  // The settlement half of the same barrier: the loaders poll it to know when the settles the
  // barrier queued have actually been dispatched, instead of destroying the environment while
  // they are still in the threadsafe-function queue. Conditional for the same reason.
  println!("cargo:rustc-link-arg=--export-if-defined=napi_wasm_env_cleanup_pending");
  println!("cargo:rustc-link-arg=--export-if-defined=node_api_module_get_api_version_v1");
  println!("cargo:rustc-link-arg=--export-table");
  if has_threads {
    println!("cargo:rustc-link-arg=--export-if-defined=emnapi_async_worker_create");
    println!("cargo:rustc-link-arg=--export-if-defined=emnapi_async_worker_init");
  }
  println!("cargo:rustc-link-arg=--export-if-defined=emnapi_thread_crashed");
  println!("cargo:rustc-link-arg=--import-memory");
  println!("cargo:rustc-link-arg=--import-undefined");
  println!("cargo:rustc-link-arg=--max-memory=4294967296");
  // lld only allocates 1MiB for the WebAssembly stack.
  // 64000000 bytes = 64MiB
  println!("cargo:rustc-link-arg=-zstack-size=64000000");
  println!("cargo:rustc-link-arg=--no-check-features");

  let rustc = env::var_os("RUSTC").expect("RUSTC must be set by Cargo");
  let sysroot = rustc_sysroot(&rustc).unwrap_or_else(|error| {
    panic!(
      "failed to locate crt1-reactor.o for {target}: {error}. Ensure RUSTC points to the compiler Cargo is using"
    )
  });
  let out_dir = env::var_os("OUT_DIR").map(PathBuf::from);
  let rustc_supplies_reactor_crt = out_dir
    .as_deref()
    .and_then(|out_dir| rustc_links_reactor_crt(&rustc, &target, out_dir))
    .unwrap_or(false);
  if !rustc_supplies_reactor_crt {
    let crt_reactor_path = reactor_crt_path(&sysroot, &target);
    assert!(
      crt_reactor_path.is_file(),
      "failed to locate crt1-reactor.o for {target} at {}. Install the Rust standard library for this target",
      crt_reactor_path.display()
    );
    println!("cargo:rustc-link-arg={}", crt_reactor_path.display());
    println!("cargo:rustc-link-arg=--export={REACTOR_INIT_EXPORT}");
  }

  if let Ok(wasi_sdk_path) = env::var("WASI_SDK_PATH") {
    let wasi_target = if has_threads {
      "wasm32-wasip1-threads"
    } else {
      "wasm32-wasip1"
    };
    let wasi_lib_dir = wasi_sysroot_lib_dir(Path::new(&wasi_sdk_path), wasi_target);
    println!("cargo:rustc-link-search=native={}", wasi_lib_dir.display());
    if wasi_lib_dir.join("libsetjmp.a").is_file() {
      println!("cargo:rustc-link-lib=static=setjmp");
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn resolves_bare_rustc_through_path() {
    let sysroot = rustc_sysroot(OsStr::new("rustc")).expect("failed to resolve rustc from PATH");
    assert!(sysroot.is_absolute());
    assert!(sysroot.is_dir());
  }

  #[test]
  fn constructs_reactor_crt_path_from_sysroot() {
    assert_eq!(
      reactor_crt_path(Path::new("/toolchain"), "wasm32-wasip1-threads"),
      Path::new("/toolchain")
        .join("lib")
        .join("rustlib")
        .join("wasm32-wasip1-threads")
        .join("lib")
        .join("self-contained")
        .join("crt1-reactor.o")
    );
  }

  fn wasm_with_exports(names: &[&str]) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.push(names.len() as u8);
    for name in names {
      payload.push(name.len() as u8);
      payload.extend_from_slice(name.as_bytes());
      payload.push(0x00); // function
      payload.push(0x00); // index
    }
    let mut module = b"\0asm\x01\x00\x00\x00".to_vec();
    module.push(7); // export section
    module.push(payload.len() as u8);
    module.extend_from_slice(&payload);
    module
  }

  #[test]
  fn detects_the_reactor_init_export() {
    assert!(wasm_exports_reactor_init(&wasm_with_exports(&[
      "memory",
      "_initialize",
      "hello"
    ])));
  }

  #[test]
  fn ignores_a_module_without_the_reactor_init_export() {
    assert!(!wasm_exports_reactor_init(&wasm_with_exports(&[
      "memory",
      "hello",
      "wasi_thread_start"
    ])));
  }

  #[test]
  fn rejects_input_that_is_not_wasm() {
    assert!(!wasm_exports_reactor_init(b""));
    assert!(!wasm_exports_reactor_init(b"not a wasm module at all"));
    // Truncated section length must not panic or read out of bounds.
    assert!(!wasm_exports_reactor_init(b"\0asm\x01\x00\x00\x00\x07\x7f"));
  }

  #[test]
  fn skips_sections_before_the_export_section() {
    let mut module = b"\0asm\x01\x00\x00\x00".to_vec();
    // A type section holding a byte that would otherwise look like a name.
    module.push(1);
    module.push(1);
    module.push(0x60);
    module.extend_from_slice(&wasm_with_exports(&["_initialize"])[8..]);
    assert!(wasm_exports_reactor_init(&module));
  }

  #[test]
  fn preserves_spaces_in_wasi_sysroot_path() {
    let path = wasi_sysroot_lib_dir(Path::new("/toolchains/WASI SDK"), "wasm32-wasip1-threads");
    assert_eq!(
      path,
      Path::new("/toolchains/WASI SDK/share/wasi-sysroot/lib/wasm32-wasip1-threads")
    );
  }

  #[test]
  fn selects_v2_emnapi_archives_by_threading_model() {
    assert_eq!(emnapi_link_library(false), "emnapi-basic-napi-rs");
    assert_eq!(emnapi_link_library(true), "emnapi-napi-rs-mt");
  }

  #[test]
  fn parses_no_link_self_contained_flags() {
    assert!(parse_link_self_contained_flags("").is_empty());
    assert!(parse_link_self_contained_flags("-C\u{1f}debuginfo=0").is_empty());
    // A different flag whose value merely mentions the name must not match.
    assert!(
      parse_link_self_contained_flags("-C\u{1f}link-arg=--link-self-contained=no").is_empty()
    );
  }

  #[test]
  fn parses_separated_link_self_contained_flag() {
    assert_eq!(
      parse_link_self_contained_flags("-C\u{1f}link-self-contained=no"),
      vec!["-C".to_owned(), "link-self-contained=no".to_owned()]
    );
  }

  #[test]
  fn parses_glued_link_self_contained_flag() {
    assert_eq!(
      parse_link_self_contained_flags("-Clink-self-contained=off"),
      vec!["-Clink-self-contained=off".to_owned()]
    );
  }

  #[test]
  fn keeps_link_self_contained_among_other_flags() {
    let encoded =
      "-C\u{1f}opt-level=2\u{1f}-C\u{1f}link-self-contained=no\u{1f}-L\u{1f}/wasi-sdk/lib";
    assert_eq!(
      parse_link_self_contained_flags(encoded),
      vec!["-C".to_owned(), "link-self-contained=no".to_owned()]
    );
  }
}
