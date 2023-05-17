use std::convert::TryInto;

use serde::de::Visitor;
use serde::de::{DeserializeSeed, EnumAccess, MapAccess, SeqAccess, Unexpected, VariantAccess};

#[cfg(feature = "napi6")]
use crate::JsBigInt;
use crate::{type_of, NapiValue, Value, ValueType};
use crate::{
  Error, JsBoolean, JsBufferValue, JsNumber, JsObject, JsString, JsUnknown, Result, Status,
};

pub(crate) struct De<'env>(pub(crate) &'env Value);

#[doc(hidden)]
impl<'x, 'de, 'env> serde::de::Deserializer<'x> for &'de mut De<'env> {
  type Error = Error;

  fn deserialize_any<V>(self, visitor: V) -> Result<V::Value>
  where
    V: Visitor<'x>,
  {
    let js_value_type = type_of!(self.0.env, self.0.value)?;
    match js_value_type {
      ValueType::Null | ValueType::Undefined => visitor.visit_unit(),
      ValueType::Boolean => {
        let js_boolean = unsafe { JsBoolean::from_raw_unchecked(self.0.env, self.0.value) };
        visitor.visit_bool(js_boolean.get_value()?)
      }
      ValueType::Number => {
        let js_number: f64 =
          unsafe { JsNumber::from_raw_unchecked(self.0.env, self.0.value).try_into()? };
        if (js_number.trunc() - js_number).abs() < f64::EPSILON {
          visitor.visit_i64(js_number as i64)
        } else {
          visitor.visit_f64(js_number)
        }
      }
      ValueType::String => {
        let js_string = unsafe { JsString::from_raw_unchecked(self.0.env, self.0.value) };
        visitor.visit_str(js_string.into_utf8()?.as_str()?)
      }
      ValueType::Object => {
        let js_object = unsafe { JsObject::from_raw_unchecked(self.0.env, self.0.value) };
        if js_object.is_array()? {
          let mut deserializer =
            JsArrayAccess::new(&js_object, js_object.get_array_length_unchecked()?);
          visitor.visit_seq(&mut deserializer)
        } else if js_object.is_buffer()? {
          visitor.visit_bytes(&JsBufferValue::from_raw(self.0.env, self.0.value)?)
        } else {
          let mut deserializer = JsObjectAccess::new(&js_object)?;
          visitor.visit_map(&mut deserializer)
        }
      }
      #[cfg(feature = "napi6")]
      ValueType::BigInt => {
        let mut js_bigint = unsafe { JsBigInt::from_raw(self.0.env, self.0.value)? };

        let (signed, words) = js_bigint.get_words()?;
        let word_sized = words.len() < 2;

        match (signed, word_sized) {
          (true, true) => visitor.visit_i64(js_bigint.get_i64()?.0),
          (true, false) => visitor.visit_i128(js_bigint.get_i128()?.0),
          (false, true) => visitor.visit_u64(js_bigint.get_u64()?.0),
          (false, false) => visitor.visit_u128(js_bigint.get_u128()?.1),
        }
      }
      ValueType::External | ValueType::Function | ValueType::Symbol => Err(Error::new(
        Status::InvalidArg,
        format!("typeof {:?} value could not be deserialized", js_value_type),
      )),
      ValueType::Unknown => unreachable!(),
    }
  }

  fn deserialize_bytes<V>(self, visitor: V) -> Result<V::Value>
  where
    V: Visitor<'x>,
  {
    visitor.visit_bytes(&JsBufferValue::from_raw(self.0.env, self.0.value)?)
  }

  fn deserialize_byte_buf<V>(self, visitor: V) -> Result<V::Value>
  where
    V: Visitor<'x>,
  {
    visitor.visit_bytes(&JsBufferValue::from_raw(self.0.env, self.0.value)?)
  }

