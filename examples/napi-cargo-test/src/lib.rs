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
// SAME namespace. A tag derived only from js_name/namespace/crate/version would
// be identical for both — a blind-cast collision. The content-derived tag keys
// on `crate@version::module_path::ClassName` instead, and each class's
// `module_path::ident` differs (`SameNameOne` vs `SameNameTwo`), so they get
// distinct tags. Module registration is never triggered under `cargo test`, so
// the duplicate js_name+namespace is harmless here.
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

  // A class that opts into a crate-unique salt via `#[napi(type_tag = "...")]`.
  // Its tag must be derived from the salt, NOT from `crate@version`, while
  // `module_path!()::ClassName` still disambiguates it. Defined inside this
  // module so the class's derive and the assertions below share the same
  // `module_path!()` — the salt override is the only moving part under test.
  #[napi(type_tag = "fixed-salt-uuid")]
  pub struct SaltOverrideClass {
    pub value: i32,
  }

  // Same shape but WITHOUT the salt override: its tag uses the default
  // `crate@version::module_path::ClassName` derivation.
  #[napi]
  pub struct SaltDefaultClass {
    pub value: i32,
  }

  #[test]
  fn test_plus() {
    let result = plus(1, 2).unwrap();
    assert_eq!(result, 3i32);
  }

  #[test]
  fn type_tag_override_is_salted_and_deterministic() {
    use napi::bindgen_prelude::{type_tag_from_ident, TypeTag};

    let tag = <SaltOverrideClass as TypeTag>::type_tag();
    // The override replaces the `crate@version` identity component with the
    // salt; `module_path!()::ClassName` still applies.
    assert_eq!(
      tag,
      type_tag_from_ident(concat!(
        "fixed-salt-uuid",
        "::",
        module_path!(),
        "::",
        "SaltOverrideClass"
      )),
      "type_tag override must derive from the salt (not crate@version)"
    );
    // Compile-time constant, so it is identical on repeat (stable across
    // reload / dual-load).
    assert_eq!(
      tag,
      <SaltOverrideClass as TypeTag>::type_tag(),
      "salted type_tag() must return the same value on repeat"
    );
  }

  #[test]
  fn type_tag_override_differs_from_non_override() {
    use napi::bindgen_prelude::{type_tag_from_ident, TypeTag};

    let salted = <SaltOverrideClass as TypeTag>::type_tag();
    // Differs from an otherwise-comparable non-override class.
    assert_ne!(
      salted,
      <SaltDefaultClass as TypeTag>::type_tag(),
      "salted class must not collide with a non-override class"
    );
    // And prove the SALT (not merely the differing class name) drives it: the
    // salted tag also differs from what SaltOverrideClass would derive WITHOUT
    // the override (the default `crate@version::module_path::ClassName` form).
    let default_form = type_tag_from_ident(concat!(
      env!("CARGO_PKG_NAME"),
      "@",
      env!("CARGO_PKG_VERSION"),
      "::",
      module_path!(),
      "::",
      "SaltOverrideClass"
    ));
    assert_ne!(
      salted, default_form,
      "salt override must change the derived identity vs the default crate@version form"
    );
  }

  #[test]
  fn same_js_name_and_namespace_classes_get_distinct_tags() {
    use napi::bindgen_prelude::TypeTag;

    let one = <SameNameOne as TypeTag>::type_tag();
    let two = <SameNameTwo as TypeTag>::type_tag();
    // Distinct Rust types must get distinct tags even though js_name/namespace/
    // crate/version are identical — they differ by `module_path::ident`.
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
