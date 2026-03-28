use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::Result;
use napi_derive_backend::parser::attrs::BindgenAttrs;
use syn::Item;

use crate::visitor::{is_napi_attr, parent_module_dir};

/// Feature configuration for cfg predicate evaluation.
/// Used to evaluate `feature = "X"` predicates based on resolved features.
pub struct CrateFeatures {
  /// Features enabled for this package in the resolved dependency graph.
  /// Falls back to declared default features when resolve info is unavailable.
  pub enabled: HashSet<String>,
}

impl CrateFeatures {
  pub fn empty() -> Self {
    Self {
      enabled: HashSet::new(),
    }
  }
}

/// Result of walking a crate's module graph.
pub struct ModuleGraphResult {
  /// Reachable files containing "napi": (canonical_path_string, content)
  pub files: Vec<(String, String)>,
  /// Namespace map: canonical_path_string -> namespace_js_name
  pub namespace_map: HashMap<String, String>,
}

/// Walk the module graph starting from the crate entry point.
/// Only returns files reachable through `mod` declarations, with namespace info.
///
/// If `entry_point` is provided (e.g. from cargo metadata), it is used directly.
/// Otherwise, falls back to discovering `lib.rs` / `main.rs` in `fallback_dir`.
/// If no entry point is found at all, falls back to filesystem walking (via `walk_rs_files`).
pub fn walk_module_graph(
  entry_point: Option<&Path>,
  fallback_dir: &Path,
  strict: bool,
  features: CrateFeatures,
) -> Result<ModuleGraphResult> {
  let resolved_entry = entry_point
    .map(|p| p.to_path_buf())
    .or_else(|| find_entry_point(fallback_dir));

  match resolved_entry {
    Some(entry_path) => {
      let mut ctx = WalkContext::new(strict, features);
      walk_module_file(&entry_path, None, &mut ctx)?;
      Ok(ModuleGraphResult {
        files: ctx.files,
        namespace_map: ctx.namespace_map,
      })
    }
    None => {
      // No entry point found — fall back to filesystem walk
      let files = crate::walker::walk_rs_files(fallback_dir, strict)?;
      Ok(ModuleGraphResult {
        files,
        namespace_map: HashMap::new(),
      })
    }
  }
}

fn find_entry_point(scan_dir: &Path) -> Option<PathBuf> {
  let lib = scan_dir.join("lib.rs");
  if lib.exists() {
    return Some(lib);
  }
  let main = scan_dir.join("main.rs");
  if main.exists() {
    return Some(main);
  }
  None
}

struct WalkContext {
  files: Vec<(String, String)>,
  namespace_map: HashMap<String, String>,
  visited: HashSet<PathBuf>,
  strict: bool,
  features: CrateFeatures,
}

impl WalkContext {
  fn new(strict: bool, features: CrateFeatures) -> Self {
    Self {
      files: Vec::new(),
      namespace_map: HashMap::new(),
      visited: HashSet::new(),
      strict,
      features,
    }
  }
}

/// Process a single module file: record it, parse it, and recurse into child modules.
fn walk_module_file(
  file_path: &Path,
  namespace: Option<&str>,
  ctx: &mut WalkContext,
) -> Result<()> {
  // Canonicalize for dedup (handles symlinks, relative paths)
  let canonical = file_path
    .canonicalize()
    .unwrap_or_else(|_| file_path.to_path_buf());

  if !ctx.visited.insert(canonical.clone()) {
    return Ok(()); // Already visited — cycle protection
  }

  // Read file
  let content = match std::fs::read_to_string(&canonical) {
    Ok(c) => c,
    Err(e) => {
      if ctx.strict {
        return Err(anyhow::anyhow!(
          "Failed to read {}: {}",
          file_path.display(),
          e
        ));
      }
      eprintln!("Warning: Failed to read {}: {}", file_path.display(), e);
      return Ok(());
    }
  };

  let path_str = canonical.display().to_string();

  // Record namespace mapping
  if let Some(ns) = namespace {
    ctx.namespace_map.insert(path_str.clone(), ns.to_string());
  }

  // Only include in extraction list if it contains "napi" (pre-filter optimization)
  if content.contains("napi") {
    ctx.files.push((path_str, content.clone()));
  }

  // Parse to find mod declarations and recurse
  let parsed = match syn::parse_file(&content) {
    Ok(f) => f,
    Err(_) => return Ok(()), // Parse errors caught later during extraction
  };

  let mod_dir = parent_module_dir(&canonical);
  walk_items_for_mods(&parsed.items, &mod_dir, &[], namespace, ctx)?;

  Ok(())
}

