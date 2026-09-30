// Stress for napi's heap sync on wasm32-wasip1-threads (crates/napi/src/wasi_heap_sync.rs).
//
// V8 updates a shared wasm memory's size only on the thread that grew it. Another thread
// checks memory.fill, memory.copy and atomics (and, without V8's wasm trap handler, every load
// and store) against its old size, so touching pages that another thread just grew traps
// there. napi's allocator lock refreshes a thread's size before it reaches the heap. The
// loads in src/lib.rs allocate, fill, copy and free on OS threads and on emnapi's async-work
// pool, and pass blocks between threads and to JavaScript, while the heap grows.
//
// Each run is a child process: a wasm trap kills the process, and after a worker crash its
// exit can hang, so the parent kills a run that takes too long. Nothing is retried: one failure
// is a regression.
//
// Options (all optional):
//   --cases a,b          case ids (see CASES); default: churn
//   --runs N             run each case N times
//   --node-flag F        a node flag for every child (repeatable), for example
//                        --wasm-enforce-bounds-checks or --disable-wasm-trap-handler. Node
//                        rejects these in NODE_OPTIONS, so they go on the command line.
//   --initial-pages P    create the loader's shared memory with P pages instead of the loader's
//                        default (`min` = the module's declared minimum), so the heap has no
//                        pages to spare and grows while the loads run
//   --expect-grows E     `zero` or `some`: the memory.grow calls napi's sbrk made
//   --opted-out          the addon was built with `--cfg napi_wasi_no_heap_sync`: expect no
//                        heap-sync stat export (for checking that the loads catch the bug)
// Unless --opted-out, every run also checks the heap-sync invariant through the module's
// `napi_wasm_heap_sync_stat` export (no block ever ended past the allocating thread's
// refreshed size) and prints the counters.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const CHILD_FLAG = '--run-heap-sync-stress-case'
const CASE_TIMEOUT_MS = Number(
  process.env.NAPI_RS_HEAP_SYNC_STRESS_TIMEOUT_MS ?? 30_000,
)
const MIB = 1 << 20
const PAGE_BYTES = 1 << 16

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const CASES = {
  // 4 OS threads handing blocks around a ring and to JavaScript, plus 8 loads on emnapi's
  // async-work pool (4 threads), all at once.
  churn: runChurn,
  // A foreign grower takes 256 pages, then libc allocates 256 MiB: more than the default
  // loader memory has left, so napi's sbrk must grow past the foreign pages, not over them.
  foreign: runForeign,
  // 4 OS threads call libc's sbrk directly, with a malloc / free load between the calls:
  // napi's sbrk must take the allocator lock for them, so no two regions overlap and dlmalloc
  // never hands one out. They fit in the loader's default memory, so nothing grows there.
  'raw-sbrk': runRawSbrk,
}

const childIndex = process.argv.indexOf(CHILD_FLAG)
if (childIndex >= 0) {
  await runCase(process.argv[childIndex + 1])
} else {
  await runAll(parseOptions())
}

function parseOptions() {
  const { values } = parseArgs({
    options: {
      cases: { type: 'string', default: 'churn' },
      runs: { type: 'string', default: '1' },
      'node-flag': { type: 'string', multiple: true, default: [] },
      'initial-pages': { type: 'string' },
      'expect-grows': { type: 'string' },
      'opted-out': { type: 'boolean', default: false },
    },
  })
  const cases = values.cases.split(',')
  for (const id of cases) assert.ok(CASES[id], `unknown case ${id}`)
  const runs = Number(values.runs)
  assert.ok(Number.isInteger(runs) && runs > 0, '--runs must be at least 1')
  const initialPages = values['initial-pages']
  assert.ok(
    initialPages === undefined ||
      initialPages === 'min' ||
      /^\d+$/.test(initialPages),
    '--initial-pages must be a page count or "min"',
  )
  const expectGrows = values['expect-grows']
  assert.ok(
    expectGrows === undefined ||
      expectGrows === 'zero' ||
      expectGrows === 'some',
    '--expect-grows must be "zero" or "some"',
  )
  assert.ok(
    !(values['opted-out'] && expectGrows),
    '--expect-grows reads the heap-sync counters, which --opted-out has none of',
  )
  return {
    cases,
    runs,
    nodeFlags: values['node-flag'],
    initialPages,
    expectGrows,
    optedOut: values['opted-out'],
  }
}

