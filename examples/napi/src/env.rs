use napi::bindgen_prelude::*;

#[napi]
pub fn run_script(env: &Env, script: String) -> Result<Unknown<'_>> {
  env.run_script(script)
}

#[napi]
pub fn get_module_file_name(env: Env) -> Result<String> {
  env.get_module_file_name()
}

#[napi]
pub fn throw_syntax_error(env: Env, error: String, code: Option<String>) {
  env.throw_syntax_error(error, code);
}
