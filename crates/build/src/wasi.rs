use std::{
  env,
  ffi::OsStr,
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

pub fn setup() {
  let link_dir = env::var("EMNAPI_LINK_DIR").expect("EMNAPI_LINK_DIR must be set");
  println!("cargo:rerun-if-env-changed=EMNAPI_LINK_DIR");
  println!("cargo:rustc-link-search={link_dir}");
  println!("cargo:rustc-link-lib=static=emnapi-basic-mt");
  println!("cargo:rustc-link-arg=--export=malloc");
  println!("cargo:rustc-link-arg=--export=free");
  println!("cargo:rustc-link-arg=--export=napi_register_wasm_v1");
  println!("cargo:rustc-link-arg=--export-if-defined=node_api_module_get_api_version_v1");
  println!("cargo:rustc-link-arg=--export-table");
  println!("cargo:rustc-link-arg=--export=emnapi_async_worker_create");
  println!("cargo:rustc-link-arg=--export=emnapi_async_worker_init");
  println!("cargo:rustc-link-arg=--export=emnapi_thread_crashed");
  println!("cargo:rustc-link-arg=--import-memory");
  println!("cargo:rustc-link-arg=--import-undefined");
  println!("cargo:rustc-link-arg=--max-memory=4294967296");
  // lld only allocates 1MiB for the WebAssembly stack.
  // 64000000 bytes = 64MiB
  println!("cargo:rustc-link-arg=-zstack-size=64000000");
  println!("cargo:rustc-link-arg=--no-check-features");
  println!("cargo:rerun-if-env-changed=RUSTC");
  let rustc = env::var_os("RUSTC").expect("RUSTC must be set by Cargo");
  let target = env::var("TARGET").expect("TARGET must be set by Cargo");
  match rustc_sysroot(&rustc) {
    Ok(sysroot) => {
      let crt_reactor_path = reactor_crt_path(&sysroot, &target);
      if crt_reactor_path.exists() {
        println!("cargo:rustc-link-arg={}", crt_reactor_path.display());
        println!("cargo:rustc-link-arg=--export=_initialize");
      } else {
        println!(
          "cargo:warning=crt1-reactor.o not found at {}, the multi-threaded runtime may not be initialized correctly",
          crt_reactor_path.display()
        );
      }
    }
    Err(err) => {
      println!(
        "cargo:warning=failed to locate crt1-reactor.o through rustc: {err}; the multi-threaded runtime may not be initialized correctly"
      );
    }
  }
  if let Ok(wasi_sdk_path) = env::var("WASI_SDK_PATH") {
    println!(
      "cargo:rustc-link-search={wasi_sdk_path}/share/wasi-sysroot/lib/wasm32-wasip1-threads"
    );
    let setjmp_static_lib = Path::new(&wasi_sdk_path)
      .join("share")
      .join("wasi-sysroot")
      .join("lib")
      .join("wasm32-wasip1-threads")
      .join("libsetjmp.a");
    if setjmp_static_lib.exists() {
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
}
