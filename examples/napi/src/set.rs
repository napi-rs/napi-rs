use rustc_hash::FxBuildHasher;
use std::collections::{BTreeSet, HashSet};

#[napi]
pub fn pass_set_to_rust(set: HashSet<String>) {
  assert_eq!(set.len(), 3);
  assert!(set.contains("a"));
  assert!(set.contains("b"));
  assert!(set.contains("c"));
}

#[napi]
pub fn pass_set_to_js() -> HashSet<String> {
  let mut set = HashSet::new();
  set.insert("a".to_string());
  set.insert("b".to_string());
  set.insert("c".to_string());
  set
}

#[napi]
pub fn pass_set_with_hasher_to_js() -> HashSet<String, FxBuildHasher> {
  let mut set = HashSet::with_hasher(FxBuildHasher);
  set.insert("a".to_string());
  set.insert("b".to_string());
  set.insert("c".to_string());
  set
}

#[napi]
pub fn btree_set_to_rust(set: BTreeSet<String>) {
  assert_eq!(set.len(), 3);
  assert!(set.contains("a"));
  assert!(set.contains("b"));
  assert!(set.contains("c"));
}

#[napi]
pub fn btree_set_to_js() -> BTreeSet<String> {
  let mut set = BTreeSet::new();
  set.insert("a".to_string());
  set.insert("b".to_string());
  set.insert("c".to_string());
  set
}
