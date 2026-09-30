//! Loads for napi's `wasm32-wasip1-threads` heap sync (`crates/napi/src/wasi_heap_sync.rs`).
//!
//! `stress.mjs` runs them on the threaded WASI build while the shared memory grows, under V8
//! flags that check every memory access against the accessing thread's own view of the memory
//! size. A thread that receives a block from another thread allocates before it reads the
//! block: the allocation takes the heap-sync lock, which brings the thread's memory size up to
//! date. Reading first is a gap the heap sync leaves open (see the module docs). Blocks sent to
//! JavaScript go through the threadsafe-function queue, as in any addon.

use std::{
  sync::{Arc, Mutex},
  thread,
};

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, UnknownReturnValue},
};
use napi_derive::napi;

/// Blocks one load keeps alive at once, so the heap holds about `LIVE_BLOCKS * maxBytes / 2`
/// per load and grows while the loads run.
const LIVE_BLOCKS: usize = 32;
/// Every this many rounds a thread passes a copy of its new block to the next thread.
const THREAD_HANDOFF_EVERY: u32 = 4;
/// Every this many rounds a thread passes a copy of its new block to JavaScript.
#[napi]
pub const JS_HANDOFF_EVERY: u32 = 16;
/// Blocks a mailbox holds. It is allocated before the threads start and never grows, so reading
/// it never touches memory that another thread grew; a full mailbox skips the handoff.
const MAILBOX_CAPACITY: usize = 16;

type Mailbox = Arc<Mutex<Vec<Vec<u8>>>>;

type OnBlock = ThreadsafeFunction<Buffer, UnknownReturnValue, Buffer, Status, false>;

/// xorshift32: a fixed seed gives each load the same sizes and tags on every run.
struct Rng(u32);

impl Rng {
  fn new(seed: u32) -> Self {
    Self(seed.wrapping_mul(0x9e37_79b9) | 1)
  }

  fn next(&mut self) -> u32 {
    let mut x = self.0;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    self.0 = x;
    x
  }
}

/// Every byte of a block is its tag, and tags are odd, so a zero page, or bytes that a block
/// with another tag wrote, fail this.
fn intact(block: &[u8]) -> bool {
  block
    .first()
    .is_some_and(|&tag| tag & 1 == 1 && block.iter().all(|&byte| byte == tag))
}

#[derive(Default)]
struct Handoff<'a> {
  inbox: Option<&'a Mailbox>,
  outbox: Option<&'a Mailbox>,
  on_block: Option<&'a OnBlock>,
}

/// One load: `rounds` blocks of 1..=`max_bytes` bytes, each a `malloc` and a `memory.fill`,
/// every fourth one grown in place or moved by `realloc` and then extended with a
/// `memory.copy`. It keeps [`LIVE_BLOCKS`] alive and frees a random one for each new one.
/// Returns the number of blocks that did not hold their tag.
fn churn(seed: u32, rounds: u32, max_bytes: u32, handoff: &Handoff) -> u32 {
  let mut rng = Rng::new(seed);
  let mut corrupt = 0;
  let mut live: Vec<Vec<u8>> = Vec::with_capacity(LIVE_BLOCKS);
  for round in 0..rounds {
    let size = 1 + (rng.next() % max_bytes.max(1)) as usize;
    let mut block = vec![(rng.next() as u8) | 1; size];
    if rng.next().is_multiple_of(4) {
      block.extend_from_within(..size.div_ceil(2));
    }
    if let Some(outbox) = handoff.outbox {
      if round.is_multiple_of(THREAD_HANDOFF_EVERY) {
        let copy = block.clone();
        let mut mailbox = outbox.lock().expect("mailbox lock");
        if mailbox.len() < MAILBOX_CAPACITY {
          mailbox.push(copy);
        }
      }
    }
    if let Some(inbox) = handoff.inbox {
      let received = inbox.lock().expect("mailbox lock").pop();
      if let Some(received) = received {
        // Allocate before the first read of the received bytes: the allocation takes the
        // heap-sync lock, which brings this thread's memory size up to the size the sending
        // thread published when it allocated them.
        let mut copy = Vec::with_capacity(received.len());
        copy.extend_from_slice(&received);
        corrupt += u32::from(!intact(&copy));
      }
    }
    if let Some(on_block) = handoff.on_block {
      if round.is_multiple_of(JS_HANDOFF_EVERY) {
        on_block.call(
          Buffer::from(block.clone()),
          ThreadsafeFunctionCallMode::NonBlocking,
        );
      }
    }
    if live.len() == LIVE_BLOCKS {
      let freed = live.swap_remove(rng.next() as usize % LIVE_BLOCKS);
      corrupt += u32::from(!intact(&freed));
    }
    live.push(block);
  }
  corrupt + live.iter().filter(|block| !intact(block)).count() as u32
}

