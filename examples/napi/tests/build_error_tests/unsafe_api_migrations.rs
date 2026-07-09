use napi::{
  bindgen_prelude::{ArrayBuffer, Env, FromNapiMutRef, PromiseRaw, Result},
  sys, Ref,
};

struct MutableValue;

impl FromNapiMutRef for MutableValue {
  unsafe fn from_napi_mut_ref(
    _env: sys::napi_env,
    _value: sys::napi_value,
  ) -> Result<&'static mut Self> {
    unreachable!()
  }
}

fn call_newly_unsafe_apis<'env>(
  arraybuffer: ArrayBuffer<'env>,
  reference: &Ref<MutableValue>,
  env: &Env,
  raw_env: sys::napi_env,
  raw_value: sys::napi_value,
) {
  let _ = arraybuffer.detach();
  let _ = reference.get_value_mut(env);
  let _: PromiseRaw<'env, ()> = PromiseRaw::new(raw_env, raw_value);
}

fn main() {}
