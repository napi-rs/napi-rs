/// default enum values are continuos i32s start from 0
#[napi]
#[derive(Debug, Clone, Copy)]
pub enum Kind {
  /// Barks
  Dog,
  /// Kills birds
  Cat,
  /// Tasty
  Duck,
}

#[napi]
pub enum Empty {}

#[napi(string_enum)]
pub enum Status {
  Pristine,
  Loading,
  Ready,
}

#[allow(clippy::enum_variant_names)]
#[napi(string_enum = "lowercase")]
pub enum StringEnum {
  VariantOne,
  VariantTwo,
  VariantThree,
}

/// You could break the step and for an new continuous value.
#[napi]
pub enum CustomNumEnum {
  One = 1,
  Two,
  Three = 3,
  Four,
  #[doc(hidden)]
  Six = 6,
  Eight = 8,
  Nine, // would be 9
  Ten,  // 10
}

#[napi]
fn enum_to_i32(e: CustomNumEnum) -> i32 {
  e as i32
}

#[napi(skip_typescript)]
pub enum SkippedEnums {
  One = 1,
  Two,
  Tree,
}

#[napi(string_enum)]
pub enum CustomStringEnum {
  #[napi(value = "my-custom-value")]
  Foo,
  Bar,
  Baz,
}

#[napi(discriminant = "type2")]
pub enum StructuredKind {
  Hello,
  Greeting { name: String },
  Birthday { name: String, age: u8 },
  Tuple(u32, u32),
}

#[napi]
pub fn validate_structured_enum(kind: StructuredKind) -> StructuredKind {
  kind
}
