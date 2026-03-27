use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use anyhow::Result;
use napi_derive_backend::parser::attrs::BindgenAttrs;
use syn::Item;

use crate::visitor::{is_napi_attr, parent_module_dir};

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
) -> Result<ModuleGraphResult> {
  let resolved_entry = entry_point
    .map(|p| p.to_path_buf())
    .or_else(|| find_entry_point(fallback_dir));

  match resolved_entry {
    Some(entry_path) => {
      let mut ctx = WalkContext::new(strict);
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
}

impl WalkContext {
  fn new(strict: bool) -> Self {
    Self {
      files: Vec::new(),
      namespace_map: HashMap::new(),
      visited: HashSet::new(),
      strict,
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
#[derive(Clone, Copy, PartialEq, Eq)]
enum CfgTestEval {
  /// The predicate is always true when test=false (regardless of other variables)
  AlwaysTrue,
  /// The predicate is always false when test=false
  AlwaysFalse,
  /// The predicate's value depends on other variables when test=false
  Unknown,
}

/// Evaluate a cfg predicate with `test` substituted to `false`.
///
/// This implements three-valued Boolean logic: atoms that aren't `test`
/// evaluate to `Unknown` (free variables), while `test` evaluates to
/// `AlwaysFalse`. The standard Boolean connectives (`all`, `any`, `not`)
/// propagate these values correctly.
fn eval_cfg_without_test(meta: &syn::Meta) -> CfgTestEval {
  match meta {
    syn::Meta::Path(path) => {
      if path.is_ident("test") {
        CfgTestEval::AlwaysFalse
      } else {
        CfgTestEval::Unknown
      }
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
              .any(|a| eval_cfg_without_test(a) == CfgTestEval::AlwaysFalse)
            {
              CfgTestEval::AlwaysFalse
            } else if args
              .iter()
              .all(|a| eval_cfg_without_test(a) == CfgTestEval::AlwaysTrue)
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
              .any(|a| eval_cfg_without_test(a) == CfgTestEval::AlwaysTrue)
            {
              CfgTestEval::AlwaysTrue
            } else if args
              .iter()
              .all(|a| eval_cfg_without_test(a) == CfgTestEval::AlwaysFalse)
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
            match eval_cfg_without_test(&inner) {
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
    syn::Meta::NameValue(_) => CfgTestEval::Unknown,
  }
}

/// Check if a cfg predicate *requires* `test` to be true.
///
/// Substitutes `test = false` into the predicate and checks if the result
/// is always false. If so, the predicate can only be satisfied when
/// `test = true`, meaning the gated code is exclusively test code.
///
/// Handles all Boolean combinations correctly:
/// - `#[cfg(test)]` -> skip
/// - `#[cfg(all(test, ...))]` -> skip (test is required)
/// - `#[cfg(not(any(not(test), ...)))]` -> skip (simplifies to test && ...)
/// - `#[cfg(any(test, ...))]` -> keep (non-test branches may be active)
/// - `#[cfg(not(test))]` -> keep (inverted)
fn cfg_requires_test(meta: &syn::Meta) -> bool {
  eval_cfg_without_test(meta) == CfgTestEval::AlwaysFalse
}

/// Check if a module is gated by a cfg predicate that requires `test`.
/// These modules contain test code that should never appear in type definitions.
///
/// Handles compound expressions: `#[cfg(test)]`, `#[cfg(all(test, ...))]`,
/// and nested combinations. Does NOT skip `#[cfg(any(test, ...))]` or
/// `#[cfg(not(test))]` because those modules may be active in normal builds.
fn is_cfg_test(attrs: &[syn::Attribute]) -> bool {
  attrs.iter().any(|attr| {
    if !attr.path().is_ident("cfg") {
      return false;
    }
    attr
      .parse_args::<syn::Meta>()
      .map_or(false, |meta| cfg_requires_test(&meta))
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
      if is_cfg_test(&m.attrs) {
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
        let path_override = extract_path_attr(&m.attrs);
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
fn extract_path_attr(attrs: &[syn::Attribute]) -> ModPathOverride {
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
            .map(eval_cfg_without_test)
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
