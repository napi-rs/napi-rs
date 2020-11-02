cfg_if::cfg_if! {
    if #[cfg(windows)] {
      mod windows;
      pub use windows::setup;
    } else if #[cfg(target_os = "macos")] {
      mod macos;
      pub use macos::setup;
    } else {
      pub fn setup() {}
    }
}

use flate2::read::GzDecoder;
use std::io::Read;
use std::process::Command;

/// Try to get the node version from the env.
/// Falls back to the currently installed node's version.
/// Emits cargo metadata to recompile when the env changes.
pub fn get_target_node_version() -> Result<String, std::io::Error> {
  // Recompile if node version changes.
  println!("cargo:rerun-if-env-changed=NPM_CONFIG_TARGET");

  std::env::var("NPM_CONFIG_TARGET").or_else(|_| {
    let output = Command::new("node").arg("-v").output()?;
    let stdout_str = String::from_utf8_lossy(&output.stdout);

    // version should not have a leading "v" or trailing whitespace
    Ok(stdout_str.trim().trim_start_matches('v').to_string())
  })
}

/// Try to get the dist url from the env.
/// Assume nodejs's dist url if not specified.
/// Emits cargo metadata to recompile when the env changes.
pub fn get_dist_url() -> String {
  println!("cargo:rerun-if-env-changed=NPM_CONFIG_DISTURL");

  std::env::var("NPM_CONFIG_DISTURL").unwrap_or_else(|_| "https://nodejs.org/dist".to_string())
}

/// Download the node headers from the given version and dist url and returns the decoded archive.
/// # Panics
/// Panics on failure.
pub fn download_node_headers(dist_url: &str, version: &str) -> tar::Archive<impl Read> {
  let url = format!(
    "{dist_url}/v{version}/node-v{version}-headers.tar.gz",
    dist_url = dist_url,
    version = version
  );

  let response = ureq::get(&url).call();
  if let Some(error) = response.synthetic_error() {
    panic!("Failed to download node headers: {:#?}", error);
  }

  let tar = GzDecoder::new(response.into_reader());
  tar::Archive::new(tar)
}
