use anyhow::{anyhow, Result};
use napi_derive_backend::parser::attrs::BindgenAttrs;
use napi_derive_backend::parser::ConvertToAST;
use napi_derive_backend::Napi;
use quote::ToTokens;
use syn::Item;

/// Categorized items from a parsed file, split for two-pass processing.
#[derive(Default)]
pub struct CategorizedItems {
  structs_and_enums: Vec<AnnotatedItem>,
  other_items: Vec<AnnotatedItem>,
}

impl CategorizedItems {
  /// Merge another set of categorized items into this one.
  pub fn merge(&mut self, other: CategorizedItems) {
    self.structs_and_enums.extend(other.structs_and_enums);
    self.other_items.extend(other.other_items);
  }
}

/// An item annotated with `#[napi]`, along with its parsed attributes.
pub struct AnnotatedItem {
  pub item: Item,
  pub opts: BindgenAttrs,
}

/// Extract all `#[napi]`-annotated items from a parsed syn::File.
/// Returns items categorized for two-pass processing.
pub fn extract_napi_items(file: &syn::File) -> Result<CategorizedItems> {
  let mut structs_and_enums = Vec::new();
  let mut other_items = Vec::new();

  for item in &file.items {
    visit_item(item, None, &mut structs_and_enums, &mut other_items)?;
  }

  Ok(CategorizedItems {
    structs_and_enums,
    other_items,
  })
}

/// Visit a single item, handling `#[napi] mod` namespace injection recursively.
fn visit_item(
  item: &Item,
  namespace: Option<&str>,
  structs_and_enums: &mut Vec<AnnotatedItem>,
  other_items: &mut Vec<AnnotatedItem>,
) -> Result<()> {
  match item {
    Item::Mod(js_mod) => {
      // Recurse into all inline modules (those with braces and content).
      // File-based modules (`mod foo;`) have no content here — their files
      // are walked independently by the file walker.
      if let Some((_, items)) = &js_mod.content {
        // If this mod has #[napi], it's a namespace — inject js_mod into child items
        let napi_attr = js_mod.attrs.iter().find(|attr| is_napi_attr(attr));

        let child_namespace = if let Some(napi_attr) = napi_attr {
          if namespace.is_some() {
            return Err(anyhow!(
              "napi module cannot be nested under another napi module"
            ));
          }

          let opts = BindgenAttrs::try_from(napi_attr)
            .map_err(|e| anyhow!("Failed to parse napi attribute on mod: {}", e))?;

          let js_name = opts.js_name().map_or_else(
            || js_mod.ident.to_string(),
            |(js_name, _)| js_name.to_owned(),
          );
          Some(js_name)
        } else {
          None
        };

        let ns = child_namespace.as_deref().or(namespace);
        for sub_item in items {
          visit_item(sub_item, ns, structs_and_enums, other_items)?;
        }
      }
    }
    Item::Fn(item_fn) => {
      if let Some(annotated) = try_extract_napi_item(item, &item_fn.attrs, namespace)? {
        other_items.push(annotated);
      }
    }
    Item::Struct(item_struct) => {
      if let Some(annotated) = try_extract_napi_item(item, &item_struct.attrs, namespace)? {
        structs_and_enums.push(annotated);
      }
    }
    Item::Enum(item_enum) => {
      if let Some(annotated) = try_extract_napi_item(item, &item_enum.attrs, namespace)? {
        structs_and_enums.push(annotated);
      }
    }
    Item::Impl(item_impl) => {
      if let Some(annotated) = try_extract_napi_item(item, &item_impl.attrs, namespace)? {
        other_items.push(annotated);
      }
    }
    Item::Const(item_const) => {
      if let Some(annotated) = try_extract_napi_item(item, &item_const.attrs, namespace)? {
        other_items.push(annotated);
      }
    }
    Item::Type(item_type) => {
      if let Some(annotated) = try_extract_napi_item(item, &item_type.attrs, namespace)? {
        other_items.push(annotated);
      }
    }
    _ => {}
  }

  Ok(())
}