/// Starts `threads` OS threads, each running one load. Thread `i` passes blocks to thread
/// `i + 1` (the last one to the first) and to `onBlock`, on the JavaScript thread. Each thread
/// calls `onDone` with its corrupt-block count when it ends. `onBlock` gets
/// `ceil(rounds / JS_HANDOFF_EVERY)` blocks from each thread.
#[napi]
pub fn churn_threads(
  threads: u32,
  rounds: u32,
  max_bytes: u32,
  on_block: ThreadsafeFunction<Buffer, UnknownReturnValue, Buffer, Status, false>,
  on_done: ThreadsafeFunction<u32, UnknownReturnValue, u32, Status, false>,
) -> Result<()> {
  if threads == 0 {
    return Err(Error::from_reason("threads must be at least 1"));
  }
  let on_block = Arc::new(on_block);
  let on_done = Arc::new(on_done);
  let mailboxes: Vec<Mailbox> = (0..threads)
    .map(|_| Arc::new(Mutex::new(Vec::with_capacity(MAILBOX_CAPACITY))))
    .collect();
  for index in 0..threads as usize {
    let inbox = Arc::clone(&mailboxes[index]);
    let outbox = Arc::clone(&mailboxes[(index + 1) % mailboxes.len()]);
    let on_block = Arc::clone(&on_block);
    let on_done = Arc::clone(&on_done);
    thread::Builder::new()
      .name(format!("churn-{index}"))
      .spawn(move || {
        let handoff = Handoff {
          inbox: Some(&inbox),
          outbox: Some(&outbox),
          on_block: Some(&on_block),
        };
        let corrupt = churn(index as u32, rounds, max_bytes, &handoff);
        on_done.call(corrupt, ThreadsafeFunctionCallMode::NonBlocking);
      })
      .map_err(|error| Error::from_reason(format!("failed to spawn a thread: {error}")))?;
  }
  Ok(())
}

pub struct ChurnTask {
  seed: u32,
  rounds: u32,
  max_bytes: u32,
}

#[napi]
impl Task for ChurnTask {
  type Output = u32;
  type JsValue = u32;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(churn(
      self.seed,
      self.rounds,
      self.max_bytes,
      &Handoff::default(),
    ))
  }

  fn resolve(&mut self, _env: Env, corrupt: Self::Output) -> Result<Self::JsValue> {
    Ok(corrupt)
  }
}

/// One load on emnapi's async-work pool; resolves to its corrupt-block count.
#[napi]
pub fn churn_async(seed: u32, rounds: u32, max_bytes: u32) -> AsyncTask<ChurnTask> {
  AsyncTask::new(ChurnTask {
    seed,
    rounds,
    max_bytes,
  })
}

/// The sum of the bytes of `block`, read by wasm on the JavaScript thread.
#[napi]
pub fn block_checksum(block: Buffer) -> u32 {
  block.iter().map(|&byte| u32::from(byte)).sum()
}

#[napi(object)]
pub struct ForeignGrowReport {
  /// The pages `foreignGrow` grew, in bytes: `[foreignStart, foreignEnd)`.
  pub foreign_start: f64,
  pub foreign_end: f64,
  /// The block libc returned afterwards, in bytes: `[blockStart, blockEnd)`.
  pub block_start: f64,
  pub block_end: f64,
  /// Whether the grown pages still hold only their own pattern after the block was filled.
  pub foreign_intact: bool,
}

/// Grows the memory by `pages` without libc, the way an allocator that calls `memory.grow`
/// itself does (the `dlmalloc` crate, mimalloc's WASI build), fills those pages, and then
/// allocates and fills a `blockBytes` block through libc. napi's `__wrap_sbrk` must never hand
/// the grown pages to dlmalloc.
#[napi]
pub fn foreign_grow(pages: u32, block_bytes: u32) -> Result<ForeignGrowReport> {
  #[cfg(target_family = "wasm")]
  {
    const PAGE_BYTES: usize = 1 << 16;
    const FOREIGN: u8 = 0xa5;
    let old = core::arch::wasm32::memory_grow::<0>(pages as usize);
    if old == usize::MAX {
      return Err(Error::from_reason(format!("memory.grow({pages}) failed")));
    }
    let start = old * PAGE_BYTES;
    let len = pages as usize * PAGE_BYTES;
    // SAFETY: `memory.grow` just added these pages, and nothing else knows about them.
    let foreign =
      unsafe { std::slice::from_raw_parts_mut(std::ptr::with_exposed_provenance_mut(start), len) };
    foreign.fill(FOREIGN);
    let block = vec![0x5a_u8; block_bytes as usize];
    let block_start = block.as_ptr() as usize as f64;
    let foreign_intact = foreign.iter().all(|&byte| byte == FOREIGN);
    drop(block);
    Ok(ForeignGrowReport {
      foreign_start: start as f64,
      foreign_end: start as f64 + len as f64,
      block_start,
      block_end: block_start + f64::from(block_bytes),
      foreign_intact,
    })
  }
  #[cfg(not(target_family = "wasm"))]
  {
    let _ = (pages, block_bytes);
    Err(Error::from_reason("foreignGrow needs a wasm memory"))
  }
}
