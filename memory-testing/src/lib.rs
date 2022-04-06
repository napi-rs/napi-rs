use napi::{bindgen_prelude::*, Env};

#[macro_use]
extern crate napi_derive;
#[macro_use]
extern crate serde_derive;

#[derive(Serialize, Deserialize)]
pub struct Welcome {
  id: String,
  name: String,
  forename: String,
  description: String,
  email: String,
  phone: String,
  #[serde(rename = "arrivalDate")]
  arrival_date: i64,
  #[serde(rename = "departureDate")]
  departure_date: i64,
  price: i64,
  advance: i64,
  #[serde(rename = "advanceDueDate")]
  advance_due_date: i64,
  kids: i64,
  adults: i64,
  status: String,
  nourishment: String,
  #[serde(rename = "createdAt")]
  created_at: String,
  room: Room,
}

#[derive(Serialize, Deserialize)]
pub struct Room {
  id: String,
  name: String,
}

#[napi]
pub fn test_async(env: Env) -> napi::Result<napi::JsObject> {
  let data = serde_json::json!({
      "findFirstBooking": {
          "id": "ckovh15xa104945sj64rdk8oas",
          "name": "1883da9ff9152",
          "forename": "221c99bedc6a4",
          "description": "8bf86b62ce6a",
          "email": "9d57a869661cc",
          "phone": "7e0c58d147215",
          "arrivalDate": -92229669,
          "departureDate": 202138795,
          "price": -1592700387,
          "advance": -369294193,
          "advanceDueDate": 925000428,
          "kids": 520124290,
          "adults": 1160258464,
          "status": "NO_PAYMENT",
          "nourishment": "BB",
          "createdAt": "2021-05-19T12:58:37.246Z",
          "room": { "id": "ckovh15xa104955sj6r2tqaw1c", "name": "38683b87f2664" }
      }
  });
  env.execute_tokio_future(
    async move { Ok(serde_json::to_string(&data).unwrap()) },
    |env, res| {
      env.adjust_external_memory(res.len() as i64)?;
      env.create_string_from_std(res)
    },
  )
}

#[napi]
pub fn from_js(env: Env, input_object: Object) -> napi::Result<String> {
  let a: Welcome = env.from_js_value(&input_object)?;
  Ok(serde_json::to_string(&a)?)
}

pub struct ChildHolder {
  inner: &'static MemoryHolder,
}

impl ChildHolder {
  fn count(&self) -> usize {
    self.inner.0.len()
  }
}

#[napi]
pub struct MemoryHolder(Vec<u8>);

#[napi]
impl MemoryHolder {
  #[napi(constructor)]
  pub fn new(mut env: Env, len: u32) -> Result<Self> {
    env.adjust_external_memory(len as i64)?;
    Ok(Self(vec![42; len as usize]))
  }

  #[napi]
  pub fn create_reference(
    &self,
    env: Env,
    holder_ref: Reference<MemoryHolder>,
  ) -> Result<ChildReference> {
    let child_holder =
      holder_ref.share_with(env, |holder_ref| Ok(ChildHolder { inner: holder_ref }))?;
    Ok(ChildReference(child_holder))
  }
}

#[napi]
pub struct ChildReference(SharedReference<MemoryHolder, ChildHolder>);

#[napi]

impl ChildReference {
  #[napi]
  pub fn count(&self) -> u32 {
    self.0.count() as u32
  }
}
