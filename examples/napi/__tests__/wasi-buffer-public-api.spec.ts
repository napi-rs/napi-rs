import { createRequire } from 'node:module'

import test from 'ava'

const require = createRequire(import.meta.url)
import { Buffer as NodeBuffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'
import typeScript from 'typescript'

const isThreadlessWasiBufferTest = Boolean(
  process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)

test.skipIf(!isThreadlessWasiBufferTest)(
  'threadless WASI rejects built-in Tokio async exports without trapping',
  async (t) => {
    const binding = require('../example.wasip1.cjs')

    t.is(binding.add(1, 2), 3)
    await t.throwsAsync(() => binding.asyncPlus100(Promise.resolve(1)), {
      message:
        'Built-in Tokio async tasks require a threaded WASI target. Use wasm32-wasip1-threads, or enable async-runtime and register a custom AsyncRuntime backend for wasm32-wasip1.',
    })
    t.is(binding.add(2, 3), 5)
  'threadless Buffer declarations compile without ambient Node types',
  async (t) => {
    const [source, rootSource, threadedSource, workerdSource] =
      await Promise.all([
        readFile(new URL('../example.wasip1.d.cts', import.meta.url), 'utf8'),
        readFile(new URL('../index.d.cts', import.meta.url), 'utf8'),
        readFile(new URL('../example.wasi.d.cts', import.meta.url), 'utf8'),
        readFile(
          new URL('../example.wasip1-deferred.d.ts', import.meta.url),
          'utf8',
        ),
      ])
    t.regex(source, /import\("buffer"\)\.Buffer/)
    t.notRegex(source, /node:stream\/web/)
    t.notRegex(workerdSource, /node:stream\/web/)
    t.regex(
      source,
      /appendBuffer\(buf: import\("buffer"\)\.Buffer\): import\("buffer"\)\.Buffer/,
    )
    t.regex(source, /value: import\("buffer"\)\.Buffer/)
    t.regex(
      source,
      /bufferGenericConstraint<T extends import\("buffer"\)\.Buffer>\(value: T\): T/,
    )
    t.regex(source, /bufferGenericShadow<Buffer>\(value: Buffer\): Buffer/)
    t.regex(source, /Buffer\(\): "line\\nnext"/)
    t.regex(source, /\[Buffer in keyof T\]: T\[Buffer\]/)
    t.regex(source, /external: import\("buffer"\)\.Buffer/)
    t.regex(
      source,
      /`template\\n\$\{import\("buffer"\)\.Buffer extends Uint8Array \? "buffer" : "other"\}`/,
    )
    t.regex(
      source,
      /\{ Buffer \}: \{ Buffer: string \}, value: import\("buffer"\)\.Buffer/,
    )
    t.regex(
      source,
      /bufferAssertionTarget\(Buffer: unknown\): asserts Buffer is string/,
    )
    t.regex(source, /bufferValueBinding\(Buffer: unknown\): typeof Buffer/)
    t.true(source.includes('"line\\nnext"'))
    t.notRegex(source, /__NAPI_RS_TYPE_IMPORT_/)
    t.notRegex(rootSource, /import\("buffer"\)\.Buffer/)
    t.notRegex(threadedSource, /import\("buffer"\)\.Buffer/)
    t.regex(rootSource, /appendBuffer\(buf: Buffer\): Buffer/)
    t.regex(rootSource, /value: Buffer/)
    t.regex(
      rootSource,
      /bufferGenericConstraint<T extends Buffer>\(value: T\): T/,
    )
    t.regex(rootSource, /bufferGenericShadow<Buffer>\(value: Buffer\): Buffer/)
    t.regex(rootSource, /bufferValueBinding\(Buffer: unknown\): typeof Buffer/)
    t.true(rootSource.includes('"line\\nnext"'))
    t.true(
      rootSource.includes(
        '`template\\n${Buffer extends Uint8Array ? "buffer" : "other"}`',
      ),
    )

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

type ExpectedBuffer = import("buffer").Buffer
declare const input: ExpectedBuffer
const syncResult: ExpectedBuffer = appendBuffer(input)
const constrained: ExpectedBuffer = bufferGenericConstraint(input)
const shadowed: ExpectedBuffer = bufferGenericShadow(input)
const destructured: ExpectedBuffer = bufferDestructureBinding(
  { Buffer: 'binding' },
  input,
)
const valueBound: unknown = bufferValueBinding(input)
const asyncResult: Promise<ExpectedBuffer> = bufferPassThrough(input)
void syncResult
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
