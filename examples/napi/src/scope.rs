use napi::{bindgen_prelude::*, JsString};

#[napi]
pub fn shorter_scope(env: &Env, arr: Array) -> Result<Vec<u32>> {
  let len = arr.len();
  let mut result = Vec::with_capacity(len as usize);
  for i in 0..len {
    let scope = HandleScope::create(env)?;
    let value: Unknown = arr.get_element(i)?;
    let len = unsafe {
      scope.close(value, |v| match v.get_type()? {
        ValueType::String => {
          let string = v.cast::<JsString>()?;
          Ok(string.utf8_len()? as u32)
        }
        ValueType::Object => Ok(1),
        _ => Ok(0),
      })?
    };
    result.push(len);
  }
  Ok(result)
}

#[napi]
pub fn shorter_escapable_scope<'env>(
  env: &'env Env,
  create_string: Function<(), Option<JsString>>,
) -> Result<JsString<'env>> {
  let mut longest_string = env.create_string("")?;
  let mut prev_len = 0;
  loop {
    if let Some(maybe_longest) = EscapableHandleScope::with(
      env,
      (create_string, longest_string),
      move |scope, (create_string, prev)| {
        let elem = create_string.call(())?;
        if let Some(string) = elem {
          let len = string.utf8_len()?;
          if len > prev.utf8_len()? {
            return Ok(Some(Either::A(string.escape::<JsString>(scope)?)));
          }
        } else {
          return Ok(Some(Either::B(())));
        }
        Ok(None)
      },
    )? {
      match maybe_longest {
        Either::A(longest) => {
          if longest.utf8_len()? == prev_len {
            break;
          }
          prev_len = longest.utf8_len()?;
          longest_string = longest;
        }
        Either::B(_) => break,
      }
    }
  }
  Ok(longest_string)
}
