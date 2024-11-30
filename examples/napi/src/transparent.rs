use napi::Either;

#[napi(transparent)]
struct MyVec(Vec<Either<u32, String>>);

#[napi]
fn get_my_vec() -> MyVec {
  MyVec(vec![Either::A(42), Either::B("a string".to_owned())])
}
