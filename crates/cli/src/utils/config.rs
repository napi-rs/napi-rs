use serde::Deserialize;
use std::io;
use std::path::{Path, PathBuf};

use super::DEFAULT_TARGETS;

#[derive(Deserialize)]
struct NapiTripleConfig {
  default: bool,
  additional: Option<Vec<String>>,
}

impl Default for NapiTripleConfig {
  fn default() -> Self {
    NapiTripleConfig {
      default: true,
      additional: None,
    }
  }
}

#[derive(Default, Deserialize)]
struct NapiPackageConfig {
  name: Option<String>,
}

#[derive(Deserialize)]
struct NapiConfigInner {
  /// the binary name of generate `.node` files
  #[serde(default = "default_binary_name")]
  name: String,
  /// all targets that would like to support
  #[serde(default)]
  targets: Vec<String>,
  /// package overriding
  #[serde(default)]
  package: NapiPackageConfig,
  /// @deprecated use `targets` instead
  #[serde(default)]
  triples: NapiTripleConfig,
}

fn default_binary_name() -> String {
  "index".to_string()
}

impl Default for NapiConfigInner {
  fn default() -> Self {
    NapiConfigInner {
      name: "index".to_string(),
      targets: vec![],
      package: NapiPackageConfig::default(),
      triples: NapiTripleConfig::default(),
    }
  }
}

#[derive(Deserialize)]
// Add more fields when needed
pub struct PackageJson {
  pub name: String,
  #[serde(default)]
  napi: NapiConfigInner,
}

pub struct NapiConfig {
  pub path: PathBuf,
  inner: PackageJson,
}

impl NapiConfig {
  pub fn from_package_json<P: AsRef<Path>>(path: P) -> io::Result<Self> {
    let path = path.as_ref().to_path_buf();
    let package_json = std::fs::read_to_string(&path)?;
    let mut package_json: PackageJson = serde_json::from_str(&package_json)?;
    let napi_config = &mut package_json.napi;

    if !napi_config.targets.is_empty() {
      return Ok(Self {
        path,
        inner: package_json,
      });
    }

    // compatible with old config
    if napi_config.triples.default {
      napi_config
        .targets
        .extend(DEFAULT_TARGETS.iter().map(|t| t.to_string()));
    }

    if let Some(additional) = &napi_config.triples.additional {
      napi_config.targets.extend_from_slice(&additional[..]);
    }

    Ok(Self {
      path,
      inner: package_json,
    })
  }

  pub fn binary_name(&self) -> &str {
    &self.inner.napi.name
  }

  pub fn targets(&self) -> &[String] {
    &self.inner.napi.targets
  }

  pub fn package_name(&self) -> &str {
    self
      .inner
      .napi
      .package
      .name
      .as_deref()
      .unwrap_or(self.inner.name.as_str())
  }
}
