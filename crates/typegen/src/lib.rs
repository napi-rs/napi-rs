pub mod visitor;
pub mod walker;

use anyhow::{Context, Result};
use napi_derive_backend::ToTypeDef;

use crate::visitor::{convert_items, extract_napi_items, CategorizedItems};
use crate::walker::walk_rs_files;

pub struct TypegenResult {
  pub type_defs: Vec<String>,
  pub parse_errors: u32,
}

/// Core pipeline: walk → parse → extract → convert → serialize.
/// Returns sorted JSONL lines identical to binary stdout.
pub fn generate_type_defs(crate_dir: &std::path::Path, strict: bool) -> Result<TypegenResult> {
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

  // Phase 1: Walk and collect all .rs files containing "napi"
  let files = walk_rs_files(scan_dir).context("Failed to walk source files")?;

  // Phase 2: Parse files and extract #[napi] items
  let mut all_items: Option<CategorizedItems> = None;
  let mut parse_errors = 0u32;

  for (path, content) in &files {
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
