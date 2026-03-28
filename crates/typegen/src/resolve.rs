use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use cargo_metadata::{DependencyKind, Metadata, MetadataCommand, Package, PackageId, TargetKind};

use crate::module_graph::CrateFeatures;

/// How to obtain `cargo metadata` output.
pub enum MetadataSource {
  /// Run `cargo metadata` as a subprocess.
  Command,
  /// Read from a pre-computed JSON file (e.g. generated during a Nix build
  /// that has cargo + vendored deps available).
  File(PathBuf),
}

/// Load cargo metadata for a crate.
pub fn load_metadata(crate_dir: &Path, source: &MetadataSource) -> Result<Metadata> {
  match source {
    MetadataSource::Command => {
      let manifest_path = crate_dir.join("Cargo.toml");
      MetadataCommand::new()
        .manifest_path(&manifest_path)
        .exec()
        .with_context(|| {
          format!(
            "Failed to run `cargo metadata` for {}",
            manifest_path.display()
          )
        })
    }
    MetadataSource::File(path) => {
      let json = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read cargo metadata from {}", path.display()))?;
      serde_json::from_str(&json)
        .with_context(|| format!("Failed to parse cargo metadata from {}", path.display()))
    }
  }
}

/// Find the library crate entry point from cargo metadata.
/// Returns the `src_path` of the first library-like target (lib, cdylib, dylib, rlib, staticlib).
pub fn resolve_lib_entry_point(metadata: &Metadata, crate_dir: &Path) -> Option<PathBuf> {
  let root_id = find_root_package(metadata, crate_dir).ok()?;
  let root_pkg = metadata.packages.iter().find(|p| p.id == root_id)?;

  // Look for a library target
  for target in &root_pkg.targets {
    let is_lib = target.kind.iter().any(|k| {
      matches!(
        k,
        TargetKind::Lib
          | TargetKind::CDyLib
          | TargetKind::DyLib
          | TargetKind::RLib
          | TargetKind::StaticLib
      )
    });
    if is_lib {
      return Some(target.src_path.as_std_path().to_path_buf());
    }
  }
  None
}

/// Resolve all transitive dependencies that use `napi-derive`, returning their
/// crate directories in dependency-first (topological) order.
///
/// Uses `cargo metadata` for full dependency resolution — this handles path,
/// git, and registry dependencies uniformly.
///
/// The root package (matching `crate_dir`) is excluded from the result; the
/// caller already processes it directly.
pub fn resolve_napi_dependency_dirs(metadata: &Metadata, crate_dir: &Path) -> Result<Vec<PathBuf>> {
  let root_id = find_root_package(metadata, crate_dir)?;

  let resolve = metadata
    .resolve
    .as_ref()
    .context("cargo metadata returned no dependency graph (missing `resolve`)")?;

  // Build lookup maps for O(1) access.
  let pkg_by_id: HashMap<&PackageId, &Package> =
    metadata.packages.iter().map(|p| (&p.id, p)).collect();

  let node_by_id: HashMap<&PackageId, &[PackageId]> = resolve
    .nodes
    .iter()
    .map(|n| (&n.id, n.dependencies.as_slice()))
    .collect();

  // Depth-first traversal to collect dependencies in dependency-first order.
  let mut result = Vec::new();
  let mut visited = HashSet::new();
  visited.insert(root_id.clone()); // prevent the root from being added

  collect_transitive_deps(&root_id, &pkg_by_id, &node_by_id, &mut result, &mut visited);

  Ok(result)
}