/// Result of evaluating a cfg predicate with `test` set to `false`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CfgTestEval {
  /// The predicate is always true when test=false (regardless of other variables)
  AlwaysTrue,
  /// The predicate is always false when test=false
  AlwaysFalse,
  /// The predicate's value depends on other variables when test=false
  Unknown,
}

/// Evaluate a cfg predicate with `test` substituted to `false` and
/// `feature = "X"` evaluated against the crate's default features.
///
/// This implements three-valued Boolean logic: atoms that aren't `test`
/// or a feature predicate evaluate to `Unknown` (free variables), while
/// `test` evaluates to `AlwaysFalse`. Feature predicates (`feature = "X"`)
/// evaluate to `AlwaysTrue` if enabled, `AlwaysFalse` otherwise (Cargo
/// cannot set a feature that isn't resolved for the package). The standard
/// Boolean connectives (`all`, `any`, `not`) propagate values correctly.
fn eval_cfg(meta: &syn::Meta, features: &CrateFeatures) -> CfgTestEval {
  match meta {
    syn::Meta::Path(path) => {
      if path.is_ident("test") {
        CfgTestEval::AlwaysFalse
      } else {
        CfgTestEval::Unknown
      }
    }
    syn::Meta::NameValue(nv) => {
      // Evaluate feature = "X" using default features
      if nv.path.is_ident("feature") {
        if let syn::Expr::Lit(lit) = &nv.value {
          if let syn::Lit::Str(s) = &lit.lit {
            let feat = s.value();
            return if features.enabled.contains(&feat) {
              CfgTestEval::AlwaysTrue
            } else {
              // Feature is either declared-but-not-enabled or undeclared.
              // Either way, Cargo won't set it for this package.
              CfgTestEval::AlwaysFalse
            };
          }
        }
      }
      CfgTestEval::Unknown
    }
    syn::Meta::List(list) => {
      let ident = list.path.get_ident().map(|i| i.to_string());
      match ident.as_deref() {
        Some("all") => {
          if let Ok(args) = list.parse_args_with(
            syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated,
          ) {
            if args
              .iter()
              .any(|a| eval_cfg(a, features) == CfgTestEval::AlwaysFalse)
            {
              CfgTestEval::AlwaysFalse
            } else if args
              .iter()
              .all(|a| eval_cfg(a, features) == CfgTestEval::AlwaysTrue)
            {
              CfgTestEval::AlwaysTrue
            } else {
              CfgTestEval::Unknown
            }
          } else {
            CfgTestEval::Unknown
          }
        }
        Some("any") => {
          if let Ok(args) = list.parse_args_with(
            syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated,
          ) {
            if args
              .iter()
              .any(|a| eval_cfg(a, features) == CfgTestEval::AlwaysTrue)
            {
              CfgTestEval::AlwaysTrue
            } else if args
              .iter()
              .all(|a| eval_cfg(a, features) == CfgTestEval::AlwaysFalse)
            {
              CfgTestEval::AlwaysFalse
            } else {
              CfgTestEval::Unknown
            }
          } else {
            CfgTestEval::Unknown
          }
        }
        Some("not") => {
          if let Ok(inner) = list.parse_args::<syn::Meta>() {
            match eval_cfg(&inner, features) {
              CfgTestEval::AlwaysTrue => CfgTestEval::AlwaysFalse,
              CfgTestEval::AlwaysFalse => CfgTestEval::AlwaysTrue,
              CfgTestEval::Unknown => CfgTestEval::Unknown,
            }
          } else {
            CfgTestEval::Unknown
          }
        }
        _ => CfgTestEval::Unknown,
      }
    }
  }
}

