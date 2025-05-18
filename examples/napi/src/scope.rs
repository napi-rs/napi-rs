use napi::{bindgen_prelude::*, JsString};

#[napi]
pub fn shorter_scope(env: &Env, arr: Array) -> Result<Vec<u32>> {
  let len = arr.len();
  let mut result = Vec::with_capacity(len as usize);
  for i in 0..len {
    let scope = HandleScope::create(env)?;
    let value: Unknown = arr.get_element(i)?;
    let len = scope.run(value, |v| match v.get_type()? {
      ValueType::String => {
        let string = unsafe { v.cast::<JsString>() }?;
        Ok(string.utf8_len()? as u32)
      }
      ValueType::Object => Ok(1),
      _ => Ok(0),
    })?;
    result.push(len);
  }
  Ok(result)
}