async function runAll({
  cases,
  runs,
  nodeFlags,
  initialPages,
  expectGrows,
  optedOut,
}) {
  const setup = [
    nodeFlags.length > 0 && `node flags: ${nodeFlags.join(' ')}`,
    initialPages && `initial pages: ${initialPages}`,
    expectGrows && `expect grows: ${expectGrows}`,
    optedOut && 'opted out of the heap sync',
  ].filter(Boolean)
  if (setup.length > 0) console.log(setup.join(', '))
  const childEnv = {
    NAPI_RS_HEAP_SYNC_STRESS_INITIAL_PAGES: initialPages,
    NAPI_RS_HEAP_SYNC_STRESS_EXPECT_GROWS: expectGrows,
    NAPI_RS_HEAP_SYNC_STRESS_OPTED_OUT: optedOut ? '1' : undefined,
  }
  const failures = []
  const started = Date.now()
  for (const id of cases) {
    let passed = 0
    for (let run = 1; run <= runs; run++) {
      const label = `${id}${runs > 1 ? ` #${run}` : ''}`
      const result = await spawnCase(id, childEnv, nodeFlags)
      const ok =
        result.code === 0 &&
        !result.timedOut &&
        result.output.includes(`STRESS_OK ${id}`)
      const counters = result.output.match(/^HEAP_SYNC .*$/m)?.[0] ?? ''
      console.log(
        `${ok ? 'PASS' : 'FAIL'} ${label} (${result.ms} ms) ${counters}`,
      )
      if (ok) {
        passed++
      } else {
        failures.push(label)
        const reason = result.timedOut
          ? `timed out after ${CASE_TIMEOUT_MS} ms`
          : `exited with ${result.signal ? `signal ${result.signal}` : `code ${result.code}`}`
        console.log(`--- ${label}: ${reason}\n${result.output.trim()}\n---`)
      }
    }
    if (runs > 1) console.log(`${id}: ${passed}/${runs} passed`)
  }
  console.log(`heap-sync stress finished in ${Date.now() - started} ms`)
  if (failures.length > 0) {
    throw new Error(`heap-sync stress failed: ${failures.join(', ')}`)
  }
}

function spawnCase(id, caseEnv, nodeFlags) {
  const env = { ...process.env }
  for (const [key, value] of Object.entries(caseEnv)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  const started = Date.now()
  const child = spawn(
    process.execPath,
    [...nodeFlags, fileURLToPath(import.meta.url), CHILD_FLAG, id],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
  }, CASE_TIMEOUT_MS)
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, timedOut, output, ms: Date.now() - started })
    })
  })
}

// The wasm file the loader picks: it prefers the `.debug.wasm` next to it.
function wasmPath() {
  const debug = join(packageDirectory, 'wasi_heap_sync.wasm32-wasi.debug.wasm')
  return existsSync(debug)
    ? debug
    : join(packageDirectory, 'wasi_heap_sync.wasm32-wasi.wasm')
}

// The declared minimum of the module's imported memory, in pages.
function memoryImportMinimum(bytes) {
  let offset = 8
  const u32 = () => {
    let result = 0
    let shift = 0
    for (;;) {
      const byte = bytes[offset++]
      result += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) return result
      shift += 7
    }
  }
  const skipName = () => {
    const length = u32()
    offset += length
  }
  while (offset < bytes.length) {
    const id = bytes[offset++]
    const size = u32()
    const end = offset + size
    if (id === 2) {
      for (let count = u32(); count > 0; count--) {
        skipName()
        skipName()
        const kind = bytes[offset++]
        if (kind === 2) {
          offset++
          return u32()
        }
        if (kind === 0) u32()
        else if (kind === 1) {
          offset++
          const flags = bytes[offset++]
          u32()
          if (flags & 1) u32()
        } else if (kind === 3) offset += 2
        else if (kind === 4) {
          offset++
          u32()
        } else throw new Error(`unexpected import kind ${kind}`)
      }
    }
    offset = end
  }
  throw new Error('the module imports no memory')
}

// Test-only hooks, installed before the loader runs: capture the main thread's instance (for
// the heap-sync counters) and, when asked, give the loader's shared memory a smaller initial
// size. Workers instantiate in their own realms, so neither hook reaches them.
function installProbe() {
  const probe = { exports: undefined, memory: undefined }
  const OriginalInstance = WebAssembly.Instance
  function Instance(module, imports) {
    const instance = new OriginalInstance(module, imports)
    if (!probe.exports && typeof instance.exports.malloc === 'function') {
      probe.exports = instance.exports
    }
    return instance
  }
  Instance.prototype = OriginalInstance.prototype
  WebAssembly.Instance = Instance

  const requested = process.env.NAPI_RS_HEAP_SYNC_STRESS_INITIAL_PAGES
  const initialPages =
    requested === 'min'
      ? memoryImportMinimum(readFileSync(wasmPath()))
      : requested && Number(requested)
  const OriginalMemory = WebAssembly.Memory
  function Memory(descriptor) {
    const shared = descriptor?.shared === true
    const memory = new OriginalMemory(
      shared && initialPages
        ? { ...descriptor, initial: initialPages }
        : descriptor,
    )
    if (shared) probe.memory ??= memory
    return memory
  }
  Memory.prototype = OriginalMemory.prototype
  WebAssembly.Memory = Memory
  if (initialPages) console.log(`loader initial memory: ${initialPages} pages`)
  return probe
}