/// Check whether the last segment of a path is `napi`.
/// Matches both `#[napi]` and `#[napi_derive::napi]`.
fn path_ends_with_napi(path: &syn::Path) -> bool {
  path.segments.last().is_some_and(|seg| seg.ident == "napi")
}

/// Check whether an attribute is a `#[napi]`, `#[napi_derive::napi]`,
/// or `#[cfg_attr(..., napi)]` / `#[cfg_attr(..., napi_derive::napi)]`.
///
/// **Known limitations** (inherent to static source parsing):
///
/// - Does not evaluate `cfg` predicates. Items gated behind e.g.
///   `#[cfg_attr(not(feature = "foo"), napi)]` are **always** included,
///   regardless of which features would be active at compile time.
///   This may produce phantom types in the `.d.ts` output for crates
///   that conditionally attach `#[napi]` via `cfg_attr`. `--strict` mode
///   does not detect this either, since the attribute parses successfully.
///
/// - Does not detect deeply nested cfg_attr, e.g.
///   `#[cfg_attr(feature = "x", cfg_attr(feature = "y", napi))]`.
///   This matches the proc-macro's own behavior.
fn is_napi_attr(attr: &syn::Attribute) -> bool {
  if path_ends_with_napi(attr.path()) {
    return true;
  }
  // Check for cfg_attr wrapping napi
  if !attr.path().is_ident("cfg_attr") {
    return false;
  }
  let Ok(list) = attr.meta.require_list() else {
    return false;
  };
  let Ok(args) = list
    .parse_args_with(syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated)
  else {
    return false;
  };
  args.iter().any(|m| path_ends_with_napi(m.path()))
}

