use std::path::Path;

use anyhow::Result;
use ignore::WalkBuilder;

/// Walk the given directory for `.rs` files that potentially contain `#[napi]` attributes.
/// Uses `ignore` crate for traversal and respects `.gitignore`.
/// Symlink loop detection is enabled by default via `WalkBuilder`.
/// Returns `(path_string, file_content)` pairs.
///
/// **Note:** All matching file contents are collected into memory. This is fine for typical
/// napi crates but could consume significant memory if pointed at a very large codebase
/// (e.g. a monorepo root instead of a specific crate directory).
pub fn walk_rs_files(root: &Path, strict: bool) -> Result<Vec<(String, String)>> {
  let mut results = Vec::new();

  let walker = WalkBuilder::new(root)
    .hidden(false) // don't skip hidden files inside the crate
    .filter_entry(|entry| {
      // Skip target directories and non-relevant paths
      let name = entry.file_name().to_string_lossy();
      if entry.file_type().is_some_and(|ft| ft.is_dir()) {
        return name != "target" && name != ".git" && name != "node_modules";
      }
      true
    })
    .build();

  for entry in walker {
    let entry = entry?;
    let path = entry.path();

    // Only process .rs files
    if path.extension().is_none_or(|ext| ext != "rs") {
      continue;
    }

    let content = match std::fs::read_to_string(path) {
      Ok(c) => c,
      Err(e) => {
        if strict {
          return Err(anyhow::anyhow!("Failed to read {}: {}", path.display(), e));
        }
        eprintln!("Warning: Failed to read {}: {}", path.display(), e);
        continue;
      }
    };

    // Pre-filter: skip files that don't contain "napi" at all (fast path)
    if !content.contains("napi") {
      continue;
    }

    results.push((path.display().to_string(), content));
  }

  Ok(results)
}
