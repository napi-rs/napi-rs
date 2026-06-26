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
  path::{Path, PathBuf},
  process::Command,
};

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
  println!("cargo:rustc-link-arg=--export=napi_prepare_wasm_env_cleanup");
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
  let rustc = env::var("RUSTC").expect("RUSTC must be set by Cargo");
  let crt_reactor_path = find_crt1_reactor(&rustc, &target).unwrap_or_else(|error| {
    panic!(
      "failed to locate crt1-reactor.o for {target}: {error}. Install the Rust standard library for this target and ensure RUSTC points to the compiler Cargo is using"
    )
  });
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
    let setjmp_static_lib = wasi_lib_dir.join("libsetjmp.a");
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
fn find_crt1_reactor(rustc: &str, target: &str) -> Result<PathBuf, String> {
  let output = Command::new(rustc)
    .args(["--print", "target-libdir", "--target", target])
    .output()
    .map_err(|error| format!("could not execute {rustc}: {error}"))?;

  if !output.status.success() {
    return Err(format!(
      "{rustc} --print target-libdir failed: {}",
      String::from_utf8_lossy(&output.stderr).trim()
    ));
  }

  let target_libdir = String::from_utf8(output.stdout)
    .map_err(|error| format!("rustc returned a non-UTF-8 target libdir: {error}"))?;
  let target_libdir = target_libdir.trim();
  if target_libdir.is_empty() {
    return Err("rustc returned an empty target libdir".to_owned());
  }

  let path = crt1_reactor_from_target_libdir(Path::new(target_libdir));
  if !path.is_file() {
    return Err(format!("{} does not exist", path.display()));
  }
  Ok(path)
}

fn crt1_reactor_from_target_libdir(target_libdir: &Path) -> PathBuf {
  target_libdir.join("self-contained").join("crt1-reactor.o")
}

fn wasi_sysroot_lib_dir(wasi_sdk_path: &Path, wasi_target: &str) -> PathBuf {
  wasi_sdk_path
    .join("share")
    .join("wasi-sysroot")
    .join("lib")
    .join(wasi_target)
}

#[cfg(test)]
mod tests {
  use super::{crt1_reactor_from_target_libdir, wasi_sysroot_lib_dir};

  #[test]
  fn derives_reactor_from_target_libdir() {
    let path = crt1_reactor_from_target_libdir(std::path::Path::new("/rust/target/lib"));
    assert_eq!(
      path,
      std::path::Path::new("/rust/target/lib/self-contained/crt1-reactor.o")
    );
  }

  #[test]
  fn preserves_spaces_in_wasi_sysroot_path() {
    let path = wasi_sysroot_lib_dir(
      std::path::Path::new("/toolchains/WASI SDK"),
      "wasm32-wasip1-threads",
    );
    assert_eq!(
      path,
      std::path::Path::new("/toolchains/WASI SDK/share/wasi-sysroot/lib/wasm32-wasip1-threads")
    );
  }
}
