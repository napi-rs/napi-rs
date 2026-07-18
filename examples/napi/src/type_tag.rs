//! Surface for the unforgeable `#[napi]` class type-tag tests.
//!
//! Two distinct classes exercise every stamp site (W1 `new`, W2 `#[napi(factory)]`,
//! W3 by-value return) and every check site (method receiver `&self`, `&T` /
//! `&mut T` params, `ClassInstance<T>`).

/// Constructed via `new` (W1), `#[napi(factory)]` (W2) and by-value return (W3).
#[napi]
pub struct TypeTagA {
  pub value: i32,
}

#[napi]
impl TypeTagA {
  #[napi(constructor)]
  pub fn new(value: i32) -> Self {
    TypeTagA { value }
  }

  /// Factory constructor -> stamp site W2 (`_factory`).
  #[napi(factory)]
  pub fn from_value(value: i32) -> Self {
    TypeTagA { value }
  }

  /// `&self` receiver -> receiver tag check in `unwrap_raw`.
  #[napi]
  pub fn get_value(&self) -> i32 {
    self.value
  }

  /// Takes a `&TypeTagB` param -> param tag check in generated `from_napi_ref`.
  #[napi]
  pub fn add_other(&self, other: &TypeTagB) -> i32 {
    self.value + other.value
  }

  /// Takes a `&mut TypeTagB` param -> param tag check in generated
  /// `from_napi_mut_ref`.
  #[napi]
  pub fn bump_other(&self, other: &mut TypeTagB) -> i32 {
    other.value += 1;
    self.value + other.value
  }
}

/// The "other" class, only ever passed as a `&TypeTagB` / `&mut TypeTagB` arg.
#[napi]
pub struct TypeTagB {
  pub value: i32,
}

#[napi]
impl TypeTagB {
  #[napi(constructor)]
  pub fn new(value: i32) -> Self {
    TypeTagB { value }
  }

  #[napi]
  pub fn get_value(&self) -> i32 {
    self.value
  }
}

/// By-value return -> stamp site W3 (`new_instance`).
#[napi]
pub fn make_type_tag_a(value: i32) -> TypeTagA {
  TypeTagA { value }
}

// ---------------------------------------------------------------------------
// F1 regression: the per-class tag must be scoped to (crate, version, module,
// class), NOT the bare `js_name`. `AlphaCollision` and `BetaCollision` share the
// SAME `js_name` ("CollisionClient") but live in different namespaces, so hashing
// the bare `js_name` would give them identical tags. With the scoped identity
// their tags differ, so a `BetaCollision` instance is rejected where a
// `&AlphaCollision` is expected. (This covers the single-addon / cross-namespace
// case; the crate+version components additionally cover the cross-addon case,
// which cannot be exercised from a single crate.)

/// Namespace `tag_collision_alpha`, js_name `CollisionClient`.
#[napi(namespace = "tag_collision_alpha", js_name = "CollisionClient")]
pub struct AlphaCollision {
  pub value: i32,
}

#[napi(namespace = "tag_collision_alpha")]
impl AlphaCollision {
  #[napi(constructor)]
  pub fn new(value: i32) -> Self {
    AlphaCollision { value }
  }
}

/// Namespace `tag_collision_beta`, js_name `CollisionClient` (same js_name as
/// `AlphaCollision`, different namespace).
#[napi(namespace = "tag_collision_beta", js_name = "CollisionClient")]
pub struct BetaCollision {
  pub value: i32,
}

#[napi(namespace = "tag_collision_beta")]
impl BetaCollision {
  #[napi(constructor)]
  pub fn new(value: i32) -> Self {
    BetaCollision { value }
  }
}

/// Non-strict, so the `&AlphaCollision` argument is resolved purely by the type
/// tag (no `instanceof`): passing a same-js_name `BetaCollision` must be rejected
/// by the tag, and an actual `AlphaCollision` must round-trip.
#[napi]
pub fn read_alpha_collision(client: &AlphaCollision) -> i32 {
  client.value
}
