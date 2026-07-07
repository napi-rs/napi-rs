use napi::bindgen_prelude::{Env, Reference, Result, SharedReference};

fn share_reference(reference: Reference<u32>, env: Env) -> Result<SharedReference<u32, ()>> {
  reference.share_with(env, |_| Ok(()))
}

fn share_shared_reference(
  reference: SharedReference<u32, u32>,
  env: Env,
) -> Result<SharedReference<u32, ()>> {
  reference.share_with(env, |_| Ok(()))
}

fn main() {}
