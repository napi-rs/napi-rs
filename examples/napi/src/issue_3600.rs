use std::sync::atomic::{AtomicU32, Ordering};

use napi::bindgen_prelude::*;

// Repro coverage for napi-rs#3600: converting a `#[napi]` class into a
// JavaScript instance while an exception is pending makes `napi_new_instance`
// fail. The value had already been moved into a raw pointer that no finalizer
// adopted, so it leaked, and `___CALL_FROM_FACTORY` stayed `true`, which made
// the next JS `new` of any class skip its Rust constructor.

static TRACKED_DROPPED: AtomicU32 = AtomicU32::new(0);
static EMPTY_DROPPED: AtomicU32 = AtomicU32::new(0);

#[napi]
pub struct Issue3600Tracked {
  payload: Vec<u8>,
}

impl Drop for Issue3600Tracked {
  fn drop(&mut self) {
    TRACKED_DROPPED.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi]
impl Issue3600Tracked {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      payload: vec![0; 1024],
    }
  }

  #[napi(getter)]
  pub fn size(&self) -> u32 {
    self.payload.len() as u32
  }
}

#[napi]
pub struct Issue3600Empty;

impl Drop for Issue3600Empty {
  fn drop(&mut self) {
    EMPTY_DROPPED.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi]
pub fn issue3600_tracked_dropped() -> u32 {
  TRACKED_DROPPED.load(Ordering::SeqCst)
}

#[napi]
pub fn issue3600_empty_dropped() -> u32 {
  EMPTY_DROPPED.load(Ordering::SeqCst)
}

#[napi]
pub fn issue3600_pending_into_instance(env: Env) -> Result<()> {
  let tracked = Issue3600Tracked::new();
  env.throw_error("issue3600 pending exception", None)?;
  tracked.into_instance(&env)?;
  Ok(())
}

#[napi]
pub fn issue3600_pending_into_reference(env: Env) -> Result<()> {
  let tracked = Issue3600Tracked::new();
  env.throw_error("issue3600 pending exception", None)?;
  tracked.into_reference(env)?;
  Ok(())
}

#[napi]
pub fn issue3600_pending_return(env: Env) -> Result<Issue3600Tracked> {
  let tracked = Issue3600Tracked::new();
  env.throw_error("issue3600 pending exception", None)?;
  Ok(tracked)
}

#[napi]
pub fn issue3600_pending_empty_into_instance(env: Env) -> Result<()> {
  env.throw_error("issue3600 pending exception", None)?;
  Issue3600Empty.into_instance(&env)?;
  Ok(())
}

#[napi]
pub fn issue3600_pending_empty_into_reference(env: Env) -> Result<()> {
  env.throw_error("issue3600 pending exception", None)?;
  Issue3600Empty.into_reference(env)?;
  Ok(())
}

#[napi]
pub fn issue3600_pending_empty_return(env: Env) -> Result<Issue3600Empty> {
  env.throw_error("issue3600 pending exception", None)?;
  Ok(Issue3600Empty)
}

/// Successful `into_instance` of an empty class: each instance must get its
/// own native pointer so finalizers/references of distinct instances do not
/// collide.
#[napi]
pub fn issue3600_empty_instances(env: &Env) -> Result<Vec<ClassInstance<'_, Issue3600Empty>>> {
  Ok(vec![
    Issue3600Empty.into_instance(env)?,
    Issue3600Empty.into_instance(env)?,
  ])
}
