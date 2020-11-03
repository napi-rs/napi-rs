use glob::glob;
use std::collections::hash_map::DefaultHasher;
use std::env;
use std::hash::Hash;
use std::hash::Hasher;
use std::path::PathBuf;

fn main() {
  let node_full_version =
    napi_build::get_target_node_version().expect("Failed to determine node version");
  let node_version =
    semver::Version::parse(node_full_version.as_str()).expect("Failed to parse node version");
  let dist_url = napi_build::get_dist_url();

  println!("cargo:rerun-if-env-changed=NODE_INCLUDE_PATH");
  for entry in glob("./src/**/*.*").unwrap() {
    println!(
      "cargo:rerun-if-changed={}",
      entry.unwrap().to_str().unwrap()
    );
  }

  if node_version.major < 8 && node_version.minor < 9 {
    panic!("node version is too low")
  }

  let node_include_path_buf = find_node_include_path(&dist_url, &node_full_version);

  let node_include_path = match env::var("NODE_INCLUDE_PATH") {
    Ok(node_include_path) => node_include_path,
    Err(_) => node_include_path_buf.to_str().unwrap().to_owned(),
  };

  let out_path = PathBuf::from(env::var("OUT_DIR").unwrap());

  let mut sys_bindings_path = PathBuf::from("src");
  sys_bindings_path.push("bindings.h");

  let mut bindgen_builder = bindgen::Builder::default()
    .derive_default(true)
    .header(sys_bindings_path.to_str().unwrap().to_owned())
    .clang_arg(format!("-I{}", node_include_path))
    .clang_arg("-target")
    .clang_arg(env::var("TARGET").unwrap());

  if let Ok(uv_include_path) = env::var("NAPI_RS_INCLUDE_PATH") {
    bindgen_builder = bindgen_builder.clang_arg(format!("-I{}", uv_include_path));
  }

  if cfg!(target_os = "freebsd") {
    bindgen_builder = bindgen_builder.clang_arg(format!(
      "-I{}",
      node_include_path_buf.parent().unwrap().to_str().unwrap()
    ));
  }

  bindgen_builder
    .newtype_enum("(napi_|uv_).+")
    .whitelist_function("(napi_|uv_|extras_).+")
    .whitelist_type("(napi_|uv_|extras_).+")
    .generate()
    .expect("Unable to generate napi bindings")
    .write_to_file(out_path.join("bindings.rs"))
    .expect("Unable to write napi bindings");
}

#[cfg(not(napidocsrs))]
fn find_node_include_path(dist_url: &str, node_full_version: &str) -> PathBuf {
  let out_path = PathBuf::from(env::var("OUT_DIR").expect("Missing OUT_DIR"));

  // Prevent different dist_urls from overwriting each other.
  let dist_url_hash = {
    let mut hasher = DefaultHasher::new();
    dist_url.hash(&mut hasher);
    hasher.finish()
  };

  let mut header_dist_path = out_path.join(dist_url_hash.to_string());
  let unpack_path = PathBuf::from(&header_dist_path);
  let node_headers_top_dir = format!("node-v{}", node_full_version);
  header_dist_path.push(&node_headers_top_dir);
  header_dist_path.push("include");
  header_dist_path.push("node");

  if !header_dist_path.exists() {
    let mut archive = napi_build::download_node_headers(dist_url, node_full_version);

    // The top level dir of node headers appear to have different names. (Electron uses 'node_headers')
    // We try to do our best to standardize that here.
    // TODO: node-gyp simply extracts everything ending with .h and .gypi.
    // We should probably do the same and not assume the archive has any particular structure.
    for entry in archive
      .entries()
      .expect("Failed to iter node header entries")
    {
      let mut entry = entry.expect("Invalid node header tar entry");
      let corrected_entry_path: PathBuf = entry
        .path()
        .expect("Non-unicode path in node header tar")
        .iter()
        .enumerate()
        .map(|(i, seg)| {
          if i == 0 {
            node_headers_top_dir.as_ref()
          } else {
            seg
          }
        })
        .collect();

      let unpack_file_path = unpack_path.join(corrected_entry_path);

      // Manually unpacking like this disables a lot of sanity checks.
      // For example, we need to create our own dirs now.
      // The tar can also escape the extract dir, but we trust the dist url to provide safe, valid node headers.
      if let Some(dir) = unpack_file_path.parent() {
        std::fs::create_dir_all(dir).expect("Failed to make dir while extracting node headers");
      }

      entry
        .unpack(unpack_file_path)
        .expect("Failed to unpack node header entry");
    }
  }

  header_dist_path
}

#[cfg(napidocsrs)]
fn find_node_include_path(_node_full_version: &str) -> PathBuf {
  let mut current = env::current_dir().unwrap();
  current.push(".node-headers");
  current
}
