import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageDirectory = join(__dirname, '..')

/**
 * On `wasm32-wasip1-threads`, napi wraps wasi-libc's allocator with a lock that
 * keeps every thread's view of the shared memory size current
 * (`crates/napi/src/wasi_heap_sync.rs`), and `napi_build::setup()` links with
 * `--wrap` for it. `@emnapi/core` allocates through the module's `malloc` /
 * `free` exports, so those must reach the locked wrappers. A wrong export is
 * silent: the module loads and runs, only without the lock.
 *
 * So check the call target, not the name: the body of the `malloc` export must
 * call the function exported as `__wrap_malloc`, and the same for `free`. The
 * Node loader prefers the `.debug.wasm` artifact, so both are checked.
 */
const THREADED_ARTIFACTS = [
  'example.wasm32-wasip1-threads.wasm',
  'example.wasm32-wasip1-threads.debug.wasm',
]
const THREADLESS_ARTIFACTS = ['example.wasm32-wasip1.wasm']

const HEAP_SYNC_EXPORTS = [
  '__wrap_malloc',
  '__wrap_free',
  '__wrap_sbrk',
  'napi_wasm_heap_sync_stat',
]

/**
 * Lanes that build a WASI artifact before running this suite. When one of them
 * is set, a missing artifact is a failure rather than a reason to skip.
 */
const requiresThreadedArtifact =
  Boolean(process.env.WASI_TEST) &&
  process.env.NAPI_RS_WASI_FLAVOR !== 'wasm32-wasip1'
const requiresThreadlessArtifact = Boolean(
  process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER,
)

const EXTERNAL_KIND_FUNCTION = 0
const OPCODE_LOCAL_GET = 0x20
const OPCODE_CALL = 0x10
const OPCODE_RETURN_CALL = 0x12

interface WasmModule {
  importedFunctionCount: number
  importNames: string[]
  functionExports: Map<string, number>
  codeBodies: Uint8Array[]
}

class Reader {
  offset = 0
  constructor(readonly bytes: Uint8Array) {}

  u32(): number {
    let result = 0
    let shift = 0
    for (;;) {
      const byte = this.bytes[this.offset++]
      result += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) return result
      shift += 7
    }
  }

  name(): string {
    const length = this.u32()
    const value = Buffer.from(
      this.bytes.subarray(this.offset, this.offset + length),
    ).toString('utf8')
    this.offset += length
    return value
  }

  limits() {
    const flags = this.bytes[this.offset++]
    this.u32()
    if (flags & 0x01) this.u32()
  }
}

/** The sections this check needs: imports, function exports and code bodies. */
function parseWasm(bytes: Uint8Array): WasmModule {
  const module: WasmModule = {
    importedFunctionCount: 0,
    importNames: [],
    functionExports: new Map(),
    codeBodies: [],
  }
  const reader = new Reader(bytes)
  reader.offset = 8
  while (reader.offset < bytes.length) {
    const id = bytes[reader.offset++]
    const size = reader.u32()
    const end = reader.offset + size
    if (id === 2) {
      for (let count = reader.u32(); count > 0; count--) {
        reader.name()
        module.importNames.push(reader.name())
        const kind = bytes[reader.offset++]
        if (kind === EXTERNAL_KIND_FUNCTION) {
          module.importedFunctionCount++
          reader.u32()
        } else if (kind === 1) {
          reader.offset++
          reader.limits()
        } else if (kind === 2) {
          reader.limits()
        } else if (kind === 3) {
          reader.offset += 2
        } else if (kind === 4) {
          reader.offset++
          reader.u32()
        } else {
          throw new Error(`unexpected import kind ${kind}`)
        }
      }
    } else if (id === 7) {
      for (let count = reader.u32(); count > 0; count--) {
        const name = reader.name()
        const kind = bytes[reader.offset++]
        const index = reader.u32()
        if (kind === EXTERNAL_KIND_FUNCTION) {
          module.functionExports.set(name, index)
        }
      }
    } else if (id === 10) {
      for (let count = reader.u32(); count > 0; count--) {
        const bodySize = reader.u32()
        module.codeBodies.push(
          bytes.subarray(reader.offset, reader.offset + bodySize),
        )
        reader.offset += bodySize
      }
    }
    reader.offset = end
  }
  return module
}

