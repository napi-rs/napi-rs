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

/// The libc symbols the heap-sync build wraps: every entry into wasi-libc's
/// dlmalloc, plus the `sbrk` dlmalloc grows the heap with. `napi` defines a
/// `__wrap_<name>` for each one, which takes the heap-sync lock and reaches
/// libc through `__real_<name>`. `--wrap=<name>` sends every other reference to
/// `<name>` (Rust's `System`, wasi-libc, the emnapi archive) to the wrapper.
///
/// `llvm-nm` on the self-contained `libc.a` of rustc 1.98 and on the wasi-sdk 32
/// sysroot's `libc.a` (both `wasm32-wasip1-threads`):
///
/// | symbol             | defined in (T) | referenced (U) by, e.g.                           |
/// |--------------------|----------------|---------------------------------------------------|
/// | malloc             | dlmalloc.c.obj | libc (stdio, dirent, environ, pthread), emnapi    |
/// | free               | dlmalloc.c.obj | libc (same), emnapi                               |
/// | calloc             | dlmalloc.c.obj | libc (environ, preopens, regex), emnapi           |
/// | realloc            | dlmalloc.c.obj | libc (getdelim, glob, reallocarray), emnapi       |
/// | posix_memalign     | dlmalloc.c.obj | no C caller; std's `System` for large alignments |
/// | aligned_alloc      | dlmalloc.c.obj | no caller                                         |
/// | malloc_usable_size | dlmalloc.c.obj | no caller                                         |
/// | __libc_malloc      | dlmalloc.c.obj | libc locale (duplocale, newlocale, locale_map)    |
/// | __libc_free        | dlmalloc.c.obj | libc locale (freelocale)                          |
/// | __libc_calloc      | dlmalloc.c.obj | libc atexit                                       |
/// | sbrk               | sbrk.c.obj     | dlmalloc.c.obj only                               |
///
/// Inside `dlmalloc.c.obj` the public names are thin wrappers over static
/// `dlmalloc` / `dlfree` / ..., and its only calls out of the object are `sbrk`
/// and `sched_yield`, so a wrapped entry never re-enters another one. An entry
/// that a later wasi-libc adds is not wrapped until it is listed here.
const HEAP_SYNC_WRAPPED_SYMBOLS: [&str; 11] = [
  "malloc",
  "free",
  "calloc",
  "realloc",
  "posix_memalign",
  "aligned_alloc",
  "malloc_usable_size",
  "__libc_malloc",
  "__libc_free",
  "__libc_calloc",
  "sbrk",
];

/// A relocatable wasm object whose two functions are exported as `malloc` and
/// `free` and call `malloc` and `free`, which `--wrap` turns into
/// `__wrap_malloc` and `__wrap_free`. `@emnapi/core` needs the two exports, and
/// under `--wrap` the link has no other way to produce them. It also defines
/// [`HEAP_SYNC_LINK_CHECK_SYMBOL`]. Source and the exact build command:
/// `wasi_heap_sync_exports.c`.
const HEAP_SYNC_EXPORTS_OBJECT: &[u8] = include_bytes!("wasi_heap_sync_exports.o");

/// A data symbol that [`HEAP_SYNC_EXPORTS_OBJECT`] defines and `napi`'s
/// `__wrap_sbrk` reads. A link with `napi`'s wrappers but without this crate's
/// wrap (an addon whose `setup()` runs a napi-build without the
/// `wasi-heap-sync` feature, next to the copy `napi` builds with) then fails
/// with `undefined symbol` naming it. `--import-undefined` never imports data,
/// while it would import the wrappers' `__real_*` calls and leave a module
/// that fails to load.
#[cfg(test)]
const HEAP_SYNC_LINK_CHECK_SYMBOL: &str =
  "napi_wasi_heap_sync_needs_napi_build_setup_with_wasi_heap_sync";