/// Check if a cfg predicate is always false in a default (non-test) build.
///
/// This covers `test`-gated code as well as feature-gated code where the
/// feature is not in the resolved enabled set.
///
/// Handles all Boolean combinations correctly:
/// - `#[cfg(test)]` -> inactive
/// - `#[cfg(all(test, ...))]` -> inactive (test is required)
/// - `#[cfg(feature = "x")]` where x is non-default -> inactive
/// - `#[cfg(any(test, ...))]` -> keep (non-test branches may be active)
/// - `#[cfg(not(test))]` -> keep (inverted)
fn cfg_is_inactive(meta: &syn::Meta, features: &CrateFeatures) -> bool {
  eval_cfg(meta, features) == CfgTestEval::AlwaysFalse
}

/// Check if a module is gated by a cfg predicate that is always false in
/// a default (non-test) build. These modules should not produce type definitions.
///
/// Handles compound expressions: `#[cfg(test)]`, `#[cfg(all(test, ...))]`,
/// `#[cfg(feature = "x")]` for non-default features, and nested combinations.
fn is_cfg_inactive(attrs: &[syn::Attribute], features: &CrateFeatures) -> bool {
  attrs.iter().any(|attr| {
    if !attr.path().is_ident("cfg") {
      return false;
    }
    attr
      .parse_args::<syn::Meta>()
      .map_or(false, |meta| cfg_is_inactive(&meta, features))
  })
}

/// Walk items in a module looking for `mod` declarations to recurse into.
fn walk_items_for_mods(
  items: &[Item],
  base_dir: &Path,
  inline_path: &[String],
  namespace: Option<&str>,
  ctx: &mut WalkContext,
) -> Result<()> {
  for item in items {
    if let Item::Mod(m) = item {
      // Skip #[cfg(test)] modules — test code should never produce type definitions.
      // Other #[cfg(...)] predicates cannot be reliably evaluated by static analysis
      // (we don't know active features, target platform, etc.) and are intentionally
      // left as-is. This matches the existing behavior documented in visitor.rs for
      // item-level cfg_attr.
      if is_cfg_inactive(&m.attrs, &ctx.features) {
        continue;
      }

      let is_napi = m.attrs.iter().any(|a| is_napi_attr(a));

      // Determine namespace for children
      let child_namespace: Option<String> = if is_napi {
        Some(compute_mod_js_name(m))
      } else {
        None
      };
      let effective_ns = child_namespace.as_deref().or(namespace);

      if let Some((_, child_items)) = &m.content {
        // Inline module — recurse into items with updated inline_path
        let mut new_inline_path = inline_path.to_vec();
        new_inline_path.push(m.ident.to_string());
        walk_items_for_mods(child_items, base_dir, &new_inline_path, effective_ns, ctx)?;
      } else {
        // File-backed module — resolve path and recurse
        let path_override = extract_path_attr(&m.attrs, &ctx.features);
        if let Some(file_path) =
          resolve_mod_path(base_dir, inline_path, &m.ident.to_string(), &path_override)
        {
          walk_module_file(&file_path, effective_ns, ctx)?;
        } else if ctx.strict {
          return Err(anyhow::anyhow!(
            "Could not find module file for `mod {}`",
            m.ident
          ));
        }
        // In non-strict mode, silently skip missing modules
        // (they may be behind #[cfg] gates that aren't active)
      }
    }
  }
  Ok(())
}

/// Strip the raw identifier prefix (`r#`) from a name.
/// Rust's `mod r#async;` resolves to `async.rs`, not `r#async.rs`.
fn strip_raw_prefix(name: &str) -> &str {
  name.strip_prefix("r#").unwrap_or(name)
}

/// Resolve a file-backed module's path.
/// Handles #[path = "..."] override, #[cfg_attr(..., path = "...")] candidates,
/// and standard foo.rs / foo/mod.rs layout.
fn resolve_mod_path(
  base_dir: &Path,
  inline_path: &[String],
  mod_name: &str,
  path_override: &ModPathOverride,
) -> Option<PathBuf> {
  // Build the directory where this module's file should be
  let mut dir = base_dir.to_path_buf();
  for seg in inline_path {
    dir = dir.join(strip_raw_prefix(seg));
  }

  // Direct #[path = "..."] — authoritative, no fallback
  if let Some(ref custom_path) = path_override.direct {
    let resolved = dir.join(custom_path);
    return if resolved.exists() {
      Some(resolved)
    } else {
      None
    };
  }

  // cfg_attr candidates — try each before falling back to standard layout
  for candidate in &path_override.cfg_attr_candidates {
    let resolved = dir.join(candidate);
    if resolved.exists() {
      return Some(resolved);
    }
  }

  // Strip r# prefix — `mod r#async;` looks for `async.rs`, not `r#async.rs`
  let mod_name = strip_raw_prefix(mod_name);

  // Standard layout: foo.rs
  let file_rs = dir.join(format!("{}.rs", mod_name));
  if file_rs.exists() {
    return Some(file_rs);
  }

  // Standard layout: foo/mod.rs
  let file_mod = dir.join(mod_name).join("mod.rs");
  if file_mod.exists() {
    return Some(file_mod);
  }

  None
}

