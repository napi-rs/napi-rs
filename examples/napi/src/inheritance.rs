use std::sync::atomic::{AtomicU32, Ordering};

use napi::bindgen_prelude::*;

static BASE_DROPS: AtomicU32 = AtomicU32::new(0);
static CHILD_DROPS: AtomicU32 = AtomicU32::new(0);

#[napi(js_name = "InheritanceBase")]
pub struct InheritanceRoot {
  pub value: i32,
}

#[napi]
impl InheritanceRoot {
  #[napi(constructor)]
  pub fn new(value: i32) -> Self {
    Self { value }
  }

  #[napi(factory)]
  pub fn from_value(value: i32) -> Self {
    Self { value }
  }

  #[napi]
  pub fn doubled(&self) -> i32 {
    self.value * 2
  }

  #[napi]
  pub fn increment(&mut self) {
    self.value += 1;
  }

  #[napi(getter)]
  pub fn get_amount(&self) -> i32 {
    self.value
  }

  #[napi(setter)]
  pub fn set_amount(&mut self, value: i32) {
    self.value = value;
  }

  #[napi]
  pub fn exact_value(&self, _reference: Reference<InheritanceRoot>) -> i32 {
    self.value
  }

  /// A typed `This` converts with the exact-class check, so this stays exact.
  #[napi]
  pub fn this_value(&self, this: This<&InheritanceRoot>) -> i32 {
    self.value + this.value
  }

  /// An untyped `This` is the receiver object itself, which is fine to inherit.
  #[napi]
  pub fn same_object<'scope>(&'scope self, this: This<'scope>) -> This<'scope> {
    this
  }

  #[napi(well_known_symbol = "toPrimitive")]
  pub fn primitive(&self, _hint: String) -> i32 {
    self.value
  }

  #[napi]
  pub fn reenter(&mut self, callback: Function<(), ()>) -> Result<()> {
    callback.call(())?;
    Ok(())
  }
}

impl Drop for InheritanceRoot {
  fn drop(&mut self) {
    BASE_DROPS.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi(extends = InheritanceRoot)]
#[repr(C)]
pub struct InheritanceChild {
  // Public deliberately: embedding must not accidentally expose an accessor.
  pub parent: InheritanceRoot,
  pub extra: i32,
}

#[napi]
impl InheritanceChild {
  #[napi(factory)]
  pub fn create(value: i32, extra: i32) -> Self {
    Self {
      parent: InheritanceRoot { value },
      extra,
    }
  }

  #[napi]
  pub fn own_value(&self) -> i32 {
    self.extra
  }
}

impl Drop for InheritanceChild {
  fn drop(&mut self) {
    CHILD_DROPS.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi(extends = crate::inheritance::InheritanceChild)]
#[repr(C)]
pub struct InheritanceGrandchild {
  parent: InheritanceChild,
  pub leaf: i32,
}

#[napi]
impl InheritanceGrandchild {
  #[napi(factory)]
  pub fn create(value: i32, extra: i32, leaf: i32) -> Self {
    Self {
      parent: InheritanceChild::create(value, extra),
      leaf,
    }
  }
}

#[napi(extends = InheritanceRoot)]
#[repr(C)]
pub struct InheritanceSibling {
  parent: InheritanceRoot,
}

#[napi]
impl InheritanceSibling {
  #[napi(factory)]
  pub fn create(value: i32) -> Self {
    Self {
      parent: InheritanceRoot { value },
    }
  }
}

#[napi]
pub fn inheritance_drop_counts() -> Vec<u32> {
  vec![
    BASE_DROPS.load(Ordering::SeqCst),
    CHILD_DROPS.load(Ordering::SeqCst),
  ]
}

#[napi]
pub fn inheritance_exact_argument(value: &InheritanceRoot) -> i32 {
  value.value
}
