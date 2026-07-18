use napi_derive::napi;

#[napi]
pub fn plus(a: i32, b: i32) -> napi::Result<i32> {
  Ok(a + b)
}

#[napi]
#[derive(Debug, PartialEq, Eq)]
pub enum MyEnum {
  A,
  B,
}

#[napi(object)]
#[derive(Debug, PartialEq, Eq)]
pub struct MyObject {
  pub a: i32,
  pub b: i32,
}

// Two DISTINCT Rust classes that deliberately share the SAME `js_name` AND the
// SAME namespace. Under the previous string-based identity (manifest_dir + crate
// + version + module + js_name) all five fields are identical, so both would
// hash to the SAME type tag — a blind-cast collision. Deriving the tag from the
// address of a per-class anchor static gives each a distinct tag (each class has
// its own anchor at a distinct address). Module registration is never triggered
// under `cargo test`, so the duplicate js_name+namespace is harmless here.
#[napi(namespace = "dup_tag", js_name = "SameName")]
pub struct SameNameOne {
  pub value: i32,
}

#[napi(namespace = "dup_tag", js_name = "SameName")]
pub struct SameNameTwo {
  pub value: i32,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_plus() {
    let result = plus(1, 2).unwrap();
    assert_eq!(result, 3i32);
  }

  #[test]
  fn same_js_name_and_namespace_classes_get_distinct_tags() {
    use napi::bindgen_prelude::TypeTag;

    let one = <SameNameOne as TypeTag>::type_tag();
    let two = <SameNameTwo as TypeTag>::type_tag();
    // Distinct Rust types must get distinct tags even though every string field
    // (js_name/namespace/crate/version) is identical.
    assert_ne!(
      one, two,
      "distinct classes sharing js_name+namespace must get distinct tags"
    );
  }

  #[test]
  fn derived_type_tag_is_deterministic() {
    use napi::bindgen_prelude::TypeTag;

    assert_eq!(
      <SameNameOne as TypeTag>::type_tag(),
      <SameNameOne as TypeTag>::type_tag(),
      "type_tag() must return the same value on repeat"
    );
  }

  #[test]
  fn test_enum() {
    let result = MyEnum::A;
    assert_eq!(result, MyEnum::A);
  }

  #[test]
  fn test_struct() {
    let result = MyObject { a: 1, b: 2 };
    assert_eq!(result, MyObject { a: 1, b: 2 });
  }
}
