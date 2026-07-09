#[cfg(not(target_family = "wasm"))]
use futures::prelude::*;
use napi::bindgen_prelude::*;
#[cfg(not(target_family = "wasm"))]
use napi::tokio::fs;
#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
use napi::JsDeferred;
#[cfg(not(feature = "noop"))]
use std::sync::{
  atomic::{AtomicBool, AtomicU32, Ordering},
  Arc,
};
#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
use std::{
  cell::{Cell, RefCell},
  path::Path,
  rc::Rc,
  time::{Duration, Instant},
};

#[napi]
async fn read_file_async(path: String) -> Result<Buffer> {
  #[cfg(not(target_family = "wasm"))]
  {
    fs::read(path)
      .map(|r| match r {
        Ok(content) => Ok(content.into()),
        Err(e) => Err(Error::new(
          Status::GenericFailure,
          format!("failed to read file, {}", e),
        )),
      })
      .await
  }
  #[cfg(target_family = "wasm")]
  {
    let conetent = std::fs::read(path)?;
    Ok(conetent.into())
  }
}

#[napi]
async fn async_multi_two(arg: u32) -> Result<u32> {
  tokio::task::spawn(async move { Ok(arg * 2) })
    .await
    .unwrap()
}

#[napi]
async fn panic_in_async() {
  panic!("panic in async function");
}

#[cfg(not(feature = "noop"))]
#[napi(ts_return_type = "ExternalObject<number>")]
fn create_async_reference_setup_probe(value: u32) -> External<AtomicU32> {
  External::new(AtomicU32::new(value))
}

#[cfg(not(feature = "noop"))]
#[napi(ts_args_type = "probe: ExternalObject<number>, value: number")]
async fn async_reference_setup_probe(probe: &External<AtomicU32>, value: u32) -> u32 {
  probe.load(Ordering::Relaxed) + value
}

#[cfg(not(feature = "noop"))]
#[napi(ts_args_type = "first: ExternalObject<number>, second: ExternalObject<number>")]
async fn async_partial_reference_setup_probe(
  first: &External<AtomicU32>,
  second: &External<AtomicU32>,
) -> u32 {
  first.load(Ordering::Relaxed) + second.load(Ordering::Relaxed)
}

#[cfg(not(feature = "noop"))]
#[napi]
fn shutdown_async_runtime_for_test() -> Result<()> {
  try_shutdown_async_runtime()
}

#[napi]
fn pending_async_block_with_terminal_finalizer(
  env: &Env,
  result_path: String,
) -> Result<AsyncBlock<()>> {
  AsyncBlockBuilder::new(async {
    std::future::pending::<()>().await;
    Ok(())
  })
  .with_terminal_finalizer(move || {
    let _ = std::fs::write(result_path, b"finalized");
  })
  .build(env)
}

#[cfg(not(feature = "noop"))]
struct AsyncBlockSetupDropProbe(Arc<AtomicBool>);

#[cfg(not(feature = "noop"))]
impl Drop for AsyncBlockSetupDropProbe {
  fn drop(&mut self) {
    self.0.store(true, Ordering::Release);
  }
}

#[cfg(not(feature = "noop"))]
#[napi]
fn stopped_tokio_async_block_cleanup_order(
  env: &Env,
  result_path: String,
) -> Result<AsyncBlock<()>> {
  let future_dropped = Arc::new(AtomicBool::new(false));
  let resolver_dropped = Arc::new(AtomicBool::new(false));
  let finalizer_future_dropped = Arc::clone(&future_dropped);
  let finalizer_resolver_dropped = Arc::clone(&resolver_dropped);
  let future_probe = AsyncBlockSetupDropProbe(future_dropped);
  let resolver_probe = AsyncBlockSetupDropProbe(resolver_dropped);

  AsyncBlockBuilder::new(async move {
    let _future_probe = future_probe;
    std::future::pending::<()>().await;
    Ok(())
  })
  .with_dispose(move |_| {
    drop(resolver_probe);
    Ok(())
  })
  .with_terminal_finalizer(move || {
    let shutdown = match try_shutdown_async_runtime() {
      Ok(()) => "Ok".to_owned(),
      Err(error) => format!("{}\n{}", error.status.as_ref(), error.reason),
    };
    let _ = std::fs::write(
      result_path,
      format!(
        "future={}\nresolver={}\nshutdown={shutdown}",
        finalizer_future_dropped.load(Ordering::Acquire),
        finalizer_resolver_dropped.load(Ordering::Acquire)
      ),
    );
  })
  .build(env)
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
type LifecycleDeferred = JsDeferred<(), fn(Env) -> Result<()>>;

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
static DEFERRED_FINALIZE_CALLBACK_COUNT: AtomicU32 = AtomicU32::new(0);

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
thread_local! {
  static SETTLED_LIFECYCLE_DEFERRED: RefCell<Option<LifecycleDeferred>> =
    const { RefCell::new(None) };
  static CLEANUP_ORDER_LIFECYCLE_DEFERRED: RefCell<Option<LifecycleDeferred>> =
    const { RefCell::new(None) };
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
struct DeferredFinalizeDropProbe(Rc<Cell<bool>>);

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
impl Drop for DeferredFinalizeDropProbe {
  fn drop(&mut self) {
    self.0.set(true);
  }
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "abandonDeferredClones")]
fn abandon_lifecycle_deferred_clones(env: &Env) -> Result<()> {
  let (deferred, _promise): (LifecycleDeferred, _) = env.create_deferred()?;
  let first_clone = deferred.clone();
  let last_clone = deferred.clone();

  drop(deferred);
  drop(first_clone);
  drop(last_clone);
  Ok(())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "settleDeferredClone")]
