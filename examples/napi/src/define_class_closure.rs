use std::sync::atomic::{AtomicU32, Ordering};

use napi::{
  bindgen_prelude::{Function, JsObjectValue, Object},
  Env, Property, Result,
};

static CLOSURE_DROPS: AtomicU32 = AtomicU32::new(0);

/// Captured by every accessor closure below, so each closure drop is counted.
struct DropCounter {
  value: u32,
}

impl Drop for DropCounter {
  fn drop(&mut self) {
    CLOSURE_DROPS.fetch_add(1, Ordering::SeqCst);
  }
}

/// One `value` accessor: the getter returns 42, the setter stores into `lastSet`.
fn closure_properties() -> Result<[Property; 1]> {
  let getter_counter = DropCounter { value: 42 };
  let setter_counter = DropCounter { value: 0 };
  Ok([Property::new()
    .with_utf8_name("value")?
    .with_getter_closure(move |_env, _this| {
      // Borrow the whole counter so the closure owns it, not just `value`.
      let counter = &getter_counter;
      Ok(counter.value)
    })
    .with_setter_closure(move |_env, mut this, value: u32| {
      let counter = &setter_counter;
      this.set_named_property("lastSet", value + counter.value)
    })])
}

/// A class whose `value` accessor is backed by closures.
#[napi(ts_return_type = "new () => { value: number; readonly lastSet?: number }")]
pub fn define_class_with_closures<'env>(env: &'env Env) -> Result<Function<'env>> {
  env.define_class(
    "ClosureAccessorClass",
    closure_class_constructor_c_callback,
    &closure_properties()?,
  )
}

/// Passes one `&[Property]` to two `Env::define_class` calls.
#[napi(ts_return_type = "Array<new () => { value: number; readonly lastSet?: number }>")]
pub fn define_class_twice_with_closures<'env>(env: &'env Env) -> Result<Vec<Function<'env>>> {
  let properties = closure_properties()?;
  Ok(vec![
    env.define_class(
      "ClosureAccessorClassA",
      closure_class_constructor_c_callback,
      &properties,
    )?,
    env.define_class(
      "ClosureAccessorClassB",
      closure_class_constructor_c_callback,
      &properties,
    )?,
  ])
}

/// Passes one `&[Property]` to `define_properties` on two objects.
#[napi(ts_return_type = "Array<{ value: number; readonly lastSet?: number }>")]
pub fn define_properties_twice_with_closures(env: &Env) -> Result<Vec<Object<'_>>> {
  let properties = closure_properties()?;
  let mut first = Object::new(env)?;
  first.define_properties(&properties)?;
  let mut second = Object::new(env)?;
  second.define_properties(&properties)?;
  Ok(vec![first, second])
}

/// How many accessor closures have been dropped in this process.
#[napi]
pub fn closure_drop_count() -> u32 {
  CLOSURE_DROPS.load(Ordering::SeqCst)
}

#[napi(no_export)]
fn closure_class_constructor() {}
