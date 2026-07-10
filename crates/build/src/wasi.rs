use std::{env, path::Path};

fn wasi_sysroot_lib_dir(wasi_sdk_path: &Path, wasi_target: &str) -> PathBuf {
  wasi_sdk_path
    .join("share")
    .join("wasi-sysroot")
    .join("lib")
    .join(wasi_target)
}

pub fn setup() {
  let link_dir = env::var("EMNAPI_LINK_DIR").expect("EMNAPI_LINK_DIR must be set");
  let target = env::var("TARGET").expect("TARGET must be set by Cargo");
  let has_threads = matches!(
    target.as_str(),
    "wasm32-wasi" | "wasm32-wasi-preview1-threads" | "wasm32-wasip1-threads"
  ) || target.ends_with("-threads");

  println!("cargo:rerun-if-env-changed=EMNAPI_LINK_DIR");
  println!("cargo:rerun-if-env-changed=RUSTC");
  println!("cargo:rerun-if-env-changed=TARGET");
  println!("cargo:rerun-if-env-changed=WASI_SDK_PATH");
  println!("cargo:rustc-link-search={link_dir}");
  println!(
    "cargo:rustc-link-lib=static={}",
    if has_threads {
      "emnapi-basic-mt"
    } else {
      "emnapi-basic"
    }
  );
  println!("cargo:rustc-link-arg=--export=malloc");
  println!("cargo:rustc-link-arg=--export=free");
  println!("cargo:rustc-link-arg=--export=napi_register_wasm_v1");
  println!("cargo:rustc-link-arg=--export-if-defined=node_api_module_get_api_version_v1");
  println!("cargo:rustc-link-arg=--export-table");
  if has_threads {
    println!("cargo:rustc-link-arg=--export=emnapi_async_worker_create");
    println!("cargo:rustc-link-arg=--export=emnapi_async_worker_init");
  }
  println!("cargo:rustc-link-arg=--export-if-defined=emnapi_thread_crashed");
  println!("cargo:rustc-link-arg=--import-memory");
  println!("cargo:rustc-link-arg=--import-undefined");
  println!("cargo:rustc-link-arg=--max-memory=4294967296");
  // lld only allocates 1MiB for the WebAssembly stack.
  // 64000000 bytes = 64MiB
  println!("cargo:rustc-link-arg=-zstack-size=64000000");
  println!("cargo:rustc-link-arg=--no-check-features");
  let rustc_path = env::var("RUSTC").expect("RUSTC must be set by Cargo");
  let target = env::var("TARGET").expect("TARGET must be set by Cargo");
  let crt_reactor_path = Path::new(&rustc_path)
    .parent()
    .and_then(|p| p.parent())
    .map_or_else(
      || Path::new("").to_path_buf(),
      |p| {
        p.join("lib")
          .join("rustlib")
          .join(target)
          .join("lib")
          .join("self-contained")
          .join("crt1-reactor.o")
      },
    );
  if crt_reactor_path.exists() {
    println!("cargo:rustc-link-arg={}", crt_reactor_path.display());
    println!("cargo:rustc-link-arg=--export=_initialize");
  } else {
    println!(
      "cargo:warning=crt1-reactor.o not found at {}, the multi-threaded runtime may not be initialized correctly",
      crt_reactor_path.display()
    );
  }

  let rustc = env::var_os("RUSTC").expect("RUSTC must be set by Cargo");
  let sysroot = rustc_sysroot(&rustc).unwrap_or_else(|error| {
    panic!(
      "failed to locate crt1-reactor.o for {target}: {error}. Ensure RUSTC points to the compiler Cargo is using"
    )
  });
  let crt_reactor_path = reactor_crt_path(&sysroot, &target);
  assert!(
    crt_reactor_path.is_file(),
    "failed to locate crt1-reactor.o for {target} at {}. Install the Rust standard library for this target",
    crt_reactor_path.display()
  );
  println!("cargo:rustc-link-arg={}", crt_reactor_path.display());
  println!("cargo:rustc-link-arg=--export=_initialize");

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

  #[test]
  fn preserves_spaces_in_wasi_sysroot_path() {
    let path = wasi_sysroot_lib_dir(Path::new("/toolchains/WASI SDK"), "wasm32-wasip1-threads");
    assert_eq!(
      path,
      Path::new("/toolchains/WASI SDK/share/wasi-sysroot/lib/wasm32-wasip1-threads")
    );
  }
}