  fn deserialize_option<V>(self, visitor: V) -> Result<V::Value>
  where
    V: Visitor<'x>,
  {
    match type_of!(self.0.env, self.0.value)? {
      ValueType::Undefined | ValueType::Null => visitor.visit_none(),
      _ => visitor.visit_some(self),
    }
  }

  fn deserialize_enum<V>(
    self,
    _name: &'static str,
    _variants: &'static [&'static str],
    visitor: V,
  ) -> Result<V::Value>
  where
    V: Visitor<'x>,
  {
    let js_value_type = type_of!(self.0.env, self.0.value)?;
    match js_value_type {
      ValueType::String => visitor.visit_enum(JsEnumAccess::new(
        unsafe { JsString::from_raw_unchecked(self.0.env, self.0.value) }
          .into_utf8()?
          .into_owned()?,
        None,
      )),
      ValueType::Object => {
        let js_object = unsafe { JsObject::from_raw_unchecked(self.0.env, self.0.value) };
        let properties = js_object.get_property_names()?;
        let property_len = properties.get_array_length_unchecked()?;
        if property_len != 1 {
          Err(Error::new(
            Status::InvalidArg,
            format!(
              "object key length: {}, can not deserialize to Enum",
              property_len
            ),
          ))
        } else {
          let key = properties.get_element::<JsString>(0)?;
          let value: JsUnknown = js_object.get_property(key)?;
          visitor.visit_enum(JsEnumAccess::new(
            key.into_utf8()?.into_owned()?,
            Some(&value.0),
          ))
        }
      }
      _ => Err(Error::new(
        Status::InvalidArg,
        format!(
          "{:?} type could not deserialize to Enum type",
          js_value_type
        ),
      )),
    }
  }

  fn deserialize_ignored_any<V>(self, visitor: V) -> Result<V::Value>
  where
    V: Visitor<'x>,
  {
    visitor.visit_unit()
  }

  forward_to_deserialize_any! {
     <V: Visitor<'x>>
      bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string
      unit unit_struct seq tuple tuple_struct map struct identifier
      newtype_struct
  }
}

#[doc(hidden)]
pub(crate) struct JsEnumAccess<'env> {
  variant: String,
  value: Option<&'env Value>,
}

#[doc(hidden)]
impl<'env> JsEnumAccess<'env> {
  fn new(variant: String, value: Option<&'env Value>) -> Self {
    Self { variant, value }
  }
}

#[doc(hidden)]
impl<'de, 'env> EnumAccess<'de> for JsEnumAccess<'env> {
  type Error = Error;
  type Variant = JsVariantAccess<'env>;

  fn variant_seed<V>(self, seed: V) -> Result<(V::Value, Self::Variant)>
  where
    V: DeserializeSeed<'de>,
  {
    use serde::de::IntoDeserializer;
    let variant = self.variant.into_deserializer();
    let variant_access = JsVariantAccess { value: self.value };
    seed.deserialize(variant).map(|v| (v, variant_access))
  }
}

#[doc(hidden)]
pub(crate) struct JsVariantAccess<'env> {
  value: Option<&'env Value>,
}

#[doc(hidden)]
impl<'de, 'env> VariantAccess<'de> for JsVariantAccess<'env> {
  type Error = Error;
  fn unit_variant(self) -> Result<()> {
    match self.value {
      Some(val) => {
        let mut deserializer = De(val);
        serde::de::Deserialize::deserialize(&mut deserializer)
      }
      None => Ok(()),
    }
  }

  fn newtype_variant_seed<T>(self, seed: T) -> Result<T::Value>
  where
    T: DeserializeSeed<'de>,
  {
    match self.value {
      Some(val) => {
        let mut deserializer = De(val);
        seed.deserialize(&mut deserializer)
      }
      None => Err(serde::de::Error::invalid_type(
        Unexpected::UnitVariant,
        &"newtype variant",
      )),
    }
  }