/**
 * The function a one-argument forwarder calls: `local.get 0; call X; end` or
 * `local.get 0; return_call X; end`, with no locals. `undefined` for any other
 * body.
 */
function forwardTarget(module: WasmModule, functionIndex: number) {
  const body = module.codeBodies[functionIndex - module.importedFunctionCount]
  if (!body) return undefined
  const reader = new Reader(body)
  if (reader.u32() !== 0) return undefined
  if (body[reader.offset++] !== OPCODE_LOCAL_GET || reader.u32() !== 0) {
    return undefined
  }
  const opcode = body[reader.offset++]
  if (opcode !== OPCODE_CALL && opcode !== OPCODE_RETURN_CALL) return undefined
  const target = reader.u32()
  return body[reader.offset] === 0x0b ? target : undefined
}

const builtThreaded = THREADED_ARTIFACTS.filter((name) =>
  existsSync(join(packageDirectory, name)),
)
const builtThreadless = THREADLESS_ARTIFACTS.filter((name) =>
  existsSync(join(packageDirectory, name)),
)

test('a WASI lane must have built the artifacts it checks', (t) => {
  if (requiresThreadedArtifact) {
    t.deepEqual(builtThreaded, THREADED_ARTIFACTS, packageDirectory)
  }
  if (requiresThreadlessArtifact) {
    t.deepEqual(builtThreadless, THREADLESS_ARTIFACTS, packageDirectory)
  }
  t.pass()
})

for (const name of THREADED_ARTIFACTS) {
  test.skipIf(!builtThreaded.includes(name))(
    `${name} sends malloc / free through the heap-sync lock`,
    async (t) => {
      const module = parseWasm(await readFile(join(packageDirectory, name)))
      t.true(
        module.functionExports.has('napi_register_wasm_v1'),
        'the artifact is not a napi-rs wasm addon',
      )
      for (const exported of HEAP_SYNC_EXPORTS) {
        t.true(
          module.functionExports.has(exported),
          `missing function export ${exported}: napi's heap-sync allocator is not linked`,
        )
      }
      for (const entry of ['malloc', 'free']) {
        const exported = module.functionExports.get(entry)
        const wrapper = module.functionExports.get(`__wrap_${entry}`)
        t.not(exported, undefined, `missing function export ${entry}`)
        t.is(
          forwardTarget(module, exported!),
          wrapper,
          `the ${entry} export must call __wrap_${entry} (function ${wrapper}); @emnapi/core would allocate without the lock`,
        )
      }
      const wrapImports = module.importNames.filter(
        (importName) =>
          importName.startsWith('__real_') ||
          importName.startsWith('__wrap_') ||
          importName === 'sbrk',
      )
      t.deepEqual(
        wrapImports,
        [],
        "an allocator wrapper or real entry is imported: the --wrap link arguments and napi's wrappers do not match",
      )
    },
  )
}

for (const name of THREADLESS_ARTIFACTS) {
  test.skipIf(!builtThreadless.includes(name))(
    `${name} keeps the plain allocator`,
    async (t) => {
      const module = parseWasm(await readFile(join(packageDirectory, name)))
      t.true(module.functionExports.has('malloc'))
      t.true(module.functionExports.has('free'))
      t.deepEqual(
        [...module.functionExports.keys()].filter(
          (exported) =>
            exported.startsWith('__wrap_') ||
            exported.startsWith('napi_wasm_heap_sync_'),
        ),
        [],
        'the heap-sync allocator is for wasm32-wasip1-threads only',
      )
    },
  )
}
