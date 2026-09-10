import { Buffer as NodeBuffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const require = createRequire(import.meta.url)
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin/tsc')
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

      const typecheck = async (files: string[]) => {
        const tsconfigPath = join(directory, 'tsconfig.json')
        await writeFile(
          tsconfigPath,
          `${JSON.stringify({
            compilerOptions: {
              lib: ['ESNext', 'DOM', 'DOM.Iterable'],
              module: 'NodeNext',
              moduleResolution: 'nodenext',
              noEmit: true,
              paths: {
                buffer: ['./buffer.d.ts'],
              },
              skipLibCheck: false,
              strict: true,
              target: 'ES2022',
              typeRoots: ['./types'],
              types: [],
            },
            files,
          })}\n`,
        )
        const result = spawnSync(
          process.execPath,
          [tsc, '--pretty', 'false', '-p', tsconfigPath],
          { encoding: 'utf8', cwd: directory },
        )
        if (result.status === 0) {
          return
        }
        const output = `${result.stdout}\n${result.stderr}`.trim()
        t.fail(
          `tsc exited status=${result.status} signal=${result.signal}${
            result.error ? ` error=${result.error.message}` : ''
          }${output ? `\n${output}` : ''}`,
        )
      }
      await typecheck(['threadless-consumer.ts', 'globals.d.ts'])
      await typecheck(['workerd-consumer.ts', 'globals.d.ts'])
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