  fn tuple_variant<V>(self, _len: usize, visitor: V) -> Result<V::Value>
  where
    V: Visitor<'de>,
  {
    match self.value {
      Some(js_value) => {
        let js_object = unsafe { JsObject::from_raw(js_value.env, js_value.value)? };
        if js_object.is_array()? {
          let mut deserializer =
            JsArrayAccess::new(&js_object, js_object.get_array_length_unchecked()?);
          visitor.visit_seq(&mut deserializer)
        } else {
          Err(serde::de::Error::invalid_type(
            Unexpected::Other("JsValue"),
            &"tuple variant",
          ))
        }
      }
      None => Err(serde::de::Error::invalid_type(
        Unexpected::UnitVariant,
        &"tuple variant",
      )),
    }
  }

  fn struct_variant<V>(self, _fields: &'static [&'static str], visitor: V) -> Result<V::Value>
  where
    V: Visitor<'de>,
  {
    match self.value {
      Some(js_value) => {
        if let Ok(val) = unsafe { JsObject::from_raw(js_value.env, js_value.value) } {
          let mut deserializer = JsObjectAccess::new(&val)?;
          visitor.visit_map(&mut deserializer)
        } else {
          Err(serde::de::Error::invalid_type(
            Unexpected::Other("JsValue"),
            &"struct variant",
          ))
        }
      }
      _ => Err(serde::de::Error::invalid_type(
        Unexpected::UnitVariant,
        &"struct variant",
      )),
    }
  }
}

#[doc(hidden)]
struct JsArrayAccess<'env> {
  input: &'env JsObject,
  idx: u32,
  len: u32,
}

#[doc(hidden)]
impl<'env> JsArrayAccess<'env> {
  fn new(input: &'env JsObject, len: u32) -> Self {
    Self { input, idx: 0, len }
  }
}

#[doc(hidden)]
impl<'de, 'env> SeqAccess<'de> for JsArrayAccess<'env> {
  type Error = Error;

  fn next_element_seed<T>(&mut self, seed: T) -> Result<Option<T::Value>>
  where
    T: DeserializeSeed<'de>,
  {
    if self.idx >= self.len {
      return Ok(None);
    }
    let v = self.input.get_element::<JsUnknown>(self.idx)?;
    self.idx += 1;

    let mut de = De(&v.0);
    seed.deserialize(&mut de).map(Some)
  }
}

#[doc(hidden)]
pub(crate) struct JsObjectAccess<'env> {
  value: &'env JsObject,
  properties: JsObject,
  idx: u32,
  property_len: u32,
}

#[doc(hidden)]
impl<'env> JsObjectAccess<'env> {
  fn new(value: &'env JsObject) -> Result<Self> {
    let properties = value.get_property_names()?;
    let property_len = properties.get_array_length_unchecked()?;
    Ok(Self {
      value,
      properties,
      idx: 0,
      property_len,
    })
  }
}

#[doc(hidden)]
impl<'de, 'env> MapAccess<'de> for JsObjectAccess<'env> {
  type Error = Error;

  fn next_key_seed<K>(&mut self, seed: K) -> Result<Option<K::Value>>
  where
    K: DeserializeSeed<'de>,
  {
    if self.idx >= self.property_len {
      return Ok(None);
    }

    let prop_name = self.properties.get_element::<JsUnknown>(self.idx)?;

    let mut de = De(&prop_name.0);
    seed.deserialize(&mut de).map(Some)
  }

  fn next_value_seed<V>(&mut self, seed: V) -> Result<V::Value>
  where
    V: DeserializeSeed<'de>,
  {
    if self.idx >= self.property_len {
      return Err(Error::new(
        Status::InvalidArg,
        format!("Index:{} out of range: {}", self.property_len, self.idx),
      ));
    }
    let prop_name = self.properties.get_element::<JsString>(self.idx)?;
    let value: JsUnknown = self.value.get_property(prop_name)?;

    self.idx += 1;
    let mut de = De(&value.0);
    let res = seed.deserialize(&mut de)?;
    Ok(res)
  }
}
