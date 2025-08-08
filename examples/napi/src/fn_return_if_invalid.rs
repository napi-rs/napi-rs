#[napi(return_if_invalid)]
pub fn array_params(arr: Vec<f64>) -> f64 {
  arr.into_iter().sum::<f64>()
}
