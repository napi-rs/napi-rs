use std::any::TypeId;

#[repr(C)]
pub struct TaggedObject<T> {
  type_id: TypeId,
  pub(crate) object: Option<T>,
}

impl<T: 'static> TaggedObject<T> {
  pub fn new(object: T) -> Self {
    TaggedObject {
      type_id: TypeId::of::<T>(),
      object: Some(object),
    }
  }
}
