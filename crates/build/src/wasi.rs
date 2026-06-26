use std::{env, path::Path};

pub fn setup() {
  let link_dir = env::var("EMNAPI_LINK_DIR").expect("EMNAPI_LINK_DIR must be set");
  let target = env::var("TARGET").expect("TARGET must be set by Cargo");
  let has_threads = target.ends_with("-threads");
  println!("cargo:rerun-if-env-changed=EMNAPI_LINK_DIR");
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
      "cargo:warning=crt1-reactor.o not found at {}, the WASI reactor may not be initialized correctly",
      crt_reactor_path.display()
    );
  }
  if let Ok(wasi_sdk_path) = env::var("WASI_SDK_PATH") {
    let wasi_target = if has_threads {
      "wasm32-wasip1-threads"
    } else {
      "wasm32-wasip1"
    };
    println!("cargo:rustc-link-search={wasi_sdk_path}/share/wasi-sysroot/lib/{wasi_target}");
    let setjmp_static_lib = Path::new(&wasi_sdk_path)
      .join("share")
      .join("wasi-sysroot")
      .join("lib")
      .join(wasi_target)
      .join("libsetjmp.a");
    if setjmp_static_lib.exists() {
      println!("cargo:rustc-link-lib=static=setjmp");
    }
  }
}