/// Try to extract a `#[napi]`-annotated item. If the item has a `#[napi]` attribute,
/// parse it and return the annotated item with optional namespace injection.
/// Returns None if the item doesn't have a `#[napi]` attribute.
fn try_extract_napi_item(
  item: &Item,
  attrs: &[syn::Attribute],
  namespace: Option<&str>,
) -> Result<Option<AnnotatedItem>> {
  let napi_attr = match attrs.iter().find(|attr| is_napi_attr(attr)) {
    Some(attr) => attr,
    None => return Ok(None),
  };

  let opts = if let Some(ns) = namespace {
    // Inject namespace into the attribute, but only if no explicit namespace is set.
    // Scans the token stream for an Ident named "namespace". This avoids false positives
    // from string literals (which are Literal tokens, not Ident). It would not detect
    // `r#namespace` (a raw identifier), but we shouldn't expect raw identifiers in #[napi] attrs.
    let has_existing_namespace = matches!(&napi_attr.meta, syn::Meta::List(list)
                                              if list.tokens.clone().into_iter().any(|tt| matches!(&tt, proc_macro2::TokenTree::Ident(id) if id == "namespace")));

    let new_attr: syn::Attribute = if has_existing_namespace {
      // Item already has an explicit namespace — respect it, don't override
      napi_attr.clone()
    } else {
      match &napi_attr.meta {
        syn::Meta::Path(_) => {
          syn::parse_quote!(#[napi(namespace = #ns)])
        }
        syn::Meta::List(list) => {
          let existing = list.tokens.clone();
          syn::parse_quote!(#[napi(#existing, namespace = #ns)])
        }
        syn::Meta::NameValue(nv) => {
          // #[napi = ...] is not valid napi syntax; warn and discard the value
          eprintln!(
                        "Warning: unexpected #[napi = ...] syntax (value: {}), discarding value and injecting namespace only",
                        nv.value.to_token_stream()
                    );
          syn::parse_quote!(#[napi(namespace = #ns)])
        }
      }
    };
    BindgenAttrs::try_from(&new_attr)
      .map_err(|e| anyhow!("Failed to parse napi attribute: {}", e))?
  } else {
    BindgenAttrs::try_from(napi_attr)
      .map_err(|e| anyhow!("Failed to parse napi attribute: {}", e))?
  };

  if !opts.exists {
    // BindgenAttrs::try_from may set exists = false when it can't parse the
    // attribute content (e.g. a cfg_attr-wrapped attribute whose inner tokens
    // don't form valid napi options). Log this so it's visible during debugging.
    eprintln!(
      "Warning: #[napi] attribute found but parsed as non-existent (possibly \
       a cfg_attr whose content is not valid napi options), skipping item"
    );
    return Ok(None);
  }

  // Clone the item and remove the #[napi] attribute from it
  let mut item = item.clone();
  remove_napi_attr(&mut item);

  Ok(Some(AnnotatedItem { item, opts }))
}

/// Remove the `#[napi]` attribute from an item (since ConvertToAST expects it removed).
fn remove_napi_attr(item: &mut Item) {
  let attrs = match item {
    Item::Fn(f) => &mut f.attrs,
    Item::Struct(s) => &mut s.attrs,
    Item::Enum(e) => &mut e.attrs,
    Item::Impl(i) => &mut i.attrs,
    Item::Const(c) => &mut c.attrs,
    Item::Type(t) => &mut t.attrs,
    _ => return,
  };

  attrs.retain(|attr| !is_napi_attr(attr));
}

/// Convert annotated items to Napi IR using ConvertToAST.
/// This processes items in order: structs/enums first (pass 1), then everything else (pass 2).
///
/// **Cross-file state**: `record_struct()` and `check_recorded_struct_for_impl()` use global
/// statics (`STRUCTS`, `GENERATOR_STRUCT`). Because all files are merged into a single
/// `CategorizedItems` before calling this function, structs from file A are visible when
/// processing file B's impl blocks. This is intentional — it enables cross-file struct/impl
/// resolution (e.g. a struct defined in `model.rs` with methods in `model_impl.rs`).
///
/// If `strict` is true, any conversion error is fatal. Otherwise, failed items are
/// reported as warnings on stderr and skipped.
pub fn convert_items(categorized: CategorizedItems, strict: bool) -> Result<Vec<Napi>> {
  let mut results = Vec::new();
  let mut errors = Vec::new();

  // Pass 1: Process structs and enums first
  for annotated in categorized.structs_and_enums {
    match convert_single_item(annotated) {
      Ok(napi) => results.push(napi),
      Err(e) => {
        if strict {
          return Err(e);
        }
        errors.push(e);
      }
    }
  }

  // Pass 2: Process impl blocks, functions, consts, types
  for annotated in categorized.other_items {
    match convert_single_item(annotated) {
      Ok(napi) => results.push(napi),
      Err(e) => {
        if strict {
          return Err(e);
        }
        errors.push(e);
      }
    }
  }

  if !errors.is_empty() {
    let error_msgs: Vec<String> = errors.iter().map(|e| e.to_string()).collect();
    eprintln!(
      "Warning: {} items failed to convert:\n  {}",
      errors.len(),
      error_msgs.join("\n  ")
    );
  }

  Ok(results)
}

/// Convert a single annotated item to Napi IR.
fn convert_single_item(annotated: AnnotatedItem) -> Result<Napi> {
  let AnnotatedItem { mut item, opts } = annotated;

  let napi = match &mut item {
    Item::Fn(f) => f.convert_to_ast(&opts),
    Item::Struct(s) => s.convert_to_ast(&opts),
    Item::Impl(i) => i.convert_to_ast(&opts),
    Item::Enum(e) => e.convert_to_ast(&opts),
    Item::Const(c) => c.convert_to_ast(&opts),
    Item::Type(t) => t.convert_to_ast(&opts),
    _ => return Err(anyhow!("Unsupported item type for #[napi]")),
  };

  napi.map_err(|e| anyhow!("Failed to convert item: {}", e))
}
