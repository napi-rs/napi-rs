use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::future::Future;
use std::mem::ManuallyDrop;
use std::pin::Pin;
use std::ptr;
use std::rc::Rc;
use std::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

use crate::bindgen_runtime::Object;
use crate::{CallContext, Env, JsFunction, Result};

thread_local! {
  static ENV: Env = unsafe { Env::from_raw(ptr::null_mut()) };
  static QUEUE: Queue = Queue::new();
}

struct JsPromise {
  inner: Object,
}

impl JsPromise {
  fn new() -> Result<Self> {
    let p = ENV.with(|env| {
      let global = env.get_global()?;
      let global_promise: Object = global.get_named_property_unchecked("Promise")?;
      let resolve_fn: JsFunction = global_promise.get_named_property_unchecked("resolve")?;
      resolve_fn.call(Some(&global_promise), &[env.get_undefined()?])
    })?;
    Ok(Self {
      inner: unsafe { p.cast() },
    })
  }

  fn then(&self, closure: Box<dyn Fn(CallContext) -> Result<()>>) -> Result<&Self> {
    let then_fn: JsFunction = self.inner.get_named_property_unchecked("then")?;
    let then_callback = ENV.with(|env| env.create_function_from_closure("then", closure))?;
    then_fn.call(Some(&self.inner), &[&then_callback])?;
    Ok(self)
  }
}

struct QueueState {
  // The queue of Tasks which are to be run in order. In practice this is all the
  // synchronous work of futures, and each `Task` represents calling `poll` on
  // a future "at the right time".
  tasks: RefCell<VecDeque<Rc<Task>>>,

  // This flag indicates whether we've scheduled `run_all` to run in the future.
  // This is used to ensure that it's only scheduled once.
  is_scheduled: Cell<bool>,
}

impl QueueState {
  fn run_all(&self) {
    // "consume" the schedule
    let _was_scheduled = self.is_scheduled.replace(false);
    debug_assert!(_was_scheduled);

    // Stop when all tasks that have been scheduled before this tick have been run.
    // Tasks that are scheduled while running tasks will run on the next tick.
    let mut task_count_left = self.tasks.borrow().len();
    while task_count_left > 0 {
      task_count_left -= 1;
      let task = match self.tasks.borrow_mut().pop_front() {
        Some(task) => task,
        None => break,
      };
      task.run();
    }

    // All of the Tasks have been run, so it's now possible to schedule the
    // next tick again
  }
}

pub(crate) struct Queue {
  state: Rc<QueueState>,
  promise: JsPromise,
  closure: RefCell<Box<dyn Fn(CallContext) -> Result<()>>>,
}

impl Queue {
  // Schedule a task to run on the next tick
  pub(crate) fn schedule_task(&self, task: Rc<Task>) {
    self.state.tasks.borrow_mut().push_back(task);
    // Note that we currently use a promise and a closure to do this, but
    // eventually we should probably use something like `queueMicrotask`:
    // https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/queueMicrotask
    if !self.state.is_scheduled.replace(true) {
      let _ = self
        .promise
        .then(self.closure.replace(Box::new(|_| Ok(()))));
    }
  }
  // Append a task to the currently running queue, or schedule it
  pub(crate) fn push_task(&self, task: Rc<Task>) {
    // It would make sense to run this task on the same tick.  For now, we
    // make the simplifying choice of always scheduling tasks for a future tick.
    self.schedule_task(task)
  }
}

impl Queue {
  fn new() -> Self {
    let state = Rc::new(QueueState {
      is_scheduled: Cell::new(false),
      tasks: RefCell::new(VecDeque::new()),
    });

    Self {
      promise: JsPromise::new().expect("Create global promise failed"),

      // This closure will only be called on the next microtask event
      // tick
      closure: RefCell::new(Box::new(|_| Ok(()))),

      state,
    }
  }
}

struct Inner {
  future: Pin<Box<dyn Future<Output = ()> + 'static>>,
  waker: Waker,
}

pub(crate) struct Task {
  // The actual Future that we're executing as part of this task.
  //
  // This is an Option so that the Future can be immediately dropped when it's
  // finished
  inner: RefCell<Option<Inner>>,

  // This is used to ensure that the Task will only be queued once
  is_queued: Cell<bool>,
}

impl Task {
  pub(crate) fn spawn(future: Pin<Box<dyn Future<Output = ()> + 'static>>) {
    let this = Rc::new(Self {
      inner: RefCell::new(None),
      is_queued: Cell::new(true),
    });

    let waker = unsafe { Waker::from_raw(Task::into_raw_waker(Rc::clone(&this))) };

    *this.inner.borrow_mut() = Some(Inner { future, waker });

    QUEUE.with(|queue| queue.schedule_task(this));
  }

  fn wake_by_ref(this: &Rc<Self>) {
    // If we've already been placed on the run queue then there's no need to
    // requeue ourselves since we're going to run at some point in the
    // future anyway.
    if this.is_queued.replace(true) {
      return;
    }

    QUEUE.with(|queue| {
      queue.push_task(Rc::clone(this));
    });
  }

  /// Creates a standard library `RawWaker` from an `Rc` of ourselves.
  ///
  /// Note that in general this is wildly unsafe because everything with
  /// Futures requires `Sync` + `Send` with regard to Wakers. For wasm,
  /// however, everything is guaranteed to be singlethreaded (since we're
  /// compiled without the `atomics` feature) so we "safely lie" and say our
  /// `Rc` pointer is good enough.
  unsafe fn into_raw_waker(this: Rc<Self>) -> RawWaker {
    unsafe fn raw_clone(ptr: *const ()) -> RawWaker {
      let ptr = ManuallyDrop::new(unsafe { Rc::from_raw(ptr as *const Task) });
      unsafe { Task::into_raw_waker((*ptr).clone()) }
    }

    unsafe fn raw_wake(ptr: *const ()) {
      let ptr = unsafe { Rc::from_raw(ptr as *const Task) };
      Task::wake_by_ref(&ptr);
    }

    unsafe fn raw_wake_by_ref(ptr: *const ()) {
      let ptr = ManuallyDrop::new(unsafe { Rc::from_raw(ptr as *const Task) });
      Task::wake_by_ref(&ptr);
    }

    unsafe fn raw_drop(ptr: *const ()) {
      drop(unsafe { Rc::from_raw(ptr as *const Task) });
    }

    const VTABLE: RawWakerVTable =
      RawWakerVTable::new(raw_clone, raw_wake, raw_wake_by_ref, raw_drop);

    RawWaker::new(Rc::into_raw(this) as *const (), &VTABLE)
  }

  pub(crate) fn run(&self) {
    let mut borrow = self.inner.borrow_mut();

    // Wakeups can come in after a Future has finished and been destroyed,
    // so handle this gracefully by just ignoring the request to run.
    let inner = match borrow.as_mut() {
      Some(inner) => inner,
      None => return,
    };

    // Ensure that if poll calls `waker.wake()` we can get enqueued back on
    // the run queue.
    self.is_queued.set(false);

    let poll = {
      let mut cx = Context::from_waker(&inner.waker);
      inner.future.as_mut().poll(&mut cx)
    };

    // If a future has finished (`Ready`) then clean up resources associated
    // with the future ASAP. This ensures that we don't keep anything extra
    // alive in-memory by accident. Our own struct, `Rc<Task>` won't
    // actually go away until all wakers referencing us go away, which may
    // take quite some time, so ensure that the heaviest of resources are
    // released early.
    if let Poll::Ready(_) = poll {
      *borrow = None;
    }
  }
}

pub fn spawn() {}