fn settle_lifecycle_deferred_clone(env: &Env) -> Result<Object<'_>> {
  let (deferred, promise): (LifecycleDeferred, _) = env.create_deferred()?;
  SETTLED_LIFECYCLE_DEFERRED.with(|stored| stored.borrow_mut().replace(deferred.clone()));
  deferred.resolve(|_| Ok(()));
  Ok(promise)
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "settleDeferredBeforeFinalizeRegistration")]
fn settle_lifecycle_deferred_before_finalize_registration(env: &Env) -> Result<Object<'_>> {
  DEFERRED_FINALIZE_CALLBACK_COUNT.store(0, Ordering::SeqCst);
  let (deferred, promise): (LifecycleDeferred, _) = env.create_deferred()?;
  let mut finalize_owner = deferred.clone();

  std::thread::scope(|scope| {
    scope
      .spawn(move || deferred.resolve(|_| Ok(())))
      .join()
      .map_err(|_| Error::from_reason("deferred settlement worker panicked"))
  })?;

  finalize_owner.set_finalize_callback(Some(Box::new(|_| {
    DEFERRED_FINALIZE_CALLBACK_COUNT.fetch_add(1, Ordering::SeqCst);
  })));
  Ok(promise)
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "deferredFinalizeCallbackCount")]
fn deferred_finalize_callback_count() -> u32 {
  DEFERRED_FINALIZE_CALLBACK_COUNT.load(Ordering::SeqCst)
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "registerLateDeferredFinalizeCallback")]
fn register_late_lifecycle_deferred_finalize_callback() -> Result<bool> {
  let mut deferred = SETTLED_LIFECYCLE_DEFERRED
    .with(|stored| stored.borrow_mut().take())
    .ok_or_else(|| Error::from_reason("no settled lifecycle deferred was stashed"))?;
  let dropped = Rc::new(Cell::new(false));
  let capture = DeferredFinalizeDropProbe(Rc::clone(&dropped));
  deferred.set_finalize_callback(Some(Box::new(move |_| drop(capture))));
  Ok(dropped.get())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "registerDeferredCleanupOrderProbe")]
fn register_lifecycle_deferred_cleanup_order_probe(env: &Env, result_path: String) -> Result<()> {
  let _cleanup_hook = env.add_env_cleanup_hook(result_path, |result_path| {
    let Some(mut deferred) =
      CLEANUP_ORDER_LIFECYCLE_DEFERRED.with(|stored| stored.borrow_mut().take())
    else {
      let _ = std::fs::write(result_path, "missing deferred");
      return;
    };
    let dropped = Rc::new(Cell::new(false));
    let capture = DeferredFinalizeDropProbe(Rc::clone(&dropped));
    deferred.set_finalize_callback(Some(Box::new(move |_| drop(capture))));
    let dropped_during_cleanup = dropped.get();
    let _ = std::fs::write(result_path, format!("dropped={dropped_during_cleanup}"));
  })?;
  let (deferred, _promise): (LifecycleDeferred, _) = env.create_deferred()?;
  CLEANUP_ORDER_LIFECYCLE_DEFERRED.with(|stored| stored.borrow_mut().replace(deferred));
  Ok(())
}

#[cfg(all(not(feature = "noop"), not(target_family = "wasm")))]
#[napi(js_name = "startDeferredTeardownRace")]
fn start_lifecycle_deferred_teardown_race(
  env: &Env,
  ready_path: String,
  release_path: String,
  done_path: String,
  count: u32,
) -> Result<()> {
  if count == 0 || count > 4096 {
    return Err(Error::from_reason(
      "deferred teardown race count must be between 1 and 4096",
    ));
  }
  let mut deferreds = Vec::with_capacity(count as usize);
  for _ in 0..count {
    let (deferred, _promise): (LifecycleDeferred, _) = env.create_deferred()?;
    deferreds.push(deferred);
  }

  std::thread::spawn(move || {
    let outcome = (|| -> std::io::Result<()> {
      std::fs::write(&ready_path, b"ready")?;
      let deadline = Instant::now() + Duration::from_secs(10);
      while !Path::new(&release_path).exists() {
        if Instant::now() >= deadline {
          return Err(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "timed out waiting to race deferred settlement with teardown",
          ));
        }
        std::thread::sleep(Duration::from_millis(1));
      }
      for deferred in deferreds {
        deferred.resolve(|_| Ok(()));
        std::thread::yield_now();
      }
      Ok(())
    })();
    let marker = match outcome {
      Ok(()) => "done".to_owned(),
      Err(error) => format!("error={error}"),
    };
    let _ = std::fs::write(done_path, marker);
  });
  Ok(())
}

#[napi(async_runtime)]
pub fn within_async_runtime_if_available() {
  tokio::spawn(async {
    println!("within_runtime_if_available");
  });
}

#[napi(constructor)]
pub struct AsyncThrowClass {}

#[napi]
impl AsyncThrowClass {
  #[napi]
  pub async fn async_throw_error(&self) -> Result<()> {
    Err(Error::new(Status::GenericFailure, "Throw async error"))
  }
}
