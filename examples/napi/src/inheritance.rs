//! Fixtures for `#[napi(extends = Parent)]` single-inheritance (issue #1164).
//!
//! `Sub` embeds `Base` as its first field under `#[repr(C)]`, so the `Base`
//! portion sits at offset 0 and a `*mut Sub` can be borrowed as `&Base`. The
//! macro wires `Object.setPrototypeOf(Sub.prototype, Base.prototype)` at module
//! registration, so `sub instanceof Base` holds and inherited field getters
//! resolve through the prototype chain.

use napi::bindgen_prelude::Reference;
use napi_derive::napi;

/// Root of the inheritance fixture chain.
#[napi]
pub struct Base {
  value: i32,
}

#[napi]
impl Base {
  #[napi(constructor)]
  pub fn new(value: i32) -> Self {
    Base { value }
  }

  /// A parent-defined factory (static side). Because v1 wires only the
  /// *instance* prototype chain, this must NOT be reachable as `Sub.fromValue`.
  #[napi(factory)]
  pub fn from_value(value: i32) -> Self {
    Base { value }
  }

  /// A parent-defined plain static. Same as the factory: never inherited by a
  /// descendant in v1, so `Sub.baseStatic` must be `undefined`.
  #[napi]
  pub fn base_static() -> i32 {
    42
  }

  /// A parent field getter — must be readable through a descendant instance.
  #[napi(getter)]
  pub fn get_value(&self) -> i32 {
    self.value
  }

  /// A parent field setter — must be writable through a descendant instance
  /// (BorrowedUpcast accessor: works with P5 alone, no P8 needed).
  #[napi(setter)]
  pub fn set_value(&mut self, value: i32) {
    self.value = value;
  }

  /// A parent plain method (BorrowedUpcast: plain `&self`, no `Reference<Self>`).
  /// Reachable on a descendant only once the V8 signature is routed around (P8);
  /// kept here to exercise that path and contrast with `ref_value` below.
  #[napi]
  pub fn doubled(&self) -> i32 {
    self.value * 2
  }

  /// A parent method classified `ReceiverPolicy::Exact` — it takes a
  /// `Reference<Self>`, whose `Deref`/`share_with` machinery would reconstruct a
  /// `Box<Base>` over the receiver, so it keeps the exact tag-checked receiver
  /// unwrap and is deliberately NOT rewrapped by P8. Called on a descendant it
  /// must fail (V8 `Illegal invocation` on Node; a clean tag mismatch on a
  /// runtime that does not enforce the signature), never silently read `Sub`
  /// memory as a `Base`.
  #[napi]
  pub fn ref_value(&self, _this: Reference<Base>) -> i32 {
    self.value
  }
}

/// Direct child of `Base`. Constructed via a factory (a `#[napi(constructor)]`
/// cannot be combined with `#[napi(extends)]` in v1).
#[napi(extends = Base)]
#[repr(C)]
pub struct Sub {
  base: Base,
  extra: i32,
}

#[napi]
impl Sub {
  #[napi(factory)]
  pub fn create(value: i32, extra: i32) -> Self {
    Sub {
      base: Base::new(value),
      extra,
    }
  }

  #[napi(getter)]
  pub fn get_extra(&self) -> i32 {
    self.extra
  }
}

// ---------------------------------------------------------------------------
// The issue's own motivating example: a CSS-OM rule hierarchy
//   CssRule <- CssGroupingRule <- CssConditionRule <- CssMediaRule
// plus a sibling `CssStyleRule <- CssRule`. Every level embeds its parent as
// its first `#[repr(C)]` field, adds one own field with a getter + setter, and
// one plain method returning a level-distinct constant, so a deep instance can
// be checked for: multi-level `instanceof`, a root getter/setter round-tripped
// through the deepest instance, each ancestor's plain method dispatching on the
// descendant receiver, and a sibling staying unrelated.
// ---------------------------------------------------------------------------

/// Level 1 — the root of the CSS-OM chain.
#[napi]
pub struct CssRule {
  rule_type: i32,
}

#[napi]
impl CssRule {
  #[napi(constructor)]
  pub fn new(rule_type: i32) -> Self {
    CssRule { rule_type }
  }

  #[napi(getter)]
  pub fn get_rule_type(&self) -> i32 {
    self.rule_type
  }

  #[napi(setter)]
  pub fn set_rule_type(&mut self, rule_type: i32) {
    self.rule_type = rule_type;
  }

  #[napi]
  pub fn rule_kind(&self) -> i32 {
    1
  }
}

/// Level 2.
#[napi(extends = CssRule)]
#[repr(C)]
pub struct CssGroupingRule {
  base: CssRule,
  group_size: i32,
}

#[napi]
impl CssGroupingRule {
  #[napi(factory)]
  pub fn create(rule_type: i32, group_size: i32) -> Self {
    CssGroupingRule {
      base: CssRule::new(rule_type),
      group_size,
    }
  }

  #[napi(getter)]
  pub fn get_group_size(&self) -> i32 {
    self.group_size
  }

  #[napi(setter)]
  pub fn set_group_size(&mut self, group_size: i32) {
    self.group_size = group_size;
  }

  #[napi]
  pub fn grouping_kind(&self) -> i32 {
    2
  }
}

/// Level 3.
#[napi(extends = CssGroupingRule)]
#[repr(C)]
pub struct CssConditionRule {
  base: CssGroupingRule,
  condition: i32,
}

#[napi]
impl CssConditionRule {
  #[napi(factory)]
  pub fn create(rule_type: i32, group_size: i32, condition: i32) -> Self {
    CssConditionRule {
      base: CssGroupingRule::create(rule_type, group_size),
      condition,
    }
  }

  #[napi(getter)]
  pub fn get_condition(&self) -> i32 {
    self.condition
  }

  #[napi(setter)]
  pub fn set_condition(&mut self, condition: i32) {
    self.condition = condition;
  }

  #[napi]
  pub fn condition_kind(&self) -> i32 {
    3
  }
}

/// Level 4 — the deepest rule in the chain.
#[napi(extends = CssConditionRule)]
#[repr(C)]
pub struct CssMediaRule {
  base: CssConditionRule,
  media: i32,
}

#[napi]
impl CssMediaRule {
  #[napi(factory)]
  pub fn create(rule_type: i32, group_size: i32, condition: i32, media: i32) -> Self {
    CssMediaRule {
      base: CssConditionRule::create(rule_type, group_size, condition),
      media,
    }
  }

  #[napi(getter)]
  pub fn get_media(&self) -> i32 {
    self.media
  }

  #[napi(setter)]
  pub fn set_media(&mut self, media: i32) {
    self.media = media;
  }

  #[napi]
  pub fn media_kind(&self) -> i32 {
    4
  }
}

/// A sibling of `CssGroupingRule`: it also extends the root `CssRule`, so it must
/// never be confused with the `CssGroupingRule` branch (no `instanceof`
/// relationship, and none of that branch's methods reachable on it).
#[napi(extends = CssRule)]
#[repr(C)]
pub struct CssStyleRule {
  base: CssRule,
  selector: i32,
}

#[napi]
impl CssStyleRule {
  #[napi(factory)]
  pub fn create(rule_type: i32, selector: i32) -> Self {
    CssStyleRule {
      base: CssRule::new(rule_type),
      selector,
    }
  }

  #[napi(getter)]
  pub fn get_selector(&self) -> i32 {
    self.selector
  }

  #[napi(setter)]
  pub fn set_selector(&mut self, selector: i32) {
    self.selector = selector;
  }

  #[napi]
  pub fn style_kind(&self) -> i32 {
    5
  }
}
