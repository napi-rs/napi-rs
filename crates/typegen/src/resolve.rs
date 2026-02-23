use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use cargo_metadata::{DependencyKind, Metadata, MetadataCommand, Package, PackageId};

/// Resolve all transitive dependencies that use `napi-derive`, returning their
/// crate directories in dependency-first (topological) order.
///
/// Uses `cargo metadata` for full dependency resolution — this handles path,
/// git, and registry dependencies uniformly.
///
/// The root package (matching `crate_dir`) is excluded from the result; the
/// caller already processes it directly.
pub fn resolve_napi_dependency_dirs(crate_dir: &Path) -> Result<Vec<PathBuf>> {
  let manifest_path = crate_dir.join("Cargo.toml");

  let metadata = MetadataCommand::new()
    .manifest_path(&manifest_path)
    .exec()
    .with_context(|| {
      format!(
        "Failed to run `cargo metadata` for {}",
        manifest_path.display()
      )
    })?;

  let root_id = find_root_package(&metadata, crate_dir)?;

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
}
