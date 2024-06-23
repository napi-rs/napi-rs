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
use libuv::sys::uv_loop_t;
use libuv::AsyncHandle;
use libuv::HandleTrait;
use libuv::Loop;
use once_cell::unsync::Lazy;

use crate::Env;

enum WakerEvent {
  GetThreadNotify(Sender<Arc<ThreadNotify>>),
  Handle(AsyncHandle),
  Next,
}

thread_local! {
  static LOCAL_POOL: Lazy<RefCell<LocalPool>> = Lazy::new(|| RefCell::new(LocalPool::new()));
  static SPAWNER: Lazy<LocalSpawner> = Lazy::new(|| LOCAL_POOL.with(|ex| ex.borrow().spawner()) );
  static TASK_COUNT: Lazy<RefCell<usize>> = Lazy::new(|| Default::default() );
  static WAKER_THREAD: Lazy<Sender<WakerEvent>> = Lazy::new(|| {
    let (tx, rx) = channel();

    // Dedicated waker thread to use for waiting on pending futures
    thread::spawn(move || {
      let thread_notify = ThreadNotify::new();
      let mut handle = None::<AsyncHandle>;

      while let Ok(event) = rx.recv() {
        match event {
          WakerEvent::GetThreadNotify(tx) => {
            tx.send(thread_notify.clone()).unwrap();
          }
          WakerEvent::Handle(mut incoming) => {
            incoming.send().unwrap();
            handle.replace(incoming);
          },
          WakerEvent::Next => {
            wait_for_wake(&thread_notify);
            handle.unwrap().send().unwrap();
          },
        };
      }
    });

    tx
  });
}

pub fn spawn_async_local(env: &Env, future: impl Future + 'static) {
  SPAWNER.with(move |ls| {
    ls.spawn_local(async move {
      future.await;
      task_count_dec();
    })
    .unwrap()
  });

  run_executor_if_not_running(env);
}

fn run_executor_if_not_running(env: &Env) {
  // Start the digest which will do a non-blocking poll of
  // all the futures in the pool
  if task_count_inc() != 0 {
    return;
  }

  // Get access to the thread waker
  let tx_waker_thread = WAKER_THREAD.with(|tx| (*tx).clone());
  let thread_notify = {
    let (tx, rx) = channel();
    tx_waker_thread
      .send(WakerEvent::GetThreadNotify(tx))
      .unwrap();
    rx.recv().unwrap()
  };

  // Start an async handle that will be invoked by the waker thread
  let handle = get_lib_uv(&env)
    .r#async({
      let tx_waker_thread = tx_waker_thread.clone();

      move |mut handle: AsyncHandle| {
        let thread_notify = thread_notify.clone();
        LOCAL_POOL.with(move |lp| lp.borrow_mut().run_until_stalled(thread_notify));

        if task_count() == 0 {
          handle.close(|_| {});
          return;
        } else {
          tx_waker_thread.send(WakerEvent::Next).unwrap();
        }
      }
    })
    .unwrap();

  // Give the waker thread the async handle
  tx_waker_thread.send(WakerEvent::Handle(handle)).unwrap();
}

fn get_lib_uv(env: &Env) -> Loop {
  let uv = env.get_uv_event_loop().unwrap();
  unsafe { libuv::r#loop::Loop::from_external(uv as *mut uv_loop_t) }
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
