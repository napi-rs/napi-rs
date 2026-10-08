use std::{
  collections::HashMap,
  sync::{Arc, Condvar, LazyLock, Mutex},
};

use napi::{bindgen_prelude::*, Task};

// Repro coverage for napi-rs#3583: a synchronous `#[napi]` callback returning
// `AsyncTask` lets the task capture forged `&'static` references to borrowed
// `#[napi]` class arguments (`&T`, `&self`). The generated borrow scope must
// root the JavaScript wrapper until the queued work settles, otherwise GC can
// run the wrapper's finalizer and free the `Box<T>` while `compute` still
// reads it.
//
// `compute` waits on a per-id gate shared with the JavaScript thread, so the
// test can force a GC while the borrow is definitely in flight instead of
// racing a sleep.

type BorrowGate = Arc<(Mutex<bool>, Condvar)>;

static BORROW_GATES: LazyLock<Mutex<HashMap<u32, BorrowGate>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));
static BORROW_GATE_WAITERS: LazyLock<Mutex<HashMap<u32, usize>>> =
  LazyLock::new(|| Mutex::new(HashMap::new()));

/// Create (or reset to closed) the gate with the given id.
#[napi]
pub fn open_borrow_gate(id: u32) {
  BORROW_GATES
    .lock()
    .unwrap()
    .insert(id, Arc::new((Mutex::new(false), Condvar::new())));
  BORROW_GATE_WAITERS.lock().unwrap().insert(id, 0);
}

/// Open the gate: every task currently waiting — and any queued behind it —
/// passes through.
#[napi]
pub fn close_borrow_gate(id: u32) {
  let gates = BORROW_GATES.lock().unwrap();
  if let Some(gate) = gates.get(&id) {
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
  }
}

/// Number of tasks currently blocked inside `wait_borrow_gate`.
#[napi]
pub fn borrow_gate_waiters(id: u32) -> u32 {
  BORROW_GATE_WAITERS
    .lock()
    .unwrap()
    .get(&id)
    .copied()
    .unwrap_or(0) as u32
}

fn wait_borrow_gate(id: u32) -> Result<()> {
  let gate = BORROW_GATES
    .lock()
    .unwrap()
    .get(&id)
    .cloned()
    .ok_or_else(|| {
      Error::new(
        Status::InvalidArg,
        format!("borrow gate {id} does not exist"),
      )
    })?;
  *BORROW_GATE_WAITERS.lock().unwrap().entry(id).or_insert(0) += 1;
  let mut open = gate.0.lock().unwrap();
  while !*open {
    open = gate.1.wait(open).unwrap();
  }
  Ok(())
}

pub struct ReadBorrowedTask<'a> {
  cache: &'a BorrowedCache,
  gate: u32,
}

#[napi]
impl<'task> Task for ReadBorrowedTask<'task> {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    wait_borrow_gate(self.gate)?;
    Ok(
      self
        .cache
        .data
        .iter()
        .fold(0u32, |acc, b| acc.wrapping_add(u32::from(*b))),
    )
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub struct BorrowedCache {
  data: Vec<u8>,
}

#[napi]
impl BorrowedCache {
  #[napi(constructor)]
  pub fn new(size: u32) -> Self {
    Self {
      data: (0..size).map(|i| i as u8).collect(),
    }
  }

  /// `&self` receiver variant: the `cb.this()` wrapper must stay rooted until
  /// the returned task settles.
  #[napi]
  pub fn read_async<'a>(&'a self, gate: u32) -> AsyncTask<ReadBorrowedTask<'a>> {
    AsyncTask::new(ReadBorrowedTask { cache: self, gate })
  }
}

/// Free-function variant: the `&BorrowedCache` argument wrapper must stay
/// rooted until the returned task settles.
#[napi]
pub fn read_borrowed_cache<'a>(
  cache: &'a BorrowedCache,
  gate: u32,
) -> AsyncTask<ReadBorrowedTask<'a>> {
  AsyncTask::new(ReadBorrowedTask { cache, gate })
}

/// AbortSignal variant: a queued (not yet executing) task cancelled through
/// the signal settles as an AbortError rejection; the scope roots must be
/// released on that path too.
#[napi]
pub fn read_borrowed_cache_with_signal<'a>(
  cache: &'a BorrowedCache,
  gate: u32,
  signal: AbortSignal,
) -> AsyncTask<ReadBorrowedTask<'a>> {
  AsyncTask::with_signal(ReadBorrowedTask { cache, gate }, signal)
}

pub struct BorrowGateBlockTask {
  gate: u32,
}

