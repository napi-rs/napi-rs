use napi::*;

#[js_function]
pub fn add_removable_async_cleanup_hook(ctx: CallContext) -> Result<()> {
  let cleanup_hook = ctx
    .env
    .add_removable_async_cleanup_hook(1u32, |_arg: u32| {
      println!("Exit from sub process");
    })?;
  cleanup_hook.forget();
  Ok(())
}

#[js_function]
pub fn add_async_cleanup_hook(ctx: CallContext) -> Result<()> {
  ctx.env.add_async_cleanup_hook(1u32, |_arg: u32| {
    println!("Exit from sub process");
  })?;
  Ok(())
}

#[js_function]
pub fn remove_async_cleanup_hook(ctx: CallContext) -> Result<()> {
  ctx
    .env
    .add_removable_async_cleanup_hook(1u32, |_arg: u32| {
      println!("Exit from sub process");
    })?;
  Ok(())
}
