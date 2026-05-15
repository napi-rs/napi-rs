use crate::{Env, Error, Result, Unknown, Value, ValueType, sys};
use crate::js_values::value::JsValue;
use std::marker::PhantomData;

struct Cursor<'a> {
  data: &'a [u8], pos: usize,
}

impl<'a> Cursor<'a> {
  fn new(data: &'a [u8]) -> Self { Cursor { data, pos: 0 } }
  fn skip_ws(&mut self) { while self.pos < self.data.len() && self.data[self.pos].is_ascii_whitespace() { self.pos += 1; } }
  fn peek(&self) -> Result<u8> { self.data.get(self.pos).copied().ok_or_else(|| Error::from_reason("unexpected end of JSON")) }
  fn advance(&mut self) -> Result<u8> { let b = self.peek()?; self.pos += 1; Ok(b) }
  fn expect(&mut self, expected: u8) -> Result<()> { let b = self.advance()?; if b != expected { return Err(Error::from_reason(format!("expected '{}'", expected as char))); } Ok(()) }
  fn read_string(&mut self) -> Result<String> {
    self.expect(b'"')?; let start = self.pos;
    loop { match self.data.get(self.pos) {
      Some(b'"') => { let s = std::str::from_utf8(&self.data[start..self.pos]).map_err(|e| Error::from_reason(format!("invalid utf8: {e}")))?; self.pos += 1; return Ok(s.to_string()); }
      Some(b'\\') => { self.pos += 2; }
      Some(_) => { self.pos += 1; }
      None => return Err(Error::from_reason("unterminated string")),
    }}
  }
}

fn check(s: sys::napi_status) -> Result<()> {
  if s == sys::Status::napi_ok { Ok(()) } else { Err(Error::from_reason("napi call failed")) }
}

fn raw_unknown<'env>(raw_env: sys::napi_env, val: sys::napi_value) -> Unknown<'env> {
  Unknown(Value { env: raw_env, value: val, value_type: ValueType::Unknown }, PhantomData)
}

/// Parse JSON directly into JS values via napi API. No serde_json::Value intermediate.
pub fn parse_json<'env>(env: Env, json: &[u8]) -> Result<Unknown<'env>> {
  let raw_env = env.raw();
  let mut cur = Cursor::new(json);
  cur.skip_ws();
  parse_value(&mut cur, raw_env)
}

fn parse_value<'env>(cur: &mut Cursor, raw_env: sys::napi_env) -> Result<Unknown<'env>> {
  cur.skip_ws();
  match cur.peek()? {
    b'{' => {
      cur.advance()?;
      let mut obj_ptr = std::ptr::null_mut();
      check(unsafe { sys::napi_create_object(raw_env, &mut obj_ptr) })?;
      cur.skip_ws();
      if cur.peek()? != b'}' {
        loop {
          cur.skip_ws(); let key = cur.read_string()?; cur.skip_ws(); cur.expect(b':')?;
          let val = parse_value(cur, raw_env)?;
          check(unsafe { sys::napi_set_named_property(raw_env, obj_ptr, key.as_ptr() as *const i8, val.raw()) })?;
          cur.skip_ws();
          match cur.peek()? { b',' => { cur.advance()?; } b'}' => break, _ => return Err(Error::from_reason("expected ',' or '}'")) }
        }
      }
      cur.expect(b'}')?;
      Ok(raw_unknown(raw_env, obj_ptr))
    }
    b'[' => {
      cur.advance()?;
      let mut arr_ptr = std::ptr::null_mut();
      check(unsafe { sys::napi_create_array(raw_env, &mut arr_ptr) })?;
      let mut idx = 0u32;
      cur.skip_ws();
      if cur.peek()? != b']' {
        loop {
          let val = parse_value(cur, raw_env)?;
          check(unsafe { sys::napi_set_element(raw_env, arr_ptr, idx, val.raw()) })?;
          idx += 1;
          cur.skip_ws();
          match cur.peek()? { b',' => { cur.advance()?; } b']' => break, _ => return Err(Error::from_reason("expected ',' or ']'")) }
        }
      }
      cur.expect(b']')?;
      Ok(raw_unknown(raw_env, arr_ptr))
    }
    b'"' => {
      let s = cur.read_string()?;
      let mut str_ptr = std::ptr::null_mut();
      check(unsafe { sys::napi_create_string_utf8(raw_env, s.as_ptr() as *const i8, s.len() as isize, &mut str_ptr) })?;
      Ok(raw_unknown(raw_env, str_ptr))
    }
    b't' => { cur.pos += 4; let mut p = std::ptr::null_mut(); check(unsafe { sys::napi_get_boolean(raw_env, true, &mut p) })?; Ok(raw_unknown(raw_env, p)) }
    b'f' => { cur.pos += 5; let mut p = std::ptr::null_mut(); check(unsafe { sys::napi_get_boolean(raw_env, false, &mut p) })?; Ok(raw_unknown(raw_env, p)) }
    b'n' => { cur.pos += 4; let mut p = std::ptr::null_mut(); check(unsafe { sys::napi_get_null(raw_env, &mut p) })?; Ok(raw_unknown(raw_env, p)) }
    b'-' | b'0'..=b'9' => {
      let start = cur.pos;
      while cur.pos < cur.data.len() && (cur.data[cur.pos].is_ascii_digit() || cur.data[cur.pos] == b'-' || cur.data[cur.pos] == b'+' || cur.data[cur.pos] == b'e' || cur.data[cur.pos] == b'E' || cur.data[cur.pos] == b'.') { cur.pos += 1; }
      let s = std::str::from_utf8(&cur.data[start..cur.pos]).map_err(|e| Error::from_reason(e.to_string()))?;
      let n: f64 = s.parse().map_err(|e| Error::from_reason(format!("invalid number: {e}")))?;
      let mut p = std::ptr::null_mut(); check(unsafe { sys::napi_create_double(raw_env, n, &mut p) })?; Ok(raw_unknown(raw_env, p))
    }
    b => Err(Error::from_reason(format!("unexpected byte '{}'", b as char))),
  }
}
