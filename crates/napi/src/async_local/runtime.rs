use std::cell::RefCell;
use std::future::Future;
use std::sync::mpsc::channel;
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread;

use super::executor::wait_for_wake;
use super::executor::LocalPool;
use super::executor::LocalSpawner;
use super::executor::ThreadNotify;
use futures::task::LocalSpawnExt;
use once_cell::unsync::Lazy;

use crate::threadsafe_function::ThreadSafeCallContext;
use crate::threadsafe_function::ThreadsafeFunction;
use crate::threadsafe_function::ThreadsafeFunctionCallMode;
use crate::Env;
use crate::JsUnknown;

type ExecuterOptions = Arc<ThreadNotify>;

enum WakerEvent {
  Context(ThreadsafeFunction<ExecuterOptions>),
  Next,
  Done,
}

thread_local! {
  static LOCAL_POOL: Lazy<RefCell<LocalPool>> = Lazy::new(|| RefCell::new(LocalPool::new()));
  static SPAWNER: Lazy<LocalSpawner> = Lazy::new(|| LOCAL_POOL.with(|ex| ex.borrow().spawner()));
  static TASK_COUNT: Lazy<RefCell<usize>> = Lazy::new(|| Default::default() );
  static WAKER_THREAD: Lazy<Sender<WakerEvent>> = Lazy::new(|| {
    let (tx, rx) = channel();

    // Dedicated waker thread to use for waiting on pending futures
    thread::spawn(move || {
      let thread_notify = ThreadNotify::new();
      let mut handle = None::<ThreadsafeFunction<ExecuterOptions>>;

      while let Ok(event) = rx.recv() {
        match event {
          WakerEvent::Context(incoming) => {
            handle.replace(incoming);
            handle.as_ref().unwrap().call(Ok(thread_notify.clone()), ThreadsafeFunctionCallMode::Blocking);
          },
          WakerEvent::Done => {
            drop(handle.take());
          }
          WakerEvent::Next => {
            wait_for_wake(&thread_notify);
            handle.as_ref().unwrap().call(Ok(thread_notify.clone()), ThreadsafeFunctionCallMode::Blocking);
          },
        };
      }
    });

    tx
  });
}

pub fn spawn_async_local(env: &Env, future: impl Future + 'static) -> crate::Result<()> {
  SPAWNER.with(move |ls| {
    ls.spawn_local(async move {
      future.await;
      task_count_dec();
    })
    .unwrap();
  });

  // Start the digest which will do a non-blocking poll of
  // all the futures in the pool
  if task_count_inc() != 0 {
    return Ok(());
  }

  let jsfn = env.create_function_from_closure("", |_ctx| Ok(Vec::<JsUnknown>::new()))?;

  let tsfn: ThreadsafeFunction<ExecuterOptions> = env.create_threadsafe_function(&jsfn, 0, {
    move |ctx: ThreadSafeCallContext<ExecuterOptions>| {
      let thread_notify = ctx.value;
      LOCAL_POOL.with(move |lp| lp.borrow_mut().run_until_stalled(thread_notify));
      if task_count() == 0 {
        next_tx().send(WakerEvent::Done).unwrap();
      } else {
        next_tx().send(WakerEvent::Next).unwrap();
      }
      Ok(Vec::<JsUnknown>::new())
    }
  })?;

  // Give the waker thread the async handle
  next_tx().send(WakerEvent::Context(tsfn)).unwrap();
  Ok(())
}

fn task_count() -> usize {
  TASK_COUNT.with(|c| *c.borrow_mut())
}

fn task_count_inc() -> usize {
  let current = task_count();
  TASK_COUNT.with(|c| *c.borrow_mut() += 1);
  current
}

fn task_count_dec() -> usize {
  let current = task_count();
  TASK_COUNT.with(|c| *c.borrow_mut() -= 1);
  current
}

fn next_tx() -> Sender<WakerEvent> {
  WAKER_THREAD.with(|tx| (*tx).clone())
}