function heapSyncCounters(probe) {
  const stat = probe.exports.napi_wasm_heap_sync_stat
  return {
    grows: stat(0),
    lockRefreshes: stat(1),
    lateRefreshes: stat(2),
    breakPages: stat(3),
    heapEndPages: stat(4),
    handoffRefreshes: stat(5),
    memoryPages: probe.memory.buffer.byteLength / PAGE_BYTES,
  }
}

async function runCase(id) {
  // A trap or a lost worker must end this process now: after a worker crash the exit path can
  // block, so print the error and kill ourselves.
  const die = (error) => {
    console.error(error?.stack ?? error)
    process.kill(process.pid, 'SIGKILL')
  }
  process.on('uncaughtException', die)
  process.on('unhandledRejection', die)

  const probe = installProbe()
  const binding = require('./wasi_heap_sync.wasi.cjs')
  assert.ok(probe.exports, 'captured the main-thread instance')
  assert.ok(probe.memory, 'captured the shared memory')
  const optedOut = process.env.NAPI_RS_HEAP_SYNC_STRESS_OPTED_OUT === '1'
  assert.equal(
    typeof probe.exports.napi_wasm_heap_sync_stat,
    optedOut ? 'undefined' : 'function',
    optedOut
      ? 'the addon was not built with --cfg napi_wasi_no_heap_sync'
      : 'the threaded wasm exports napi_wasm_heap_sync_stat',
  )

  await CASES[id](binding)

  if (!optedOut) {
    const counters = heapSyncCounters(probe)
    console.log(
      `HEAP_SYNC ${Object.entries(counters)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')}`,
    )
    assert.equal(
      counters.lateRefreshes,
      0,
      "a block ended past its thread's refreshed size",
    )
    const expectGrows = process.env.NAPI_RS_HEAP_SYNC_STRESS_EXPECT_GROWS
    if (expectGrows === 'zero') {
      assert.equal(counters.grows, 0, 'expected no memory.grow')
    }
    if (expectGrows === 'some') {
      assert.ok(counters.grows > 0, 'expected the heap to grow')
    }
  }
  console.log(`STRESS_OK ${id}`)
}

async function runChurn(binding) {
  const threads = 4
  const rounds = 2000
  const maxBytes = 128 << 10
  const asyncLoads = 8
  const expectedBlocks = threads * Math.ceil(rounds / binding.JS_HANDOFF_EVERY)

  let blocks = 0
  let threadsDone = 0
  let threadCorrupt = 0
  const { promise: handoffDone, resolve: finishHandoff } =
    Promise.withResolvers()
  const { promise: allThreadsDone, resolve: finishThreads } =
    Promise.withResolvers()
  binding.churnThreads(
    threads,
    rounds,
    maxBytes,
    (block) => {
      const tag = block[0]
      assert.ok(
        tag & 1 && block.every((byte) => byte === tag),
        'a block reached JavaScript corrupt',
      )
      const sum = tag * block.length
      // wasm reads the block on this thread, then a JavaScript-owned copy, which emnapi has to
      // allocate in wasm memory through the module's `malloc` export.
      assert.equal(binding.blockChecksum(block), sum)
      assert.equal(binding.blockChecksum(Buffer.from(block)), sum)
      if (++blocks === expectedBlocks) finishHandoff()
    },
    (corrupt) => {
      threadCorrupt += corrupt
      if (++threadsDone === threads) finishThreads()
    },
  )
  const asyncCorrupt = await Promise.all(
    Array.from({ length: asyncLoads }, (_, index) =>
      binding.churnAsync(threads + index, rounds, maxBytes),
    ),
  )
  await Promise.all([allThreadsDone, handoffDone])
  assert.equal(threadCorrupt, 0, 'an OS-thread load saw a corrupt block')
  assert.deepEqual(
    asyncCorrupt,
    Array(asyncLoads).fill(0),
    'an async-work load saw a corrupt block',
  )
  assert.equal(blocks, expectedBlocks)
}

async function runForeign(binding) {
  const report = binding.foreignGrow(256, 256 * MIB)
  const hex = (value) => `0x${value.toString(16)}`
  console.log(
    `foreign [${hex(report.foreignStart)}, ${hex(report.foreignEnd)}) block [${hex(report.blockStart)}, ${hex(report.blockEnd)})`,
  )
  assert.ok(
    report.blockEnd <= report.foreignStart ||
      report.blockStart >= report.foreignEnd,
    'libc handed out pages that a foreign grower owns',
  )
  assert.ok(report.foreignIntact, "the foreign grower's pages were overwritten")
}

async function runRawSbrk(binding) {
  // 4 * 512 pages (128 MiB) of break: well inside the loader's default memory.
  const bad = binding.rawSbrkRace(4, 512)
  console.log(`raw sbrk: ${bad} overlapping, overwritten or failed`)
  assert.equal(
    bad,
    0,
    'direct sbrk calls raced with each other or with dlmalloc',
  )
}
