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

/// One load: blocks of 1..=`max_bytes` bytes, each a `malloc` and a `memory.fill`, every fourth
/// one grown in place or moved by `realloc` and then extended with a `memory.copy`. It keeps
/// [`LIVE_BLOCKS`] alive and frees a random one for each new one.
struct Churn {
  rng: Rng,
  live: Vec<Vec<u8>>,
  max_bytes: u32,
}

impl Churn {
  fn new(seed: u32, max_bytes: u32) -> Self {
    Self {
      rng: Rng::new(seed),
      live: Vec::with_capacity(LIVE_BLOCKS),
      max_bytes,
    }
  }

  /// Round `round`: one new block, and the handoffs due this round. Returns the number of
  /// blocks that did not hold their tag.
  fn step(&mut self, round: u32, handoff: &Handoff) -> u32 {
    let rng = &mut self.rng;
    let mut corrupt = 0;
    let size = 1 + (rng.next() % self.max_bytes.max(1)) as usize;
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
    if self.live.len() == LIVE_BLOCKS {
      let freed = self.live.swap_remove(rng.next() as usize % LIVE_BLOCKS);
      corrupt += u32::from(!intact(&freed));
    }
    self.live.push(block);
    corrupt
  }

  /// Frees the live blocks. Returns the number that did not hold their tag.
  fn finish(self) -> u32 {
    self.live.iter().filter(|block| !intact(block)).count() as u32
  }
}

/// One load of `rounds` rounds (see [`Churn`]). Returns the number of blocks that did not hold
/// their tag.
fn churn(seed: u32, rounds: u32, max_bytes: u32, handoff: &Handoff) -> u32 {
  let mut load = Churn::new(seed, max_bytes);
  let corrupt: u32 = (0..rounds).map(|round| load.step(round, handoff)).sum();
  corrupt + load.finish()
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

/// Largest block of `rawSbrkRace`'s churn steps.
const RAW_SBRK_CHURN_BYTES: u32 = 16 << 10;

/// Starts `threads` OS threads that each call libc's `sbrk` directly `rounds` times, one page at
/// a time, as C code in an addon may, and run a [`Churn`] step (malloc, fill, realloc, free)
/// after each call, so dlmalloc's own `sbrk` calls run at the same time. Each thread fills its
/// pages with its own tag. Joins the threads, then returns the number of regions that overlap
/// an earlier one, plus the regions and churn blocks that did not hold their tag, plus failed
/// `sbrk` calls. napi's `__wrap_sbrk` takes the allocator lock for these calls, so it must be 0.
///
/// One page per call: wasi-libc's own `sbrk` aborts on an increment that is not a whole number
/// of pages, and dlmalloc counts on a page-aligned break, so a C caller only asks for pages.
/// The break moves by `threads * rounds` pages plus the churn's heap: keep that inside the
/// loader memory, so the break never grows the memory.
#[napi]
pub fn raw_sbrk_race(threads: u32, rounds: u32) -> Result<u32> {
  #[cfg(target_family = "wasm")]
  {
    extern "C" {
      /// wasi-libc's `sbrk`. napi-build links with `--wrap=sbrk`, so this reaches napi's
      /// `__wrap_sbrk`.
      fn sbrk(increment: isize) -> *mut std::ffi::c_void;
    }
    const PAGE_BYTES: usize = 1 << 16;
    const SBRK_FAILED: usize = usize::MAX;
    // The threads start one by one, each in a new worker: wait for all of them, so that their
    // `sbrk` calls overlap in time.
    let start_line = Arc::new(std::sync::Barrier::new(threads as usize));
    let workers = (0..threads)
      .map(|index| {
        let start_line = Arc::clone(&start_line);
        thread::Builder::new()
          .name(format!("raw-sbrk-{index}"))
          .spawn(move || {
            // Odd and distinct for up to 128 threads, like the churn tags.
            let tag = (index as u8).wrapping_mul(2) | 1;
            let mut load = Churn::new(index, RAW_SBRK_CHURN_BYTES);
            let mut regions = Vec::with_capacity(rounds as usize);
            let mut bad = 0;
            start_line.wait();
            for round in 0..rounds {
              let start = unsafe { sbrk(PAGE_BYTES as isize) } as usize;
              if start == SBRK_FAILED {
                bad += 1;
              } else {
                // SAFETY: `sbrk` handed this page to this thread alone.
                unsafe {
                  std::ptr::write_bytes(
                    std::ptr::with_exposed_provenance_mut::<u8>(start),
                    tag,
                    PAGE_BYTES,
                  )
                };
                regions.push((start, tag));
              }
              bad += load.step(round, &Handoff::default());
            }
            (regions, bad + load.finish())
          })
      })
      .collect::<std::io::Result<Vec<_>>>()
      .map_err(|error| Error::from_reason(format!("failed to spawn a thread: {error}")))?;
    let mut regions = Vec::new();
    let mut bad = 0;
    for worker in workers {
      let (mut thread_regions, thread_bad) = worker
        .join()
        .map_err(|_| Error::from_reason("a raw-sbrk thread panicked"))?;
      regions.append(&mut thread_regions);
      bad += thread_bad;
    }
    regions.sort_unstable();
    let mut end = 0;
    for &(start, tag) in &regions {
      bad += u32::from(start < end);
      end = end.max(start + PAGE_BYTES);
      // SAFETY: the threads that wrote this page have exited, and `sbrk` never hands it out
      // again.
      let page = unsafe {
        std::slice::from_raw_parts(std::ptr::with_exposed_provenance::<u8>(start), PAGE_BYTES)
      };
      bad += u32::from(page.iter().any(|&byte| byte != tag));
    }
    Ok(bad)
  }
  #[cfg(not(target_family = "wasm"))]
  {
    let _ = (threads, rounds, RAW_SBRK_CHURN_BYTES);
    Err(Error::from_reason("rawSbrkRace needs wasi-libc's sbrk"))
  }
}