#[napi]
impl Task for BorrowGateBlockTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<Self::Output> {
    wait_borrow_gate(self.gate)
  }

  fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
    Ok(())
  }
}

/// A gate-blocked task with no borrowed arguments: used to saturate the libuv
/// pool so a later task is known to be queued, and to exercise the defer →
/// drain path for a scope with no roots at all.
#[napi]
pub fn block_borrow_gate(gate: u32) -> AsyncTask<BorrowGateBlockTask> {
  AsyncTask::new(BorrowGateBlockTask { gate })
}

/// Regression for the deferred-scope misroute: a future spawned inside the
/// callback body must not claim the borrow scope deferred for the returned
/// `AsyncTask`. Under the positional drain this `env.spawn_future` stole the
/// scope, leaving the returned task unrooted while its settle held (and then
/// released) the `cache` wrapper roots.
#[napi]
pub fn read_borrowed_cache_spawn_inside<'a>(
  cache: &'a BorrowedCache,
  gate: u32,
  env: Env,
) -> Result<AsyncTask<ReadBorrowedTask<'a>>> {
  env.spawn_future(async move { Ok::<(), Error>(()) })?;
  Ok(AsyncTask::new(ReadBorrowedTask { cache, gate }))
}

/// The `AsyncBlock` variant of the same misroute: the scope is claimed by the
/// returned block's own conversion, not by whatever drains first. `AsyncBlock`
/// futures must be `'static`, so the borrow cannot be captured — the read runs
/// eagerly while the scope's alias guard is held; what stays deferred is the
/// wrapper rooting and guard release until the block settles. The deliberately
/// discarded `AsyncBlockBuilder::build` is an extra in-body sink that must
/// leave the deferred scope for the returned value.
#[napi]
pub fn read_borrowed_cache_async_block(
  cache: &BorrowedCache,
  gate: u32,
  env: Env,
) -> Result<AsyncBlock<u32>> {
  let sum = cache
    .data
    .iter()
    .fold(0u32, |acc, b| acc.wrapping_add(u32::from(*b)));
  env.spawn_future(async move { Ok::<(), Error>(()) })?;
  drop(AsyncBlockBuilder::new(async move { Ok::<u32, Error>(0) }).build(&env)?);
  AsyncBlockBuilder::new(async move {
    wait_borrow_gate(gate)?;
    Ok::<u32, Error>(sum)
  })
  .build(&env)
}

/// `Option<AsyncTask>` spelling: the outermost return type is `Option`, so no
/// syntactic check on the declared return type can see the task. The deferred
/// scope claim inside `AsyncTask`'s `ToNapiValue` conversion protects the
/// borrow regardless of how the return type is spelled.
#[napi]
pub fn read_borrowed_cache_maybe<'a>(
  cache: &'a BorrowedCache,
  gate: u32,
  skip: bool,
) -> Option<AsyncTask<ReadBorrowedTask<'a>>> {
  if skip {
    None
  } else {
    Some(AsyncTask::new(ReadBorrowedTask { cache, gate }))
  }
}

/// `Result<Option<AsyncTask>>`: two layers of wrapper around the async sink.
#[napi]
pub fn read_borrowed_cache_maybe_result<'a>(
  cache: &'a BorrowedCache,
  gate: u32,
) -> Result<Option<AsyncTask<ReadBorrowedTask<'a>>>> {
  Ok(Some(AsyncTask::new(ReadBorrowedTask { cache, gate })))
}

/// Type-alias return spelling: the declared return type never names
/// `AsyncTask` at all.
pub type BorrowedCacheTask<'a> = AsyncTask<ReadBorrowedTask<'a>>;

#[napi(ts_return_type = "Promise<number>")]
pub fn read_borrowed_cache_alias<'a>(cache: &'a BorrowedCache, gate: u32) -> BorrowedCacheTask<'a> {
  AsyncTask::new(ReadBorrowedTask { cache, gate })
}

/// `Vec<AsyncTask>` spelling: every element claims its own lease on the same deferred
/// scope during the array conversion, so the wrapper must stay rooted until the LAST
/// task settles — a first task finishing early must not release roots a sibling still
/// needs.
#[napi]
pub fn read_borrowed_cache_vec<'a>(
  cache: &'a BorrowedCache,
  gate1: u32,
  gate2: u32,
) -> Vec<AsyncTask<ReadBorrowedTask<'a>>> {
  vec![
    AsyncTask::new(ReadBorrowedTask { cache, gate: gate1 }),
    AsyncTask::new(ReadBorrowedTask { cache, gate: gate2 }),
  ]
}
