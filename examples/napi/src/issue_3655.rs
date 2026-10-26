use std::sync::{
  atomic::{AtomicU32, Ordering},
  Arc,
};

use futures::FutureExt;
use napi::{bindgen_prelude::*, threadsafe_function::ThreadsafeFunctionCallMode};

// Repro coverage for napi-rs#3655: `napi_call_threadsafe_function` only takes
// ownership of the data pointer when it returns `napi_ok`. On `napi_queue_full`
// (or `napi_closing`) nothing is queued, so the boxed call data has to be freed
// by the caller. It used to be leaked, together with the payload it carried.

const REJECTED_CALLS: u32 = 4;

struct Issue3655Payload {
  drops: Arc<AtomicU32>,
}

impl Drop for Issue3655Payload {
  fn drop(&mut self) {
    self.drops.fetch_add(1, Ordering::SeqCst);
  }
}

#[napi(object)]
pub struct Issue3655Outcome {
  pub first_call_queued: bool,
  pub queue_full: u32,
  pub dropped: u32,
}

/// Fills a threadsafe function whose queue holds one item, then submits more
/// payloads. The JS callback cannot run before the native function returns, so
/// every later submission is rejected with `QueueFull`, and each of those
/// payloads must already be dropped by the time the submission returns.
fn count_rejected_payloads(
  fill: impl FnOnce(Issue3655Payload) -> Status,
  submit: impl Fn(Issue3655Payload) -> Status,
) -> Issue3655Outcome {
  let drops = Arc::new(AtomicU32::new(0));
  let new_payload = || Issue3655Payload {
    drops: drops.clone(),
  };
  let first_call_queued = fill(new_payload()) == Status::Ok;
  let queue_full = (0..REJECTED_CALLS)
    .map(|_| submit(new_payload()))
    .filter(|status| *status == Status::QueueFull)
    .count() as u32;
  Issue3655Outcome {
    first_call_queued,
    queue_full,
    dropped: drops.load(Ordering::SeqCst),
  }
}

/// Status of a `call_async` style future that is polled once: a rejected call
/// resolves to its error right away, an accepted one is still pending.
fn status_of_first_poll<Return>(
  future: impl std::future::Future<Output = Result<Return>>,
) -> Status {
  match future.now_or_never() {
    Some(Err(error)) => error.status,
    Some(Ok(_)) | None => Status::Ok,
  }
}

#[napi]
pub fn issue3655_rejected_calls(
  callback: Function<(), ()>,
  api: String,
) -> Result<Issue3655Outcome> {
  let tsfn = callback
    .build_threadsafe_function::<Issue3655Payload>()
    .max_queue_size::<1>()
    .build_callback(|_| Ok(()))?;
  let fill = |payload| tsfn.call(payload, ThreadsafeFunctionCallMode::NonBlocking);
  let outcome = match api.as_str() {
    "call" => count_rejected_payloads(fill, |payload| {
      tsfn.call(payload, ThreadsafeFunctionCallMode::NonBlocking)
    }),
    "callWithReturnValue" => count_rejected_payloads(fill, |payload| {
      tsfn.call_with_return_value(payload, ThreadsafeFunctionCallMode::NonBlocking, |_, _| {
        Ok(())
      })
    }),
    "callAsync" => count_rejected_payloads(fill, |payload| {
      status_of_first_poll(tsfn.call_async(payload))
    }),
    "callAsyncCatch" => count_rejected_payloads(fill, |payload| {
      status_of_first_poll(tsfn.call_async_catch(payload))
    }),
    _ => return Err(Error::new(Status::InvalidArg, format!("Unknown api {api}"))),
  };
  Ok(outcome)
}

#[napi]
pub fn issue3655_rejected_calls_callee_handled(
  callback: Function<(), ()>,
  api: String,
) -> Result<Issue3655Outcome> {
  let tsfn = callback
    .build_threadsafe_function::<Issue3655Payload>()
    .max_queue_size::<1>()
    .callee_handled::<true>()
    .build_callback(|_| Ok(()))?;
  let fill = |payload| tsfn.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
  let outcome = match api.as_str() {
    "call" => count_rejected_payloads(fill, |payload| {
      tsfn.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking)
    }),
    "callWithReturnValue" => count_rejected_payloads(fill, |payload| {
      tsfn.call_with_return_value(
        Ok(payload),
        ThreadsafeFunctionCallMode::NonBlocking,
        |_, _| Ok(()),
      )
    }),
    "callAsync" => count_rejected_payloads(fill, |payload| {
      status_of_first_poll(tsfn.call_async(Ok(payload)))
    }),
    "callAsyncCatch" => count_rejected_payloads(fill, |payload| {
      status_of_first_poll(tsfn.call_async_catch(Ok(payload)))
    }),
    _ => return Err(Error::new(Status::InvalidArg, format!("Unknown api {api}"))),
  };
  Ok(outcome)
}
