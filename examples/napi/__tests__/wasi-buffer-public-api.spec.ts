import { Buffer as NodeBuffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'
import typeScript from 'typescript'

const require = createRequire(import.meta.url)
const isThreadlessWasiBufferTest = Boolean(
  process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)

// NOTE: the graceful rejection of built-in Tokio async exports on threadless
// WASI ("Built-in Tokio async tasks require a threaded WASI target...") lives
// in crates/napi and is not part of the minimal async-runtime SPI base yet;
// synchronous exports still work, which is what the remaining tests cover.

test.skipIf(!isThreadlessWasiBufferTest)(
  'threadless WASI loaders avoid shared memory and workers',
  async (t) => {
    const files = [
      'example.wasip1.cjs',
      'example.wasip1-browser.js',
      'example.wasip1-deferred.js',
    ]
    const sources = await Promise.all(
      files.map((file) =>
        readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
      ),
    )

    for (const [index, source] of sources.entries()) {
      const file = files[index]
      t.notRegex(source, /shared:\s*true/, file)
      t.notRegex(source, /\bnew\s+Worker\b/, file)
    }

    const binding = require('../example.wasip1.cjs')
    t.is(binding.add(1, 2), 3)
  },
)

test.skipIf(!isThreadlessWasiBufferTest)(
  'threadless Buffer declarations compile without ambient Node types',
  async (t) => {
    const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
    const directory = await mkdtemp(
      join(packageDirectory, '.strict-buffer-consumer-'),
    )
    const threadlessConsumerPath = join(directory, 'threadless-consumer.ts')
    const workerdConsumerPath = join(directory, 'workerd-consumer.ts')
    const globalsPath = join(directory, 'globals.d.ts')
    const emptyTypesPath = join(directory, 'types')
    try {
      await mkdir(emptyTypesPath)
      const consumer = `import {
  appendBuffer,
  bufferDestructureBinding,
  bufferGenericConstraint,
  bufferGenericShadow,
  bufferPassThrough,
  bufferValueBinding,
} from '../example.wasip1.cjs'
import type { BufferHeritageOverride } from '../example.wasip1.cjs'

type ExpectedBuffer = import("buffer").Buffer
declare const input: ExpectedBuffer
declare const heritage: BufferHeritageOverride
const syncResult: ExpectedBuffer = appendBuffer(input)
const heritageResult: ExpectedBuffer = heritage
const constrained: ExpectedBuffer = bufferGenericConstraint(input)
const shadowed: ExpectedBuffer = bufferGenericShadow(input)
const destructured: ExpectedBuffer = bufferDestructureBinding(
  { Buffer: 'binding' },
  input,
)
const valueBound: unknown = bufferValueBinding(input)
const asyncResult: Promise<ExpectedBuffer> = bufferPassThrough(input)
void syncResult
void heritageResult
void constrained
void shadowed
void destructured
void valueBound
void asyncResult
`
      await Promise.all([
        writeFile(
          join(directory, 'buffer.d.ts'),
          `export interface Buffer extends Uint8Array {
  toString(): string
}
export declare const Buffer: {
  from(value: string): Buffer
}
`,
        ),
        writeFile(globalsPath, 'declare const global: typeof globalThis\n'),
        writeFile(threadlessConsumerPath, consumer),
        writeFile(
          workerdConsumerPath,
          `import {
  createInstance,
  instantiate,
} from '../example.wasip1-deferred.js'

type ExpectedBuffer = import("buffer").Buffer
declare const wasmModule: WebAssembly.Module
const binding = await instantiate(wasmModule)
const rootValue: ExpectedBuffer = binding.getBuffer()
const instance = await createInstance(wasmModule)
const instanceValue: ExpectedBuffer = instance.exports.getBuffer()
instance.dispose()
void rootValue
void instanceValue
`,
        ),
      ])

      const compilerOptions: typeScript.CompilerOptions = {
        baseUrl: directory,
        ignoreDeprecations: '6.0',
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
        module: typeScript.ModuleKind.NodeNext,
        moduleResolution: typeScript.ModuleResolutionKind.NodeNext,
        noEmit: true,
        paths: {
          buffer: ['./buffer.d.ts'],
        },
        skipLibCheck: false,
        strict: true,
        target: typeScript.ScriptTarget.ES2022,
        typeRoots: [emptyTypesPath],
        types: [],
      }
      const diagnostics = (roots: string[]) =>
        typeScript
          .getPreEmitDiagnostics(
            typeScript.createProgram(roots, compilerOptions),
          )
          .map((diagnostic) =>
            typeScript.flattenDiagnosticMessageText(
              diagnostic.messageText,
              '\n',
            ),
          )
      t.deepEqual(diagnostics([threadlessConsumerPath, globalsPath]), [])
      t.deepEqual(diagnostics([workerdConsumerPath, globalsPath]), [])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test.skipIf(!isThreadlessWasiBufferTest)(
  'deferred WASI loader exposes Buffer values without installing a global',
  async (t) => {
    const globalBufferDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'Buffer',
    )
    if (!globalBufferDescriptor) {
      t.fail('Expected Node.js to provide a global Buffer before the test')
      return
    }

    const wasmBytes = await readFile(
      new URL('../example.wasm32-wasip1.wasm', import.meta.url),
    )
    const webAssembly = Reflect.get(globalThis, 'WebAssembly') as {
      compile(bytes: Uint8Array): Promise<WebAssembly.Module>
    }
    const wasmModule = await webAssembly.compile(wasmBytes)

    try {
      t.true(Reflect.deleteProperty(globalThis, 'Buffer'))
      const deferred = await import(
        new URL('../example.wasip1-deferred.js', import.meta.url).href
      )
      const instance = await deferred.createInstance(wasmModule)

      try {
        const value = instance.exports.getBuffer()
        t.true(NodeBuffer.isBuffer(value))
        t.is(value.toString(), 'Hello world')

        const appended = instance.exports.appendBuffer(
          NodeBuffer.from('threadless sync input'),
        )
        t.true(NodeBuffer.isBuffer(appended))
        t.is(appended.toString(), 'threadless sync input!')

        t.false(Object.hasOwn(globalThis, 'Buffer'))
      } finally {
        instance.dispose()
      }
    } finally {
      Object.defineProperty(globalThis, 'Buffer', globalBufferDescriptor)
    }
  },
)

test.skipIf(!isThreadlessWasiBufferTest)(
  'threadless Buffer values survive wasm memory growth',
  async (t) => {
    const wasmBytes = await readFile(
      new URL('../example.wasm32-wasip1.wasm', import.meta.url),
    )
    const webAssembly = Reflect.get(globalThis, 'WebAssembly') as {
      compile(bytes: Uint8Array): Promise<WebAssembly.Module>
    }
    const wasmModule = await webAssembly.compile(wasmBytes)
    const deferred = await import(
      new URL('../example.wasip1-deferred.js', import.meta.url).href
    )
    const instance = await deferred.createInstance(wasmModule)

    try {
      const { exports } = instance
      const memoryBefore = exports.wasmMemorySizeBytes()
      // Threadless wasm memory is not shared: every `memory.grow` detaches the
      // previous ArrayBuffer. A Buffer that was a view over it would read back
      // as '' after the grow, so it must be a JS-owned copy.
      const held = exports.getBuffer()
      const appended = exports.appendBuffer(NodeBuffer.from('held'))
      // 512 * 1024 * 4 bytes: far more than the initial dlmalloc arena.
      const growth = new exports.CustomFinalize(512, 1024)
      const memoryAfter = exports.wasmMemorySizeBytes()

      t.true(
        memoryAfter > memoryBefore,
        `expected memory growth beyond ${memoryBefore}, got ${memoryAfter}`,
      )
      t.is(growth.constructor.name, 'CustomFinalize')
      t.true(NodeBuffer.isBuffer(held))
      t.is(held.length, 'Hello world'.length)
      t.is(held.toString(), 'Hello world')
      t.is(appended.length, 'held!'.length)
      t.is(appended.toString(), 'held!')
    } finally {
      instance.dispose()
    }
  },
)

// Regression: `BufferSlice`'s three constructors used to point `inner` at the
// `napi_value` out-param rather than the buffer data - on wasm an emnapi handle
// id, i.e. a single-digit linear-memory address. This lane is where all three
// take the `napi_create_buffer_copy` fallback: threadless wasm memory is not
// shared, so `create_external_buffer` reports
// `napi_no_external_buffers_allowed`. On wasm32-wasip1-threads the memory is
// shared and `from_data` / `from_external` stay zero-copy; only `copy_from`,
// which calls `napi_create_buffer_copy` unconditionally, copies there too.
//
// Only the read direction is asserted here. emnapi allocates the copy as a
// JS-owned `ArrayBuffer` and exposes it to wasm through a one-way JS-to-wasm
// mirror that every `napi_get_buffer_info` refreshes, so a `DerefMut` write
// into a copy is dropped - the long-standing "modifications may be lost"
// caveat, and a property of any `BufferSlice` backed by one, including a slice
// received as a function argument on either wasm lane. values.spec.ts covers
// the write direction wherever the buffer really is zero-copy.
test.skipIf(!isThreadlessWasiBufferTest)(
  'threadless BufferSlice constructors read back the copied buffer data',
  async (t) => {
    const wasmBytes = await readFile(
      new URL('../example.wasm32-wasip1.wasm', import.meta.url),
    )
    const webAssembly = Reflect.get(globalThis, 'WebAssembly') as {
      compile(bytes: Uint8Array): Promise<WebAssembly.Module>
    }
    const wasmModule = await webAssembly.compile(wasmBytes)
    const deferred = await import(
      new URL('../example.wasip1-deferred.js', import.meta.url).href
    )
    const instance = await deferred.createInstance(wasmModule)

    try {
      const { exports } = instance
      for (const [name, readBack] of [
        ['from_data', exports.bufferSliceFromDataReadBack],
        ['from_external', exports.bufferSliceFromExternalReadBack],
        ['copy_from', exports.bufferSliceCopyFromReadBack],
      ] as const) {
        t.is(readBack(), 'Hello world', name)
      }
    } finally {
      instance.dispose()
    }
  },
)

// Regression: on wasm, `BufferSlice::copy_from` (and `from_data` / `from_external`
// on the threadless copy fallback) used to call `napi_get_buffer_info` eagerly.
// Under emnapi that allocates a linear-memory mirror via `_malloc`, copies the
// bytes back from JS to wasm, and relies on `FinalizationRegistry` to `_free` it.
// In a host that retains the returned `Buffer`s or never runs GC finalizers,
// linear memory grew unboundedly even though Rust never dereferenced the slice.
test.skipIf(!isThreadlessWasiBufferTest)(
  'threadless BufferSlice constructors do not allocate wasm mirror memory when unused in Rust',
  async (t) => {
    const wasmBytes = await readFile(
      new URL('../example.wasm32-wasip1.wasm', import.meta.url),
    )
    const webAssembly = Reflect.get(globalThis, 'WebAssembly') as {
      compile(bytes: Uint8Array): Promise<WebAssembly.Module>
    }
    const wasmModule = await webAssembly.compile(wasmBytes)
    const deferred = await import(
      new URL('../example.wasip1-deferred.js', import.meta.url).href
    )
    const instance = await deferred.createInstance(wasmModule)

    try {
      const { exports } = instance
      const chunkSize = 256 * 1024
      // Warm up dlmalloc's arena for the temporary Rust `Vec` per kind.
      for (const kind of ['copy_from', 'from_data', 'from_external'] as const) {
        const warmup = exports.createBufferSliceOfSize(kind, chunkSize)
        t.true(NodeBuffer.isBuffer(warmup), kind)
        t.is(warmup.length, chunkSize, kind)
        t.is(warmup[0], 0x5a, kind)
        t.is(warmup[chunkSize - 1], 0x5a, kind)
      }
      // Empty slice path stays safe without touching `napi_get_buffer_info`.
      for (const kind of ['copy_from', 'from_data'] as const) {
        const empty = exports.createBufferSliceOfSize(kind, 0)
        t.true(NodeBuffer.isBuffer(empty), `${kind} empty`)
        t.is(empty.length, 0, `${kind} empty`)
      }

      const memoryBefore = exports.wasmMemorySizeBytes()
      // Hold 48 MiB of returned Buffers strongly in JS so FinalizationRegistry
      // cannot run. With a lazy wasm pointer, linear memory does not grow.
      const held: Uint8Array[] = []
      for (const kind of ['copy_from', 'from_data', 'from_external'] as const) {
        for (let i = 0; i < 64; i++) {
          const buf = exports.createBufferSliceOfSize(kind, chunkSize)
          t.is(buf[0], 0x5a)
          t.is(buf[chunkSize - 1], 0x5a)
          held.push(buf)
        }
      }
      const memoryAfter = exports.wasmMemorySizeBytes()
      t.is(
        memoryAfter,
        memoryBefore,
        `expected zero wasm memory growth across 48 MiB of retained BufferSlice results (before=${memoryBefore}, after=${memoryAfter})`,
      )
      t.is(held.length, 192)
    } finally {
      instance.dispose()
    }
  },
)

// Regression: on wasm, `ArrayBuffer::copy_from`, `*ArraySlice::copy_from`, and
// `Uint8ClampedSlice::copy_from` used to call `napi_create_arraybuffer` +
// `emnapi_sync_memory`, which allocated a linear-memory mirror via `_malloc`
// and relied on `FinalizationRegistry` to `_free` it. Using
// `emnapi_create_arraybuffer_copy` with a lazy wasm data pointer keeps linear
// memory flat when Rust never dereferences the copy, while still resolving
// lazily when Rust reads it back.
test.skipIf(!isThreadlessWasiBufferTest)(
  'threadless ArrayBuffer and TypedArray slice copy_from do not allocate wasm mirror memory when unused in Rust',
  async (t) => {
    const wasmBytes = await readFile(
      new URL('../example.wasm32-wasip1.wasm', import.meta.url),
    )
    const webAssembly = Reflect.get(globalThis, 'WebAssembly') as {
      compile(bytes: Uint8Array): Promise<WebAssembly.Module>
    }
    const wasmModule = await webAssembly.compile(wasmBytes)
    const deferred = await import(
      new URL('../example.wasip1-deferred.js', import.meta.url).href
    )
    const instance = await deferred.createInstance(wasmModule)

    try {
      const { exports } = instance
      const chunkBytes = 256 * 1024
      const chunkU16 = chunkBytes / 2

      // Warm up dlmalloc's arena for the temporary Rust `Vec` per type and check content.
      const warmAb = exports.createArraybufferOfSize(chunkBytes)
      t.true(warmAb instanceof ArrayBuffer)
      t.is(warmAb.byteLength, chunkBytes)
      const warmAbView = new Uint8Array(warmAb)
      t.is(warmAbView[0], 0x5a)
      t.is(warmAbView[chunkBytes - 1], 0x5a)

      const warmU8 = exports.createUint8ArraySliceOfSize(chunkBytes)
      t.true(warmU8 instanceof Uint8Array)
      t.is(warmU8.length, chunkBytes)
      t.is(warmU8[0], 0x5a)
      t.is(warmU8[chunkBytes - 1], 0x5a)

      const warmU16 = exports.createUint16ArraySliceOfSize(chunkU16)
      t.true(warmU16 instanceof Uint16Array)
      t.is(warmU16.length, chunkU16)
      t.is(warmU16[0], 0x5a5a)
      t.is(warmU16[chunkU16 - 1], 0x5a5a)

      const warmClamped = exports.createUint8ClampedSliceOfSize(chunkBytes)
      t.true(warmClamped instanceof Uint8ClampedArray)
      t.is(warmClamped.length, chunkBytes)
      t.is(warmClamped[0], 0x5a)
      t.is(warmClamped[chunkBytes - 1], 0x5a)

      // 0-byte copy_from paths stay safe without touching napi_get_*_info.
      t.is(exports.createArraybufferOfSize(0).byteLength, 0)
      t.is(exports.createUint8ArraySliceOfSize(0).length, 0)
      t.is(exports.createUint16ArraySliceOfSize(0).length, 0)
      t.is(exports.createUint8ClampedSliceOfSize(0).length, 0)

      // Lazy deref read-back resolves correctly for non-empty and empty inputs.
      t.deepEqual(
        exports.arrayBufferCopyFromReadBack([1, 2, 3, 4]),
        [1, 2, 3, 4],
      )
      t.deepEqual(exports.arrayBufferCopyFromReadBack([]), [])
      t.deepEqual(
        exports.uint8ArraySliceCopyFromReadBack([10, 20, 30, 40]),
        [10, 20, 30, 40],
      )
      t.deepEqual(exports.uint8ArraySliceCopyFromReadBack([]), [])
      t.deepEqual(
        exports.uint16ArraySliceCopyFromReadBack([0x1234, 0xabcd, 0xffff]),
        [0x1234, 0xabcd, 0xffff],
      )
      t.deepEqual(exports.uint16ArraySliceCopyFromReadBack([]), [])
      t.deepEqual(
        exports.uint8ClampedSliceCopyFromReadBack([0, 128, 255]),
        [0, 128, 255],
      )
      t.deepEqual(exports.uint8ClampedSliceCopyFromReadBack([]), [])

      const memoryBefore = exports.wasmMemorySizeBytes()
      // Hold 48 MiB (4 kinds * 48 * 256 KiB) of returned ArrayBuffers and
      // TypedArrays strongly in JS so FinalizationRegistry cannot run.
      const held: Array<
        ArrayBuffer | Uint8Array | Uint16Array | Uint8ClampedArray
      > = []
      for (let i = 0; i < 48; i++) {
        const ab = exports.createArraybufferOfSize(chunkBytes)
        const abView = new Uint8Array(ab)
        t.is(abView[0], 0x5a)
        t.is(abView[chunkBytes - 1], 0x5a)
        held.push(ab)

        const u8 = exports.createUint8ArraySliceOfSize(chunkBytes)
        t.is(u8[0], 0x5a)
        t.is(u8[chunkBytes - 1], 0x5a)
        held.push(u8)

        const u16 = exports.createUint16ArraySliceOfSize(chunkU16)
        t.is(u16[0], 0x5a5a)
        t.is(u16[chunkU16 - 1], 0x5a5a)
        held.push(u16)

        const clamped = exports.createUint8ClampedSliceOfSize(chunkBytes)
        t.is(clamped[0], 0x5a)
        t.is(clamped[chunkBytes - 1], 0x5a)
        held.push(clamped)
      }
      const memoryAfter = exports.wasmMemorySizeBytes()
      t.is(
        memoryAfter,
        memoryBefore,
        `expected zero wasm memory growth across 48 MiB of retained ArrayBuffer/TypedArray copies (before=${memoryBefore}, after=${memoryAfter})`,
      )
      t.is(held.length, 192)
    } finally {
      instance.dispose()
    }
  },
)
