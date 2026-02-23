pub mod resolve;
pub mod visitor;
pub mod walker;

use anyhow::{Context, Result};
use napi_derive_backend::ToTypeDef;

use crate::resolve::{resolve_napi_dependency_dirs, MetadataSource};
use crate::visitor::{convert_items, extract_napi_items, CategorizedItems};
use crate::walker::walk_rs_files;

#[derive(Debug)]
pub struct TypegenResult {
  pub type_defs: Vec<String>,
  pub parse_errors: u32,
}

/// Core pipeline: walk → parse → extract → convert → serialize.
/// Returns sorted JSONL lines identical to binary stdout.
pub fn generate_type_defs(
  crate_dir: &std::path::Path,
  cargo_metadata_path: Option<&std::path::Path>,
  strict: bool,
) -> Result<TypegenResult> {
  let crate_dir = crate_dir
    .canonicalize()
    .with_context(|| format!("Failed to resolve crate directory: {}", crate_dir.display()))?;

  // Determine the source directory
  let src_dir = crate_dir.join("src");
  let scan_dir = if src_dir.is_dir() {
    &src_dir
  } else {
    &crate_dir
  };

  let mut all_items: Option<CategorizedItems> = None;
  let mut parse_errors = 0u32;

  // Phase 1a: Resolve and process path dependencies that use napi-derive.
  // Their #[napi] items (especially structs) must be registered before the
  // main crate so that cross-crate type references resolve correctly.
  let metadata_source = match cargo_metadata_path {
    Some(path) => MetadataSource::File(path.to_path_buf()),
    None => MetadataSource::Command,
  };
  let dep_dirs = resolve_napi_dependency_dirs(&crate_dir, &metadata_source)
    .context("Failed to resolve workspace dependencies")?;
  for dep_dir in &dep_dirs {
    let dep_src = dep_dir.join("src");
    let dep_scan = if dep_src.is_dir() {
      &dep_src
    } else {
      dep_dir.as_path()
    };
    let dep_files = walk_rs_files(dep_scan, false)
      .with_context(|| format!("Failed to walk dependency {}", dep_dir.display()))?;
    parse_errors += collect_napi_items(&dep_files, &mut all_items, strict)?;
  }

  // Phase 1b: Walk and collect all .rs files containing "napi" from the main crate
  let files = walk_rs_files(scan_dir, strict).context("Failed to walk source files")?;

  // Phase 2: Parse main crate files and extract #[napi] items
  parse_errors += collect_napi_items(&files, &mut all_items, strict)?;

  // Phase 3: Convert items to Napi IR (two-pass: structs first, then rest)
  let napi_items = match all_items {
    Some(categorized) => {
      convert_items(categorized, strict).context("Failed to convert items to Napi IR")?
    }
    None => Vec::new(),
  };

  // Phase 4: Generate TypeDefs and sort for deterministic output regardless
  // of file walk order — important for reproducible builds, e.g. Nix
  let mut type_defs: Vec<String> = napi_items
    .iter()
    .filter_map(|napi| napi.to_type_def())
    .map(|td| td.to_string())
    .collect();
  type_defs.sort();

  if type_defs.is_empty() && parse_errors == 0 {
    eprintln!(
      "Warning: No #[napi] items found in {}. \
       Check that --crate-dir points to a crate using napi-rs.",
      crate_dir.display()
    );
  }

  Ok(TypegenResult {
    type_defs,
    parse_errors,
  })
}

/// Parse a set of files and merge their #[napi] items into the accumulator.
/// Returns the number of files that had parse errors.
fn collect_napi_items(
  files: &[(String, String)],
  all_items: &mut Option<CategorizedItems>,
  strict: bool,
) -> Result<u32> {
  let mut parse_errors = 0u32;

  for (path, content) in files {
    match syn::parse_file(content) {
      Ok(file) => match extract_napi_items(&file) {
        Ok(categorized) => {
          all_items
            .get_or_insert_with(Default::default)
            .merge(categorized);
        }
        Err(e) => {
          parse_errors += 1;
          if strict {
            return Err(e.context(format!("Failed to extract napi items from {}", path)));
          }
          eprintln!("Warning: Failed to extract napi items from {}: {}", path, e);
        }
      },
      Err(e) => {
        parse_errors += 1;
        if strict {
          return Err(anyhow::anyhow!("Failed to parse {}: {}", path, e));
        }
        eprintln!("Warning: Failed to parse {}: {}", path, e);
      }
    }
  }

  Ok(parse_errors)
}
