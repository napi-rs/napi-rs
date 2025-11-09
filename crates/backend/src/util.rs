use convert_case::{Case, Casing};

pub fn to_case<T: AsRef<str>>(input: T, case: Case<'static>) -> String {
  if input.as_ref().starts_with('_') {
    let trimmed = input.as_ref().trim_start_matches('_');
    trimmed.to_case(case)
  } else {
    input.as_ref().to_case(case)
  }
}
