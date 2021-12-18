use std::collections::HashMap;

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