/// Resolve a crate's enabled features from cargo metadata.
/// Prefers the actually-resolved features from the dependency graph (`metadata.resolve`),
/// which accounts for `default-features = false`, feature unification, and CLI flags
/// like `--no-default-features`. Falls back to reconstructing from declared defaults
/// when resolve info is unavailable.
pub fn resolve_crate_features(metadata: &Metadata, crate_dir: &Path) -> CrateFeatures {
  let Some(root_id) = find_root_package(metadata, crate_dir).ok() else {
    return CrateFeatures::empty();
  };
  let Some(pkg) = metadata.packages.iter().find(|p| p.id == root_id) else {
    return CrateFeatures::empty();
  };

  // Prefer the actually-resolved features from the dependency graph.
  // This accounts for default-features = false, feature unification,
  // and CLI flags like --no-default-features.
  if let Some(resolve) = &metadata.resolve {
    if let Some(node) = resolve.nodes.iter().find(|n| n.id == root_id) {
      let enabled: HashSet<String> = node.features.iter().cloned().collect();
      return CrateFeatures { enabled };
    }
  }

  // Fallback: reconstruct from declared defaults (when resolve is unavailable)
  let mut enabled = HashSet::new();
  let mut stack = vec!["default".to_string()];
  while let Some(feat) = stack.pop() {
    if enabled.insert(feat.clone()) {
      if let Some(deps) = pkg.features.get(&feat) {
        for dep in deps {
          // Skip dep: prefix and dep/feature syntax — those enable dependencies, not crate features
          if !dep.contains('/') && !dep.starts_with("dep:") {
            stack.push(dep.clone());
          }
        }
      }
    }
  }

  CrateFeatures { enabled }
}

/// Find the root package ID by matching the canonical manifest path parent
/// against `crate_dir`.
fn find_root_package(metadata: &Metadata, crate_dir: &Path) -> Result<PackageId> {
  let canonical_crate_dir = crate_dir
    .canonicalize()
    .with_context(|| format!("Failed to canonicalize {}", crate_dir.display()))?;

  for pkg in &metadata.packages {
    if let Some(pkg_dir) = pkg.manifest_path.parent() {
      if let Ok(canonical_pkg_dir) = PathBuf::from(pkg_dir.as_std_path()).canonicalize() {
        if canonical_pkg_dir == canonical_crate_dir {
          return Ok(pkg.id.clone());
        }
      }
    }
  }

  anyhow::bail!(
    "Could not find root package for {} in cargo metadata output",
    crate_dir.display()
  )
}

/// Recursively collect transitive dependencies that use `napi-derive`,
/// in dependency-first (topological) order.
fn collect_transitive_deps(
  pkg_id: &PackageId,
  pkg_by_id: &HashMap<&PackageId, &Package>,
  node_by_id: &HashMap<&PackageId, &[PackageId]>,
  result: &mut Vec<PathBuf>,
  visited: &mut HashSet<PackageId>,
) {
  let dep_ids = match node_by_id.get(pkg_id) {
    Some(deps) => *deps,
    None => return,
  };

  for dep_id in dep_ids {
    if !visited.insert(dep_id.clone()) {
      continue;
    }

    let pkg = match pkg_by_id.get(dep_id) {
      Some(p) => *p,
      None => continue,
    };

    // Recurse first (depth-first) so dependencies come before dependents.
    collect_transitive_deps(dep_id, pkg_by_id, node_by_id, result, visited);

    if has_napi_derive_dep(pkg) {
      if let Some(dir) = pkg.manifest_path.parent() {
        result.push(dir.as_std_path().to_path_buf());
      }
    }
  }
}

