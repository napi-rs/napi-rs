use std::env;

pub fn setup() {
  let link_dir = env::var("EMNAPI_LINK_DIR").expect("EMNAPI_LINK_DIR must be set");
  println!("cargo:rerun-if-env-changed=EMNAPI_LINK_DIR");
  println!("cargo:rerun-if-env-changed=WASI_REGISTER_TMP_PATH");
  println!("cargo:rustc-link-search={link_dir}");
  println!("cargo:rustc-link-lib=static=emnapi-basic-mt");
  println!("cargo:rustc-link-arg=--export-dynamic");
  println!("cargo:rustc-link-arg=--export=malloc");
  println!("cargo:rustc-link-arg=--export=free");
  println!("cargo:rustc-link-arg=--export=napi_register_wasm_v1");
  println!("cargo:rustc-link-arg=--export-if-defined=node_api_module_get_api_version_v1");
  println!("cargo:rustc-link-arg=--export-table");
  println!("cargo:rustc-link-arg=--export=emnapi_async_worker_create");
  println!("cargo:rustc-link-arg=--export=emnapi_async_worker_init");
  println!("cargo:rustc-link-arg=--import-memory");
  println!("cargo:rustc-link-arg=--import-undefined");
  println!("cargo:rustc-link-arg=--max-memory=4294967296");
  // lld only allocates 1MiB for the WebAssembly stack.
  // 6400000 bytes = 64MiB
  println!("cargo:rustc-link-arg=-zstack-size=6400000");
  println!("cargo:rustc-link-arg=--no-check-features");
  if let Ok(setjmp_link_dir) = env::var("SETJMP_LINK_DIR") {
    println!("cargo:rustc-link-search={setjmp_link_dir}");
    println!("cargo:rustc-link-lib=static=setjmp-mt");
  }
}
