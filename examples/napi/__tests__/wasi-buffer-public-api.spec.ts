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
    const [source, rootSource, threadedSource] = await Promise.all([
      readFile(new URL('../example.wasip1.d.cts', import.meta.url), 'utf8'),
      readFile(new URL('../index.d.cts', import.meta.url), 'utf8'),
      readFile(new URL('../example.wasi.d.cts', import.meta.url), 'utf8'),
    ])
    t.regex(source, /^import type \{ Buffer \} from 'buffer'$/m)
    t.notRegex(rootSource, /^import type \{ Buffer \} from 'buffer'$/m)
    t.notRegex(threadedSource, /^import type \{ Buffer \} from 'buffer'$/m)

    const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
    const directory = await mkdtemp(
      join(packageDirectory, '.strict-buffer-consumer-'),
    )
    const declarationPath = join(directory, 'index.d.cts')
    const consumerPath = join(directory, 'consumer.ts')
    const globalsPath = join(directory, 'globals.d.ts')
    const emptyTypesPath = join(directory, 'types')
    try {
      await mkdir(emptyTypesPath)
      await Promise.all([
        writeFile(declarationPath, source),
        writeFile(
          join(directory, 'node-stream-web.d.ts'),
          'export declare class ReadableStream<R = unknown> {}\n',
        ),
        writeFile(globalsPath, 'declare const global: typeof globalThis\n'),
        writeFile(
          consumerPath,
          `import { Buffer } from 'buffer'
import { appendBuffer, bufferPassThrough } from './index.cjs'

const input = Buffer.from('strict consumer')
const syncResult: Buffer = appendBuffer(input)
const asyncResult: Promise<Buffer> = bufferPassThrough(input)
void syncResult
void asyncResult
`,
        ),
      ])

      const program = typeScript.createProgram([consumerPath, globalsPath], {
        lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
        module: typeScript.ModuleKind.NodeNext,
        moduleResolution: typeScript.ModuleResolutionKind.NodeNext,
        noEmit: true,
        paths: {
          'node:stream/web': [join(directory, 'node-stream-web.d.ts')],
        },
        skipLibCheck: false,
        strict: true,
        target: typeScript.ScriptTarget.ES2022,
        typeRoots: [emptyTypesPath],
        types: [],
      })
      const diagnostics = typeScript
        .getPreEmitDiagnostics(program)
        .map((diagnostic) =>
          typeScript.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        )
      t.deepEqual(diagnostics, [])
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

        const passedThrough = await instance.exports.bufferPassThrough(
          NodeBuffer.from('threadless async input'),
        )
        t.true(NodeBuffer.isBuffer(passedThrough))
        t.is(passedThrough.toString(), 'threadless async input')

        t.false(Object.hasOwn(globalThis, 'Buffer'))
      } finally {
        instance.dispose()
      }
    } finally {
      Object.defineProperty(globalThis, 'Buffer', globalBufferDescriptor)
    }
  },
)
