use std::collections::{BTreeMap, HashMap};

use indexmap::IndexMap;

#[napi]
fn get_mapping() -> HashMap<String, u32> {
  let mut map = HashMap::new();
  map.insert("a".to_string(), 101);
  map.insert("b".to_string(), 102);
  map
}

#[napi]
fn sum_mapping(nums: HashMap<String, u32>) -> u32 {
  nums.into_values().sum()
}

#[napi]
fn get_btree_mapping() -> BTreeMap<String, u32> {
  let mut map = BTreeMap::new();
  map.insert("a".to_string(), 101);
  map.insert("b".to_string(), 102);
  map
}

#[napi]
fn sum_btree_mapping(nums: BTreeMap<String, u32>) -> u32 {
  nums.into_values().sum()
}

#[napi]
fn get_index_mapping() -> IndexMap<String, u32> {
  let mut map = IndexMap::new();
  map.insert("a".to_string(), 101);
  map.insert("b".to_string(), 102);
  map
}

#[napi]
fn sum_index_mapping(nums: IndexMap<String, u32>) -> u32 {
  nums.into_values().sum()
}

#[napi]
fn indexmap_passthrough(fixture: IndexMap<String, u32>) -> IndexMap<String, u32> {
  fixture
}