/// The file name [`HEAP_SYNC_EXPORTS_OBJECT`] is written to, in `OUT_DIR`.
const HEAP_SYNC_EXPORTS_OBJECT_FILE: &str = "napi_wasi_heap_sync_exports.o";

/// Whether the link wraps wasi-libc's allocator with `napi`'s heap-sync lock.
///
/// - `requested`: this crate's `wasi-heap-sync` feature. The crate that defines
///   the wrappers (`napi`) turns it on through its build-dependency, and Cargo
///   feature unification carries it into every addon's `setup()`, even through
///   intermediate crates, so the wrap happens exactly when the wrappers are in
///   the graph.
/// - `opted_out`: `--cfg napi_wasi_no_heap_sync` in the target rustflags, which
///   Cargo hands this build script as `CARGO_CFG_NAPI_WASI_NO_HEAP_SYNC`. `napi`
///   reads the same cfg to leave its wrappers out.
///
/// The exact triple, not `has_threads`, because `napi`'s own build script
/// decides whether it compiles the wrappers from the exact triple too, and the
/// two sides have to agree.
fn wraps_libc_allocator(target: &str, requested: bool, opted_out: bool) -> bool {
  target == "wasm32-wasip1-threads" && requested && !opted_out
}

/// The link lines of the heap-sync build: one `--wrap` per symbol in
/// [`HEAP_SYNC_WRAPPED_SYMBOLS`], and the object that provides the `malloc` /
/// `free` exports.
fn heap_sync_link_lines(exports_object: &Path) -> Vec<String> {
  HEAP_SYNC_WRAPPED_SYMBOLS
    .iter()
    .map(|symbol| format!("cargo:rustc-link-arg=--wrap={symbol}"))
    .chain([format!("cargo:rustc-link-arg={}", exports_object.display())])
    .collect()
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
  // `@emnapi/core` allocates through these two exports. Under the heap-sync wrap
  // below, `--export=malloc` resolves to `__wrap_malloc` and names no `malloc`
  // export any more; the heap-sync exports object provides `malloc` / `free`.
  // Both lines stay anyway: when `napi` does not define the wrappers, they fail
  // the link with `symbol exported via --export not found: malloc`, instead of a
  // module that imports `env.__wrap_malloc` and only fails at load.
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
  // The async-work half of the same teardown handshake: `napi_async_work` is not covered by the
  // barrier above, and a loader that destroys the environment — or terminates the pool threads —
  // with one outstanding strands its promise and leaves the emnapi waiting-request counter above
  // zero. The loaders cancel what has not started, then poll the count to zero before
  // destroying. Conditional for the same reason as the two above.
  println!("cargo:rustc-link-arg=--export-if-defined=napi_wasm_async_work_pending");
  println!("cargo:rustc-link-arg=--export-if-defined=napi_wasm_cancel_pending_async_work");
  // The two-phase form of the first barrier, for a loader that can yield: `…_begin` shuts the
  // async runtime down without joining, `napi_wasm_runtime_work_pending` answers whether
  // `…_finish` would still have to block, and `…_finish` joins and replays the cancellations.
  // The loaders feature-detect the trio and fall back to the single blocking
  // `napi_prepare_wasm_env_cleanup`, so these are conditional for the same reason as the ones
  // above.
  println!("cargo:rustc-link-arg=--export-if-defined=napi_prepare_wasm_env_cleanup_begin");
  println!("cargo:rustc-link-arg=--export-if-defined=napi_wasm_runtime_work_pending");
  println!("cargo:rustc-link-arg=--export-if-defined=napi_prepare_wasm_env_cleanup_finish");
  println!("cargo:rustc-link-arg=--export-if-defined=node_api_module_get_api_version_v1");
  println!("cargo:rustc-link-arg=--export-table");
  if has_threads {
    println!("cargo:rustc-link-arg=--export-if-defined=emnapi_async_worker_create");
    println!("cargo:rustc-link-arg=--export-if-defined=emnapi_async_worker_init");
  }
  if wraps_libc_allocator(
    &target,
    cfg!(feature = "wasi-heap-sync"),
    env::var_os("CARGO_CFG_NAPI_WASI_NO_HEAP_SYNC").is_some(),
  ) {
    let out_dir = env::var_os("OUT_DIR").expect("OUT_DIR must be set by Cargo");
    let exports_object = Path::new(&out_dir).join(HEAP_SYNC_EXPORTS_OBJECT_FILE);
    fs::write(&exports_object, HEAP_SYNC_EXPORTS_OBJECT)
      .unwrap_or_else(|error| panic!("failed to write {}: {error}", exports_object.display()));
    for line in heap_sync_link_lines(&exports_object) {
      println!("{line}");
    }
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

  #[test]
  fn wraps_the_allocator_only_on_the_exact_threaded_triple() {
    assert!(wraps_libc_allocator("wasm32-wasip1-threads", true, false));
    // `has_threads` accepts these, but `napi` compiles its wrappers for the
    // exact triple only.
    for target in [
      "wasm32-wasip1",
      "wasm32-wasi",
      "wasm32-wasi-preview1-threads",
      "foo-threads",
      "x86_64-unknown-linux-gnu",
    ] {
      assert!(!wraps_libc_allocator(target, true, false), "{target}");
    }
  }

  #[test]
  fn wraps_the_allocator_only_when_requested_and_not_opted_out() {
    assert!(!wraps_libc_allocator("wasm32-wasip1-threads", false, false));
    assert!(!wraps_libc_allocator("wasm32-wasip1-threads", true, true));
    assert!(!wraps_libc_allocator("wasm32-wasip1-threads", false, true));
  }

  #[test]
  fn emits_one_wrap_per_allocator_symbol_then_the_exports_object() {
    assert_eq!(
      heap_sync_link_lines(Path::new("/target dir/out/napi_wasi_heap_sync_exports.o")),
      vec![
        "cargo:rustc-link-arg=--wrap=malloc",
        "cargo:rustc-link-arg=--wrap=free",
        "cargo:rustc-link-arg=--wrap=calloc",
        "cargo:rustc-link-arg=--wrap=realloc",
        "cargo:rustc-link-arg=--wrap=posix_memalign",
        "cargo:rustc-link-arg=--wrap=aligned_alloc",
        "cargo:rustc-link-arg=--wrap=malloc_usable_size",
        "cargo:rustc-link-arg=--wrap=__libc_malloc",
        "cargo:rustc-link-arg=--wrap=__libc_free",
        "cargo:rustc-link-arg=--wrap=__libc_calloc",
        "cargo:rustc-link-arg=--wrap=sbrk",
        "cargo:rustc-link-arg=/target dir/out/napi_wasi_heap_sync_exports.o",
      ]
    );
  }

  /// Reads the few wasm encodings the exports-object test needs.
  struct WasmReader<'a> {
    bytes: &'a [u8],
    cursor: usize,
  }

  impl<'a> WasmReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
      Self { bytes, cursor: 0 }
    }

    fn is_done(&self) -> bool {
      self.cursor == self.bytes.len()
    }

    fn byte(&mut self) -> u8 {
      self.cursor += 1;
      self.bytes[self.cursor - 1]
    }

    fn u32(&mut self) -> u32 {
      read_leb128_u32(self.bytes, &mut self.cursor).expect("a valid LEB128 u32")
    }

    fn take(&mut self, len: usize) -> &'a [u8] {
      self.cursor += len;
      &self.bytes[self.cursor - len..self.cursor]
    }

    fn rest(&self) -> &'a [u8] {
      &self.bytes[self.cursor..]
    }

    fn name(&mut self) -> &'a str {
      let len = self.u32() as usize;
      std::str::from_utf8(self.take(len)).expect("a UTF-8 name")
    }

    fn byte_vec(&mut self) -> Vec<u8> {
      let len = self.u32() as usize;
      self.take(len).to_vec()
    }

    fn limits(&mut self) {
      let flags = self.byte();
      self.u32();
      if flags & 1 != 0 {
        self.u32();
      }
    }
  }

  /// The object must turn into `malloc` / `free` exports that forward to the
  /// references `--wrap` redirects: an export named `malloc` whose body passes
  /// its argument to an undefined `malloc` through a relocation, and the same
  /// for `free`. It must also define the global data symbol `napi` reads to
  /// fail a link without the wrap. Parsed by hand, so the test needs no wasm
  /// toolchain.
  #[test]
  fn exports_object_forwards_malloc_and_free_to_undefined_symbols() {
    const SYMBOL_TABLE: u8 = 8;
    const SYMBOL_KIND_FUNCTION: u8 = 0;
    const SYMBOL_KIND_DATA: u8 = 1;
    const SYMBOL_KIND_TABLE: u8 = 5;
    const SYMBOL_BINDING_LOCAL: u32 = 0x02;
    const SYMBOL_UNDEFINED: u32 = 0x10;
    const SYMBOL_EXPORTED: u32 = 0x20;
    const SYMBOL_EXPLICIT_NAME: u32 = 0x40;
    const R_WASM_FUNCTION_INDEX_LEB: u8 = 0;
    const I32: u8 = 0x7f;

    let object = HEAP_SYNC_EXPORTS_OBJECT;
    assert_eq!(&object[..8], b"\0asm\x01\x00\x00\x00");

    let mut reader = WasmReader::new(&object[8..]);
    let mut sections = Vec::new();
    while !reader.is_done() {
      let id = reader.byte();
      let len = reader.u32() as usize;
      let mut payload = WasmReader::new(reader.take(len));
      let name = if id == 0 { payload.name() } else { "" };
      sections.push((id, name, payload.rest()));
    }
    let section = |id: u8, name: &str| {
      sections
        .iter()
        .position(|&(i, n, _)| i == id && n == name)
        .unwrap_or_else(|| panic!("section {id} {name:?} is missing"))
    };

    let mut types = WasmReader::new(sections[section(1, "")].2);
    let types: Vec<(Vec<u8>, Vec<u8>)> = (0..types.u32())
      .map(|_| {
        assert_eq!(types.byte(), 0x60);
        (types.byte_vec(), types.byte_vec())
      })
      .collect();

    // Imported functions take the first function indices.
    let mut function_types = Vec::new();
    let mut imported_functions = Vec::new();
    let mut imports = WasmReader::new(sections[section(2, "")].2);
    for _ in 0..imports.u32() {
      let (module, field) = (imports.name(), imports.name());
      match imports.byte() {
        0 => {
          function_types.push(imports.u32());
          imported_functions.push((module, field));
        }
        1 => {
          imports.byte();
          imports.limits();
        }
        2 => imports.limits(),
        kind => panic!("unexpected import kind {kind}"),
      }
    }
    assert_eq!(imported_functions, [("env", "malloc"), ("env", "free")]);

    let mut functions = WasmReader::new(sections[section(3, "")].2);
    for _ in 0..functions.u32() {
      function_types.push(functions.u32());
    }

    let mut exports = WasmReader::new(sections[section(7, "")].2);
    let exports: Vec<(&str, u8, u32)> = (0..exports.u32())
      .map(|_| (exports.name(), exports.byte(), exports.u32()))
      .collect();

    // Each body with its offset in the code section, which relocations count from.
    let code_section = section(10, "");
    let mut code = WasmReader::new(sections[code_section].2);
    let bodies: Vec<(usize, &[u8])> = (0..code.u32())
      .map(|_| {
        let len = code.u32() as usize;
        (code.cursor, code.take(len))
      })
      .collect();

    let mut linking = WasmReader::new(sections[section(0, "linking")].2);
    assert_eq!(linking.u32(), 2, "linking section version");
    // Every symbol in table order, since relocations refer to them by position;
    // `index` is `u32::MAX` for data symbols, which have none.
    let mut symbols = Vec::new();
    let mut data_symbols = Vec::new();
    while !linking.is_done() {
      let id = linking.byte();
      let len = linking.u32() as usize;
      let mut subsection = WasmReader::new(linking.take(len));
      if id != SYMBOL_TABLE {
        continue;
      }
      for _ in 0..subsection.u32() {
        let (kind, flags) = (subsection.byte(), subsection.u32());
        match kind {
          SYMBOL_KIND_FUNCTION | SYMBOL_KIND_TABLE => {
            let index = subsection.u32();
            if flags & SYMBOL_UNDEFINED == 0 || flags & SYMBOL_EXPLICIT_NAME != 0 {
              subsection.name();
            }
            symbols.push((kind, flags, index));
          }
          SYMBOL_KIND_DATA => {
            let name = subsection.name();
            // A defined data symbol: segment index, offset, size.
            let size = if flags & SYMBOL_UNDEFINED == 0 {
              subsection.u32();
              subsection.u32();
              Some(subsection.u32())
            } else {
              None
            };
            data_symbols.push((name, flags, size));
            symbols.push((kind, flags, u32::MAX));
          }
          kind => panic!("unexpected symbol kind {kind}"),
        }
      }
    }

    assert_eq!(data_symbols.len(), 1, "{data_symbols:?}");
    let (name, flags, size) = data_symbols[0];
    assert_eq!(name, HEAP_SYNC_LINK_CHECK_SYMBOL);
    assert_eq!(size, Some(1), "{name} is defined, one byte");
    assert_eq!(flags & SYMBOL_BINDING_LOCAL, 0, "{name} is a global symbol");

    let mut reloc = WasmReader::new(sections[section(0, "reloc.CODE")].2);
    assert_eq!(reloc.u32() as usize, code_section);
    let relocations: Vec<(u8, u32, u32)> = (0..reloc.u32())
      .map(|_| (reloc.byte(), reloc.u32(), reloc.u32()))
      .collect();
    assert!(reloc.is_done());
    assert_eq!(relocations.len(), 2);

    assert_eq!(exports.len(), 2);
    for (export, result) in [("malloc", vec![I32]), ("free", vec![])] {
      let &(_, kind, function) = exports
        .iter()
        .find(|(name, ..)| *name == export)
        .unwrap_or_else(|| panic!("no {export} export"));
      assert_eq!(kind, 0, "{export} is a function export");
      assert_eq!(
        types[function_types[function as usize] as usize],
        (vec![I32], result),
        "{export} signature"
      );
      assert!(
        symbols
          .iter()
          .any(|&(kind, flags, index)| kind == SYMBOL_KIND_FUNCTION
            && index == function
            && flags & SYMBOL_UNDEFINED == 0
            && flags & SYMBOL_EXPORTED != 0),
        "{export} is a defined, exported function symbol"
      );

      // No locals, `local.get 0`, `call` with a 5-byte relocatable index, `end`.
      let (offset, body) = bodies[function as usize - imported_functions.len()];
      assert_eq!(body.len(), 10, "{export} body");
      assert_eq!(body[..4], [0x00, 0x20, 0x00, 0x10], "{export} body");
      assert_eq!(body[9], 0x0b, "{export} body");
      let &(reloc_type, _, symbol) = relocations
        .iter()
        .find(|&&(_, reloc_offset, _)| reloc_offset as usize == offset + 4)
        .unwrap_or_else(|| panic!("the call in {export} is not relocated"));
      assert_eq!(reloc_type, R_WASM_FUNCTION_INDEX_LEB);
      let (kind, flags, index) = symbols[symbol as usize];
      assert_eq!(kind, SYMBOL_KIND_FUNCTION);
      assert_ne!(
        flags & SYMBOL_UNDEFINED,
        0,
        "{export} calls an undefined symbol"
      );
      assert_eq!(imported_functions[index as usize], ("env", export));
    }
  }
}