/// Extracted path overrides from module attributes.
struct ModPathOverride {
  /// Direct `#[path = "..."]` — authoritative, no fallback to standard layout
  direct: Option<String>,
  /// `#[cfg_attr(..., path = "...")]` — best-effort candidates, with fallback
  cfg_attr_candidates: Vec<String>,
}

/// Extract path overrides from a list of attributes.
///
/// Handles both direct `#[path = "..."]` and `#[cfg_attr(..., path = "...")]`.
fn extract_path_attr(attrs: &[syn::Attribute], features: &CrateFeatures) -> ModPathOverride {
  let mut direct = None;
  let mut always_true_paths: Vec<String> = Vec::new();
  let mut unknown_paths: Vec<String> = Vec::new();

  for attr in attrs {
    // Direct #[path = "..."]
    if attr.path().is_ident("path") {
      if let syn::Meta::NameValue(nv) = &attr.meta {
        if let syn::Expr::Lit(lit) = &nv.value {
          if let syn::Lit::Str(s) = &lit.lit {
            direct = Some(s.value());
          }
        }
      }
    }

    // #[cfg_attr(..., path = "...")]
    if attr.path().is_ident("cfg_attr") {
      if let syn::Meta::List(list) = &attr.meta {
        if let Ok(args) = list.parse_args_with(
          syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated,
        ) {
          // First arg is the cfg condition — evaluate it with test=false
          let condition_eval = args
            .first()
            .map(|m| eval_cfg(m, features))
            .unwrap_or(CfgTestEval::Unknown);

          // Skip test-only cfg_attr (condition is always false in non-test builds)
          if condition_eval == CfgTestEval::AlwaysFalse {
            continue;
          }

          // Check remaining args for path = "..."
          for meta in args.iter().skip(1) {
            if let syn::Meta::NameValue(nv) = meta {
              if nv.path.is_ident("path") {
                if let syn::Expr::Lit(lit) = &nv.value {
                  if let syn::Lit::Str(s) = &lit.lit {
                    match condition_eval {
                      CfgTestEval::AlwaysTrue => always_true_paths.push(s.value()),
                      _ => unknown_paths.push(s.value()),
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // AlwaysTrue candidates first (definitely active in non-test builds)
  let mut cfg_attr_candidates = always_true_paths;
  cfg_attr_candidates.extend(unknown_paths);

  ModPathOverride {
    direct,
    cfg_attr_candidates,
  }
}

/// Compute the JavaScript name for a `#[napi] mod` declaration.
fn compute_mod_js_name(m: &syn::ItemMod) -> String {
  m.attrs
    .iter()
    .find(|a| is_napi_attr(a))
    .and_then(|attr| {
      BindgenAttrs::try_from(attr)
        .ok()
        .and_then(|opts| opts.js_name().map(|(name, _)| name.to_owned()))
    })
    .unwrap_or_else(|| m.ident.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  // ── Helpers ──────────────────────────────────────────────────────

  fn features(enabled: &[&str]) -> CrateFeatures {
    CrateFeatures {
      enabled: enabled.iter().map(|s| s.to_string()).collect(),
    }
  }

  fn parse_meta(s: &str) -> syn::Meta {
    syn::parse_str(s).unwrap_or_else(|e| panic!("Failed to parse meta `{s}`: {e}"))
  }

  // ── eval_cfg unit tests ──────────────────────────────────────────

  #[test]
  fn eval_bare_test() {
    assert_eq!(
      eval_cfg(&parse_meta("test"), &features(&[])),
      CfgTestEval::AlwaysFalse
    );
  }

  #[test]
  fn eval_not_test() {
    assert_eq!(
      eval_cfg(&parse_meta("not(test)"), &features(&[])),
      CfgTestEval::AlwaysTrue
    );
  }

  #[test]
  fn eval_double_not_test() {
    assert_eq!(
      eval_cfg(&parse_meta("not(not(test))"), &features(&[])),
      CfgTestEval::AlwaysFalse
    );
  }

  #[test]
  fn eval_enabled_feature() {
    assert_eq!(
      eval_cfg(&parse_meta(r#"feature = "foo""#), &features(&["foo"])),
      CfgTestEval::AlwaysTrue
    );
  }

  #[test]
  fn eval_disabled_feature() {
    assert_eq!(
      eval_cfg(&parse_meta(r#"feature = "foo""#), &features(&[])),
      CfgTestEval::AlwaysFalse
    );
  }

  #[test]
  fn eval_undeclared_feature_is_false() {
    // Even with some features enabled, an unrelated feature is still false
    assert_eq!(
      eval_cfg(
        &parse_meta(r#"feature = "typo""#),
        &features(&["default", "real"])
      ),
      CfgTestEval::AlwaysFalse
    );
  }

  #[test]
  fn eval_all_with_test() {
    // all(test, ...) is always false because test is false
    assert_eq!(
      eval_cfg(
        &parse_meta(r#"all(test, feature = "foo")"#),
        &features(&["foo"])
      ),
      CfgTestEval::AlwaysFalse
    );
  }

  #[test]
  fn eval_any_test_and_disabled_feature() {
    // any(test, feature) where both are false → false
    assert_eq!(
      eval_cfg(&parse_meta(r#"any(test, feature = "foo")"#), &features(&[])),
      CfgTestEval::AlwaysFalse
    );
  }

  #[test]
  fn eval_any_test_and_enabled_feature() {
    // any(test, feature) where feature is true → true
    assert_eq!(
      eval_cfg(
        &parse_meta(r#"any(test, feature = "foo")"#),
        &features(&["foo"])
      ),
      CfgTestEval::AlwaysTrue
    );
  }

  #[test]
  fn eval_not_any_not_test_and_feature() {
    // not(any(not(test), feature = "foo")) = test && !foo
    // With foo disabled: test is false → always false
    assert_eq!(
      eval_cfg(
        &parse_meta(r#"not(any(not(test), feature = "foo"))"#),
        &features(&[])
      ),
      CfgTestEval::AlwaysFalse
    );
  }

  #[test]
  fn eval_unknown_predicate() {
    assert_eq!(
      eval_cfg(&parse_meta("unix"), &features(&[])),
      CfgTestEval::Unknown
    );
  }

  #[test]
  fn eval_all_with_unknown() {
    // all(unix, feature = "foo") with foo enabled: unix is unknown → unknown
    assert_eq!(
      eval_cfg(
        &parse_meta(r#"all(unix, feature = "foo")"#),
        &features(&["foo"])
      ),
      CfgTestEval::Unknown
    );
  }

  #[test]
  fn eval_not_feature() {
    assert_eq!(
      eval_cfg(&parse_meta(r#"not(feature = "foo")"#), &features(&[])),
      CfgTestEval::AlwaysTrue
    );
    assert_eq!(
      eval_cfg(&parse_meta(r#"not(feature = "foo")"#), &features(&["foo"])),
      CfgTestEval::AlwaysFalse
    );
  }

  // ── Module graph integration tests ───────────────────────────────

  /// Helper to create a temporary crate directory with given files.
  struct TestCrate {
    dir: PathBuf,
  }

  impl TestCrate {
    fn new(name: &str, files: &[(&str, &str)]) -> Self {
      let dir =
        std::env::temp_dir().join(format!("napi-typegen-test-{}-{}", name, std::process::id()));
      let _ = std::fs::remove_dir_all(&dir);
      std::fs::create_dir_all(&dir).unwrap();
      for (path, content) in files {
        let full = dir.join(path);
        if let Some(parent) = full.parent() {
          std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&full, content).unwrap();
      }
      TestCrate { dir }
    }

    fn walk(&self, feat: &[&str]) -> ModuleGraphResult {
      let entry = self.dir.join("lib.rs");
      walk_module_graph(Some(&entry), &self.dir, false, features(feat))
        .expect("walk_module_graph failed")
    }

    /// Get the file names relative to the crate dir from a walk result.
    fn file_names(&self, result: &ModuleGraphResult) -> Vec<String> {
      let canon = self.dir.canonicalize().unwrap();
      result
        .files
        .iter()
        .filter_map(|(p, _)| {
          PathBuf::from(p)
            .strip_prefix(&canon)
            .ok()
            .map(|rel| rel.to_string_lossy().to_string())
        })
        .collect()
    }
  }

  impl Drop for TestCrate {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.dir);
    }
  }

  #[test]
  fn walk_excludes_orphan_files() {
    let tc = TestCrate::new(
      "orphan",
      &[
        ("lib.rs", "mod included;\n"),
        (
          "included.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn included() -> u32 { 0 }\n",
        ),
        (
          "orphan.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn orphan() -> u32 { 0 }\n",
        ),
      ],
    );
    let result = tc.walk(&[]);
    let names = tc.file_names(&result);
    assert!(
      names.iter().any(|n| n.contains("included")),
      "included.rs should be present: {names:?}"
    );
    assert!(
      !names.iter().any(|n| n.contains("orphan")),
      "orphan.rs should NOT be present: {names:?}"
    );
  }

  #[test]
  fn walk_skips_cfg_test_module() {
    let tc = TestCrate::new(
      "cfg-test",
      &[
        ("lib.rs", "#[cfg(test)]\nmod tests;\nmod real;\n"),
        (
          "tests.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn test_fn() -> u32 { 0 }\n",
        ),
        (
          "real.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn real_fn() -> u32 { 0 }\n",
        ),
      ],
    );
    let result = tc.walk(&[]);
    let names = tc.file_names(&result);
    assert!(
      names.iter().any(|n| n.contains("real")),
      "real.rs should be present: {names:?}"
    );
    assert!(
      !names.iter().any(|n| n.contains("tests")),
      "tests.rs should NOT be present: {names:?}"
    );
  }

  #[test]
  fn walk_skips_compound_cfg_test() {
    let tc = TestCrate::new(
      "compound-cfg",
      &[
        (
          "lib.rs",
          "#[cfg(all(test, feature = \"test-utils\"))]\nmod test_utils;\nmod real;\n",
        ),
        (
          "test_utils.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn test_util() -> u32 { 0 }\n",
        ),
        (
          "real.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn real() -> u32 { 0 }\n",
        ),
      ],
    );
    let result = tc.walk(&["default", "test-utils"]);
    let names = tc.file_names(&result);
    assert!(
      names.iter().any(|n| n.contains("real")),
      "real.rs should be present: {names:?}"
    );
    assert!(
      !names.iter().any(|n| n.contains("test_utils")),
      "test_utils.rs should be skipped: {names:?}"
    );
  }

  #[test]
  fn walk_cfg_attr_path_prefers_non_test() {
    let tc = TestCrate::new(
      "cfg-attr-path",
      &[
        (
          "lib.rs",
          concat!(
            "#[cfg_attr(test, path = \"test_impl.rs\")]\n",
            "#[cfg_attr(not(test), path = \"prod_impl.rs\")]\n",
            "mod gated;\n"
          ),
        ),
        (
          "test_impl.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn test_only() -> u32 { 0 }\n",
        ),
        (
          "prod_impl.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn prod_only() -> u32 { 0 }\n",
        ),
      ],
    );
    let result = tc.walk(&[]);
    let names = tc.file_names(&result);
    assert!(
      names.iter().any(|n| n.contains("prod_impl")),
      "prod_impl.rs should be present: {names:?}"
    );
    assert!(
      !names.iter().any(|n| n.contains("test_impl")),
      "test_impl.rs should NOT be present: {names:?}"
    );
  }

  #[test]
  fn walk_feature_gated_path_disabled() {
    let tc = TestCrate::new(
      "feat-path-off",
      &[
        (
          "lib.rs",
          concat!(
            "#[cfg_attr(feature = \"alt\", path = \"alt.rs\")]\n",
            "#[cfg_attr(not(feature = \"alt\"), path = \"default.rs\")]\n",
            "mod gated;\n"
          ),
        ),
        (
          "alt.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn alt_fn() -> u32 { 0 }\n",
        ),
        (
          "default.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn default_fn() -> u32 { 0 }\n",
        ),
      ],
    );
    // "alt" NOT enabled
    let result = tc.walk(&["default"]);
    let names = tc.file_names(&result);
    assert!(
      names.iter().any(|n| n == "default.rs"),
      "default.rs should be present: {names:?}"
    );
    assert!(
      !names.iter().any(|n| n == "alt.rs"),
      "alt.rs should NOT be present: {names:?}"
    );
  }

  #[test]
  fn walk_feature_gated_path_enabled() {
    let tc = TestCrate::new(
      "feat-path-on",
      &[
        (
          "lib.rs",
          concat!(
            "#[cfg_attr(feature = \"alt\", path = \"alt.rs\")]\n",
            "#[cfg_attr(not(feature = \"alt\"), path = \"default.rs\")]\n",
            "mod gated;\n"
          ),
        ),
        (
          "alt.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn alt_fn() -> u32 { 0 }\n",
        ),
        (
          "default.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn default_fn() -> u32 { 0 }\n",
        ),
      ],
    );
    // "alt" IS enabled
    let result = tc.walk(&["default", "alt"]);
    let names = tc.file_names(&result);
    assert!(
      names.iter().any(|n| n == "alt.rs"),
      "alt.rs should be present: {names:?}"
    );
    assert!(
      !names.iter().any(|n| n == "default.rs"),
      "default.rs should NOT be present: {names:?}"
    );
  }

  #[test]
  fn walk_undeclared_feature_module_skipped() {
    let tc = TestCrate::new(
      "undeclared-feat",
      &[
        (
          "lib.rs",
          "#[cfg(feature = \"typo\")]\nmod ghost;\nmod real;\n",
        ),
        (
          "ghost.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn ghost() -> u32 { 0 }\n",
        ),
        (
          "real.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn real() -> u32 { 0 }\n",
        ),
      ],
    );
    let result = tc.walk(&["default"]);
    let names = tc.file_names(&result);
    assert!(
      names.iter().any(|n| n.contains("real")),
      "real.rs should be present: {names:?}"
    );
    assert!(
      !names.iter().any(|n| n.contains("ghost")),
      "ghost.rs should NOT be present: {names:?}"
    );
  }

  #[test]
  fn walk_raw_identifier_module() {
    let tc = TestCrate::new(
      "raw-ident",
      &[
        ("lib.rs", "mod r#async;\n"),
        (
          "async.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn async_fn() -> u32 { 0 }\n",
        ),
      ],
    );
    let result = tc.walk(&[]);
    let names = tc.file_names(&result);
    assert!(
      names.iter().any(|n| n.contains("async")),
      "async.rs should be found for mod r#async: {names:?}"
    );
  }

  #[test]
  fn walk_namespace_propagation() {
    let tc = TestCrate::new(
      "namespace",
      &[
        ("lib.rs", "#[napi]\nmod ns {\n  mod child;\n}\n"),
        (
          "ns/child.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn child_fn() -> u32 { 0 }\n",
        ),
      ],
    );
    let result = tc.walk(&[]);
    let names = tc.file_names(&result);
    assert!(
      names.iter().any(|n| n.contains("child")),
      "ns/child.rs should be found: {names:?}"
    );
    // Check namespace mapping
    if let Some((path, _)) = result.files.iter().find(|(p, _)| p.contains("child")) {
      assert_eq!(
        result.namespace_map.get(path).map(|s| s.as_str()),
        Some("ns"),
        "child should have namespace 'ns'"
      );
    }
  }

  #[test]
  fn walk_direct_path_attribute() {
    let tc = TestCrate::new(
      "direct-path",
      &[
        ("lib.rs", "#[path = \"custom.rs\"]\nmod gated;\n"),
        (
          "custom.rs",
          "use napi::bindgen_prelude::*;\n#[napi]\npub fn custom_fn() -> u32 { 0 }\n",
        ),
      ],
    );
    let result = tc.walk(&[]);
    let names = tc.file_names(&result);
    assert!(
      names.iter().any(|n| n.contains("custom")),
      "custom.rs should be found via #[path]: {names:?}"
    );
  }
}