/// Check whether a package lists `napi-derive` as a normal or dev dependency
/// (not a build dependency).
fn has_napi_derive_dep(pkg: &Package) -> bool {
  pkg
    .dependencies
    .iter()
    .any(|dep| dep.name == "napi-derive" && !matches!(dep.kind, DependencyKind::Build))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn make_dep_json(name: &str, kind: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
      "name": name,
      "source": null,
      "req": "*",
      "kind": kind,
      "optional": false,
      "uses_default_features": true,
      "features": [],
      "target": null,
      "rename": null,
      "registry": null,
      "path": null,
    })
  }

  fn make_pkg_json(deps: Vec<serde_json::Value>) -> serde_json::Value {
    serde_json::json!({
      "name": "test-pkg",
      "version": "0.1.0",
      "id": "test-pkg 0.1.0 (path+file:///tmp/test-pkg)",
      "source": null,
      "dependencies": deps,
      "targets": [],
      "features": {},
      "manifest_path": "/tmp/test-pkg/Cargo.toml",
      "authors": [],
      "categories": [],
      "keywords": [],
      "readme": null,
      "repository": null,
      "homepage": null,
      "documentation": null,
      "edition": "2021",
      "metadata": null,
      "license": null,
      "license_file": null,
      "publish": null,
      "default_run": null,
      "rust_version": null,
    })
  }

  #[test]
  fn test_has_napi_derive_dep_normal() {
    let pkg: Package = serde_json::from_value(make_pkg_json(vec![make_dep_json(
      "napi-derive",
      serde_json::Value::Null,
    )]))
    .unwrap();
    assert!(has_napi_derive_dep(&pkg));
  }

  #[test]
  fn test_has_napi_derive_dep_dev() {
    let pkg: Package = serde_json::from_value(make_pkg_json(vec![make_dep_json(
      "napi-derive",
      serde_json::json!("dev"),
    )]))
    .unwrap();
    assert!(has_napi_derive_dep(&pkg));
  }

  #[test]
  fn test_has_napi_derive_dep_build_only() {
    let pkg: Package = serde_json::from_value(make_pkg_json(vec![make_dep_json(
      "napi-derive",
      serde_json::json!("build"),
    )]))
    .unwrap();
    assert!(!has_napi_derive_dep(&pkg));
  }

  #[test]
  fn test_has_napi_derive_dep_missing() {
    let pkg: Package = serde_json::from_value(make_pkg_json(vec![make_dep_json(
      "serde",
      serde_json::Value::Null,
    )]))
    .unwrap();
    assert!(!has_napi_derive_dep(&pkg));
  }

  #[test]
  fn test_has_napi_derive_dep_no_deps() {
    let pkg: Package = serde_json::from_value(make_pkg_json(vec![])).unwrap();
    assert!(!has_napi_derive_dep(&pkg));
  }

  // ── resolve_crate_features tests ─────────────────────────────────

  /// Create a temporary directory that exists on disk (needed for canonicalize).
  struct TempDir {
    path: PathBuf,
  }

  impl TempDir {
    fn new(name: &str) -> Self {
      let path = std::env::temp_dir().join(format!(
        "napi-typegen-resolve-test-{}-{}",
        name,
        std::process::id()
      ));
      let _ = std::fs::remove_dir_all(&path);
      std::fs::create_dir_all(&path).unwrap();
      TempDir { path }
    }
  }

  impl Drop for TempDir {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.path);
    }
  }

  /// Build a minimal Metadata JSON for testing resolve_crate_features.
  fn make_metadata_json(
    manifest_dir: &Path,
    pkg_features: serde_json::Value,
    resolved_features: Option<Vec<&str>>,
  ) -> Metadata {
    let manifest_path = manifest_dir.join("Cargo.toml");
    let pkg_id = format!("test-pkg 0.1.0 (path+file://{})", manifest_dir.display());

    let resolve = resolved_features.map(|feats| {
      serde_json::json!({
        "nodes": [{
          "id": &pkg_id,
          "dependencies": [],
          "deps": [],
          "features": feats,
        }],
        "root": &pkg_id,
      })
    });

    let metadata_json = serde_json::json!({
      "packages": [{
        "name": "test-pkg",
        "version": "0.1.0",
        "id": &pkg_id,
        "source": null,
        "dependencies": [],
        "targets": [],
        "features": pkg_features,
        "manifest_path": manifest_path.display().to_string(),
        "authors": [],
        "categories": [],
        "keywords": [],
        "readme": null,
        "repository": null,
        "homepage": null,
        "documentation": null,
        "edition": "2021",
        "metadata": null,
        "license": null,
        "license_file": null,
        "publish": null,
        "default_run": null,
        "rust_version": null,
      }],
      "workspace_members": [&pkg_id],
      "workspace_default_members": [],
      "resolve": resolve,
      "target_directory": manifest_dir.join("target").display().to_string(),
      "version": 1,
      "workspace_root": manifest_dir.display().to_string(),
      "metadata": null,
    });

    serde_json::from_value(metadata_json).expect("Failed to deserialize test metadata")
  }

  #[test]
  fn resolve_features_from_resolved_node() {
    let dir = TempDir::new("resolved-node");
    let metadata = make_metadata_json(
      &dir.path,
      serde_json::json!({"default": ["foo"], "foo": [], "bar": []}),
      Some(vec!["default", "foo"]),
    );
    let features = resolve_crate_features(&metadata, &dir.path);
    assert!(features.enabled.contains("default"));
    assert!(features.enabled.contains("foo"));
    assert!(
      !features.enabled.contains("bar"),
      "bar is not in resolved set"
    );
  }

  #[test]
  fn resolve_features_no_default_features_flag() {
    // Simulates cargo metadata --no-default-features: resolve node has empty features
    let dir = TempDir::new("no-defaults");
    let metadata = make_metadata_json(
      &dir.path,
      serde_json::json!({"default": ["foo"], "foo": []}),
      Some(vec![]), // empty — no features resolved
    );
    let features = resolve_crate_features(&metadata, &dir.path);
    assert!(
      features.enabled.is_empty(),
      "no features should be enabled: {:?}",
      features.enabled
    );
  }

  #[test]
  fn resolve_features_fallback_reconstructs_defaults() {
    // No resolve graph → falls back to pkg.features["default"]
    let dir = TempDir::new("fallback");
    let metadata = make_metadata_json(
      &dir.path,
      serde_json::json!({"default": ["foo"], "foo": ["bar"], "bar": [], "baz": []}),
      None, // no resolve
    );
    let features = resolve_crate_features(&metadata, &dir.path);
    assert!(features.enabled.contains("default"));
    assert!(features.enabled.contains("foo"));
    assert!(
      features.enabled.contains("bar"),
      "bar should be transitively enabled"
    );
    assert!(!features.enabled.contains("baz"), "baz is not in defaults");
  }

  #[test]
  fn resolve_features_fallback_skips_dep_syntax() {
    let dir = TempDir::new("dep-syntax");
    let metadata = make_metadata_json(
      &dir.path,
      serde_json::json!({"default": ["dep:serde", "foo/bar", "real"], "real": []}),
      None,
    );
    let features = resolve_crate_features(&metadata, &dir.path);
    assert!(features.enabled.contains("default"));
    assert!(features.enabled.contains("real"));
    assert!(
      !features.enabled.contains("serde"),
      "dep: prefixed entries should be skipped"
    );
    assert!(
      !features.enabled.contains("foo/bar"),
      "dep/feature entries should be skipped"
    );
  }

  #[test]
  fn resolve_features_empty_when_package_not_found() {
    let dir = TempDir::new("not-found");
    let other_dir = TempDir::new("not-found-other");
    let metadata = make_metadata_json(
      &dir.path,
      serde_json::json!({"default": ["foo"], "foo": []}),
      Some(vec!["default", "foo"]),
    );
    // Pass a different directory — no matching package
    let features = resolve_crate_features(&metadata, &other_dir.path);
    assert!(features.enabled.is_empty());
  }

  #[test]
  fn resolve_features_fallback_no_default_key() {
    // Package has features but no "default" key
    let dir = TempDir::new("no-default-key");
    let metadata = make_metadata_json(&dir.path, serde_json::json!({"foo": [], "bar": []}), None);
    let features = resolve_crate_features(&metadata, &dir.path);
    // "default" is pushed to stack but doesn't exist as a key → nothing resolved
    assert!(
      features.enabled.len() <= 1,
      "only 'default' itself (from stack init) may be present: {:?}",
      features.enabled
    );
  }
}
