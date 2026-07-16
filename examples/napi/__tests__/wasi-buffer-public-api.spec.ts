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
