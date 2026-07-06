use std::{env, path::Path, process::Command};

fn main() {
  if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("wasi") {
    setup_type_def_rebuilds();
    setup_wasi();
  } else {
    napi_build::setup();
  }
}

fn setup_type_def_rebuilds() {
  println!("cargo:rerun-if-env-changed=DEBUG_GENERATED_CODE");
  println!("cargo:rerun-if-env-changed=TYPE_DEF_TMP_PATH");
  println!("cargo:rerun-if-env-changed=CARGO_CFG_NAPI_RS_CLI_VERSION");
  println!("cargo::rerun-if-env-changed=NAPI_DEBUG_GENERATED_CODE");
  println!("cargo::rerun-if-env-changed=NAPI_TYPE_DEF_TMP_FOLDER");
  println!(
    "cargo::rerun-if-env-changed=NAPI_FORCE_BUILD_{}",
    env::var("CARGO_PKG_NAME")
      .expect("CARGO_PKG_NAME is not set")
      .to_uppercase()
      .replace('-', "_")
  );
}

fn setup_wasi() {
  let target = env::var("TARGET").expect("TARGET must be set by Cargo");
  let has_threads = target == "wasm32-wasi" || target.ends_with("-threads");
  let link_dir = env::var("EMNAPI_LINK_DIR").expect("EMNAPI_LINK_DIR must be set");

  println!("cargo:rerun-if-env-changed=EMNAPI_LINK_DIR");
  println!("cargo:rerun-if-env-changed=RUSTC");
  println!("cargo:rerun-if-env-changed=TARGET");
  println!("cargo:rerun-if-env-changed=WASI_SDK_PATH");
  println!("cargo:rustc-link-search=native={link_dir}");
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
  println!("cargo:rustc-link-arg=-zstack-size=64000000");
  println!("cargo:rustc-link-arg=--no-check-features");

  let rustc = env::var("RUSTC").expect("RUSTC must be set by Cargo");
  let target_libdir = Command::new(&rustc)
    .args(["--print", "target-libdir", "--target", &target])
    .output()
    .unwrap_or_else(|error| panic!("failed to execute {rustc}: {error}"));
  assert!(
    target_libdir.status.success(),
    "{rustc} --print target-libdir failed: {}",
    String::from_utf8_lossy(&target_libdir.stderr).trim()
  );
  let target_libdir =
    String::from_utf8(target_libdir.stdout).expect("rustc returned a non-UTF-8 target libdir");
  let crt_reactor_path = Path::new(target_libdir.trim())
    .join("self-contained")
    .join("crt1-reactor.o");
  assert!(
    crt_reactor_path.is_file(),
    "crt1-reactor.o not found at {}",
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
    let wasi_lib_dir = Path::new(&wasi_sdk_path)
      .join("share")
      .join("wasi-sysroot")
      .join("lib")
      .join(wasi_target);
    println!("cargo:rustc-link-search=native={}", wasi_lib_dir.display());
    if wasi_lib_dir.join("libsetjmp.a").is_file() {
      println!("cargo:rustc-link-lib=static=setjmp");
    }
  }
}
