import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'

import test from 'ava'
import typeScript from 'typescript'
import legacyTypeScript from 'typescript-legacy'

import { generateTypeDef } from '../../api/build.js'
import {
  appendTypeImports,
  correctStringIdent,
  processTypeDef,
  processTypeDefs,
  removeNodeStreamWebTypeImports,
  rewriteTypeImportReferences,
} from '../typegen.js'

test('should ident string correctly', (t) => {
  const input = `
  /**
   * should keep
   * class A {
   * foo = () => {}
   *   bar = () => {}
   * }
   */
  class A {
    foo() {
      a = b
    }

  bar = () => {

  }
      boz = 1
    }

  namespace B {
      namespace C {
  type D = A
      }
  }
`
  t.snapshot(correctStringIdent(input, 0), 'original ident is 0')
  t.snapshot(correctStringIdent(input, 2), 'original ident is 2')
})

test('should process type def correctly', async (t) => {
  const { dts } = await processTypeDef(
    join(
      fileURLToPath(import.meta.url),
      '../',
      '__fixtures__',
      'napi_type_def',
    ),
    true,
  )

  t.snapshot(dts)
})

test('should process type def with noConstEnum correctly', async (t) => {
  const { dts } = await processTypeDef(
    join(
      fileURLToPath(import.meta.url),
      '../',
      '__fixtures__',
      'napi_type_def',
    ),
    false,
  )

  t.snapshot(dts)
})

// The next two tests use a minimal fixture (one numeric + one string
// enum) to keep snapshots small and focused on the flag's behavior.
const flagFixture = join(
  fileURLToPath(import.meta.url),
  '../',
  '__fixtures__',
  'runtime_string_enum_flag',
)

const namespaceIteratorFixture = join(
  fileURLToPath(import.meta.url),
  '../',
  '__fixtures__',
  'namespace_iterator',
)

const reservedGlobalThisFixture = join(
  fileURLToPath(import.meta.url),
  '../',
  '__fixtures__',
  'reserved_global_this',
)

const reservedGlobalThisNamespaceFixture = join(
  fileURLToPath(import.meta.url),
  '../',
  '__fixtures__',
  'reserved_global_this_namespace',
)

const reservedNamespacedGlobalThisFixture = join(
  fileURLToPath(import.meta.url),
  '../',
  '__fixtures__',
  'reserved_namespaced_global_this',
)

test('keeps same-named namespace classes isolated and iterators portable', async (t) => {
  const { dts } = await processTypeDef(namespaceIteratorFixture, true)

  t.true(
    dts.includes(
      'interface IteratorObject<T, TReturn = unknown, TNext = unknown>\n' +
        '    extends globalThis.Iterator<T, TReturn, TNext>',
    ),
  )
  t.false(dts.includes('class PortableIterator extends Iterator'))
  t.true(
    dts.includes(
      '[globalThis.Symbol.iterator](): this\n' +
        '  next(...[value]: [] | [Record<string, number>]): globalThis.IteratorResult<[number, number], ([string, number]) | undefined>\n' +
        '  return(...[value]: [] | [[string, number]]): globalThis.IteratorResult<[number, number], ([string, number]) | undefined>\n' +
        '  throw(exception?: unknown): globalThis.IteratorResult<[number, number], ([string, number]) | undefined>',
    ),
  )
  t.true(
    dts.includes(
      "export interface PortableIterator extends globalThis.Omit<globalThis.IteratorObject<[number, number], ([string, number]) | undefined, Record<string, number>>, 'next' | 'return' | 'throw'> {}",
    ),
  )
  t.true(
    dts.includes(
      'globalThis.IteratorResult<number, (() => number) | undefined>',
    ),
  )
  t.false(
    dts.includes('globalThis.IteratorResult<number, () => number | undefined>'),
  )
  t.true(dts.includes('export declare class __NapiRsAsyncGenerator'))
  t.false(dts.includes('type __NapiRsAsyncGenerator<'))
  t.true(
    dts.includes(
      'interface __NapiRsAsyncGenerator_1<TOwner, T, TReturn, TNext>',
    ),
  )
  t.false(dts.includes('extends globalThis.AsyncGenerator<'))
  t.false(dts.includes('Symbol.asyncDispose'))
  t.false(dts.includes('export interface __NapiRsAsyncGenerator_1'))
  t.true(
    dts.includes(
      '[globalThis.Symbol.asyncIterator](): globalThis.__NapiRsAsyncGenerator_1<PortableAsyncIterator, [number, number], [string, number], Record<string, number>>',
    ),
  )
  t.true(dts.includes('class DerivedClass extends BaseClass'))
  t.is(dts.match(/alphaMethod/g)?.length, 1)
  t.is(dts.match(/betaMethod/g)?.length, 1)
  t.regex(
    dts,
    /namespace alpha \{\n  export class SharedClass \{\n    alphaMethod\(\): void\n  \}/,
  )
  t.regex(
    dts,
    /namespace beta \{\n  export class SharedClass \{\n    betaMethod\(\): void\n  \}/,
  )
})

test('rejects the unqualifiable globalThis export name', async (t) => {
  await t.throwsAsync(processTypeDef(reservedGlobalThisFixture, true), {
    message: /export name `globalThis` is reserved/,
  })
})

test('rejects globalThis as a namespace export name', async (t) => {
  await t.throwsAsync(
    processTypeDef(reservedGlobalThisNamespaceFixture, true),
    {
      message: /export name `globalThis` is reserved/,
    },
  )
})

test('rejects globalThis declarations inside namespaces', async (t) => {
  await t.throwsAsync(
    processTypeDef(reservedNamespacedGlobalThisFixture, true),
    {
      message: /export name `globalThis` is reserved/,
    },
  )
})

test('allocates one async generator helper after combining declaration fragments', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-typegen-fragments-'))
  const asyncIteratorPath = join(directory, 'async-iterator')
  const collisionPath = join(directory, 'collision')

  try {
    await Promise.all([
      writeFile(
        asyncIteratorPath,
        [
          '{"kind":"struct","name":"FragmentAsyncIterator","def":"constructor()","original_name":"FragmentAsyncIterator"}',
          '{"kind":"impl","name":"FragmentAsyncIterator","def":"[Symbol.asyncIterator](): AsyncGenerator<number, string, void>"}',
        ].join('\n'),
      ),
      writeFile(
        collisionPath,
        '{"kind":"struct","name":"__NapiRsAsyncGenerator","def":"constructor()","original_name":"__NapiRsAsyncGenerator"}',
      ),
    ])

    const { dts } = await processTypeDefs(
      [asyncIteratorPath, collisionPath],
      true,
    )

    t.is(dts.match(/declare global \{/g)?.length, 1)
    t.true(
      dts.includes(
        'interface __NapiRsAsyncGenerator_1<TOwner, T, TReturn, TNext>',
      ),
    )
    t.true(
      dts.includes(
        '[globalThis.Symbol.asyncIterator](): globalThis.__NapiRsAsyncGenerator_1<FragmentAsyncIterator, number, string, void>',
      ),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('generated iterators compile on legacy TypeScript and expose current helpers', async (t) => {
  const { dts } = await processTypeDef(namespaceIteratorFixture, true)
  const legacyDiagnostics = await compileIteratorConsumer(
    legacyTypeScript as unknown as typeof typeScript,
    dts,
    ['lib.es2022.d.ts'],
    false,
  )
  t.deepEqual(legacyDiagnostics, [])

  const currentDiagnostics = await compileIteratorConsumer(
    typeScript,
    dts,
    [
      'lib.es2022.d.ts',
      'lib.es2025.iterator.d.ts',
      'lib.esnext.disposable.d.ts',
    ],
    true,
  )
  t.deepEqual(currentDiagnostics, [])
})

test('should process type def with noConstEnum and runtimeStringEnum correctly', async (t) => {
  const { dts } = await processTypeDef(flagFixture, false, true)

  t.snapshot(dts)
})

test('runtimeStringEnum is a no-op when constEnum is set', async (t) => {
  const { dts } = await processTypeDef(flagFixture, true, true)

  t.snapshot(dts)
})

test('places type imports from the parsed TypeScript module structure', (t) => {
  const source = `/// <reference lib="dom" />
/* generated header */
import './side-effect.js' with { type: 'javascript' }
// keep this comment on the re-export
export { Existing } from './existing.js' with { type: 'json' }
import type { Present } from './present.js' with { mode: 'strict' }
/** Documents value. */
export declare const value: Present
`

  const result = appendTypeImports(source, [
    { module: './present.js', name: 'Present' },
    { module: 'buffer', name: 'Buffer' },
  ])

  t.is(
    result,
    `/// <reference lib="dom" />
/* generated header */
import './side-effect.js' with { type: 'javascript' }
// keep this comment on the re-export
export { Existing } from './existing.js' with { type: 'json' }
import type { Present } from './present.js' with { mode: 'strict' }
import type { Buffer } from "buffer"
/** Documents value. */
export declare const value: Present
`,
  )

  t.is(
    appendTypeImports(
      `/// <reference lib="dom" />
/* generated header */
/** Documents value. */
export declare const value: string
`,
      [{ module: 'buffer', name: 'Buffer' }],
    ),
    `/// <reference lib="dom" />
/* generated header */
import type { Buffer } from "buffer"
/** Documents value. */
export declare const value: string
`,
  )
})

test('removes only DOM-compatible node stream type imports', (t) => {
  const source = `/// <reference lib="dom" />
/* generated header */
import type { ReadableStream, WritableStream } from 'node:stream/web' with { mode: 'types' }
export { Existing } from './existing.js'
export declare const stream: ReadableStream
`

  t.is(
    removeNodeStreamWebTypeImports(source),
    `/// <reference lib="dom" />
/* generated header */
export { Existing } from './existing.js'
export declare const stream: ReadableStream
`,
  )
  t.throws(
    () =>
      removeNodeStreamWebTypeImports(
        `import type { ReadableStream as NodeReadableStream } from 'node:stream/web'\n`,
      ),
    { message: /unaliased types/ },
  )
})

test('renders imported types inline without colliding with exported declarations', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-type-import-'))
  const fixture = join(directory, 'type-def.jsonl')
  const marker = '__NAPI_RS_TYPE_IMPORT_BUFFER__'

  try {
    await writeFile(
      fixture,
      [
        {
          kind: 'struct',
          name: 'Buffer',
          js_doc: '',
          def: '',
        },
        {
          kind: 'fn',
          name: 'passThrough',
          js_doc: '',
          def: 'function passThrough(value: Buffer): Buffer',
          def_with_type_import_markers: `function passThrough(value: ${marker}): ${marker}`,
          type_imports: [{ marker, name: 'Buffer', module: 'buffer' }],
        },
        {
          kind: 'struct',
          name: 'BufferHolder',
          js_doc: '',
          def: 'constructor(value: Buffer)\\nreadonly copy: Buffer',
          def_with_type_import_markers: `constructor(value: ${marker})\\nreadonly copy: ${marker}`,
          type_imports: [{ marker, name: 'Buffer', module: 'buffer' }],
        },
        {
          kind: 'impl',
          name: 'BufferHolder',
          js_doc: '',
          def: 'value(): Buffer',
          def_with_type_import_markers: `value(): ${marker}`,
          type_imports: [{ marker, name: 'Buffer', module: 'buffer' }],
        },
        {
          kind: 'fn',
          name: 'markerLiteral',
          js_doc: '',
          def: `function markerLiteral(value: Buffer, object: { ${marker}: string }): "${marker}"`,
          def_with_type_import_markers: `function markerLiteral(value: ${marker}, object: { ${marker}: string }): "${marker}"`,
          type_imports: [{ marker, name: 'Buffer', module: 'buffer' }],
        },
        {
          kind: 'fn',
          name: 'usesExportedBuffer',
          js_doc: '',
          def: 'function usesExportedBuffer(value: Buffer): Buffer',
        },
      ]
        .map((def) => JSON.stringify(def))
        .join('\n') + '\n',
    )

    const { dts, dtsWithTypeImportMarkers, typeImports } = await processTypeDef(
      fixture,
      true,
    )
    const dtsWithTypeImports = rewriteTypeImportReferences(
      dtsWithTypeImportMarkers,
      typeImports,
      true,
    )
    t.is(
      dts,
      `export declare class Buffer {

}

export declare class BufferHolder {
  constructor(value: Buffer)
  readonly copy: Buffer
  value(): Buffer
}

export declare function markerLiteral(value: Buffer, object: { ${marker}: string }): "${marker}"

export declare function passThrough(value: Buffer): Buffer

export declare function usesExportedBuffer(value: Buffer): Buffer
`,
    )
    t.is(
      dtsWithTypeImports,
      `export declare class Buffer {

}

export declare class BufferHolder {
  constructor(value: import("buffer").Buffer)
  readonly copy: import("buffer").Buffer
  value(): import("buffer").Buffer
}

export declare function markerLiteral(value: import("buffer").Buffer, object: { ${marker}: string }): "${marker}"

export declare function passThrough(value: import("buffer").Buffer): import("buffer").Buffer

export declare function usesExportedBuffer(value: Buffer): Buffer
`,
    )
    t.is(dts.match(new RegExp(marker, 'g'))?.length, 2)
    t.is(dtsWithTypeImports.match(new RegExp(marker, 'g'))?.length, 2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rewrites Buffer references after combining fragments and the declaration header', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-typegen-complete-'))
  const fragmentDirectory = join(directory, 'fragments')
  const headerDirectory = join(directory, 'header')
  const legacyBufferImport = [{ name: 'Buffer', module: 'buffer' }]

  try {
    await Promise.all([mkdir(fragmentDirectory), mkdir(headerDirectory)])
    await Promise.all([
      writeFile(
        join(fragmentDirectory, 'a.type'),
        `${JSON.stringify({
          kind: 'fn',
          name: 'usesFragmentBuffer',
          def: 'function usesFragmentBuffer(value: Buffer): Buffer',
          type_imports: legacyBufferImport,
        })}\n`,
      ),
      writeFile(
        join(fragmentDirectory, 'b.type'),
        `${JSON.stringify({
          kind: 'struct',
          name: 'Buffer',
          def: '',
        })}\n`,
      ),
      writeFile(
        join(headerDirectory, 'a.type'),
        `${JSON.stringify({
          kind: 'fn',
          name: 'usesHeaderBuffer',
          def: 'function usesHeaderBuffer(value: Buffer): Buffer',
          type_imports: legacyBufferImport,
        })}\n`,
      ),
    ])

    const [
      { dtsWithTypeImports: fragmentTypeDef },
      { dtsWithTypeImports: headerTypeDef },
    ] = await Promise.all([
      generateTypeDef({
        typeDefDir: fragmentDirectory,
        cwd: directory,
      }),
      generateTypeDef({
        typeDefDir: headerDirectory,
        cwd: directory,
        dtsHeader: 'export declare class Buffer {}\n',
      }),
    ])

    t.regex(fragmentTypeDef, /usesFragmentBuffer\(value: Buffer\): Buffer/)
    t.notRegex(fragmentTypeDef, /import\("buffer"\)\.Buffer/)
    t.regex(headerTypeDef, /usesHeaderBuffer\(value: Buffer\): Buffer/)
    t.notRegex(headerTypeDef, /import\("buffer"\)\.Buffer/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rewrites legacy Buffer imports with TypeScript binding semantics', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-buffer-bindings-'))
  const fixture = join(directory, 'type-def.jsonl')
  const legacyBufferImport = [{ name: 'Buffer', module: 'buffer' }]

  try {
    await writeFile(
      fixture,
      [
        {
          kind: 'fn',
          name: 'constrained',
          def: 'function constrained<T extends Buffer>(value: T): Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'shadowed',
          def: 'function shadowed<Buffer>(value: Buffer): Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'shapes',
          def: `function shapes<T>(value: {
            Buffer(): string
            mapped: { [Buffer in keyof T]: T[Buffer] }
            inferred: Buffer extends infer Buffer ? Buffer : never
            external: Buffer
          }): Buffer`,
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'destructure',
          def: 'function destructure({ Buffer }: { Buffer: string }, value: Buffer): Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'assertionTarget',
          def: 'function assertionTarget(Buffer: unknown): asserts Buffer is string',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'predicate',
          def: 'function predicate(value: unknown): asserts value is Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'parameterValueBinding',
          def: 'function parameterValueBinding(before: typeof Buffer, Buffer: unknown): typeof Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'separateTypeAndValueBindings',
          def: 'function separateTypeAndValueBindings(Buffer: unknown, value: Buffer): Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'destructuredValueBinding',
          def: 'function destructuredValueBinding({ value: Buffer }: { value: unknown }): typeof Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'arrayValueBinding',
          def: 'function arrayValueBinding([Buffer]: [unknown]): typeof Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'nestedValueBinding',
          def: 'function nestedValueBinding(callback: (Buffer: unknown) => typeof Buffer, value: typeof Buffer): typeof Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'propertyNotBinding',
          def: 'function propertyNotBinding(value: { Buffer: unknown }): typeof Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'qualifiedTypeQuery',
          def: 'function qualifiedTypeQuery(): typeof Buffer.from',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'qualifiedNames',
          def: 'function qualifiedNames(value: Other.Buffer): typeof Other.Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'importTypeProperty',
          def: 'function importTypeProperty(value: import("other").Buffer): import("other").Buffer',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'escaped',
          def: 'function escaped(value: Buffer): "line\\nnext" | `template\\n${Buffer extends Uint8Array ? "buffer" : "other"}`',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'struct',
          name: 'EscapedFields',
          def: 'first: Buffer\\nsecond: "line\\nnext"',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'interface',
          name: 'Buffer',
          def: '',
          js_mod: 'TypeOnlyScope',
        },
        {
          kind: 'fn',
          name: 'typeOnlyScope',
          def: 'function typeOnlyScope(value: Buffer): typeof Buffer',
          js_mod: 'TypeOnlyScope',
          type_imports: legacyBufferImport,
        },
        {
          kind: 'fn',
          name: 'Buffer',
          def: 'function Buffer(): void',
          js_mod: 'ValueOnlyScope',
        },
        {
          kind: 'fn',
          name: 'valueOnlyScope',
          def: 'function valueOnlyScope(value: Buffer): typeof Buffer',
          js_mod: 'ValueOnlyScope',
          type_imports: legacyBufferImport,
        },
      ]
        .map((def) => JSON.stringify(def))
        .join('\n') + '\n',
    )

    const { dts, dtsWithTypeImportMarkers, typeImports } = await processTypeDef(
      fixture,
      true,
    )
    const dtsWithTypeImports = rewriteTypeImportReferences(
      dtsWithTypeImportMarkers,
      typeImports,
      true,
    )

    t.regex(dtsWithTypeImports, /T extends import\("buffer"\)\.Buffer/)
    t.regex(
      dtsWithTypeImports,
      /constrained<T extends import\("buffer"\)\.Buffer>\(value: T\): import\("buffer"\)\.Buffer/,
    )
    t.regex(dtsWithTypeImports, /shadowed<Buffer>\(value: Buffer\): Buffer/)
    t.regex(dtsWithTypeImports, /Buffer\(\): string/)
    t.regex(dtsWithTypeImports, /\[Buffer in keyof T\]: T\[Buffer\]/)
    t.regex(
      dtsWithTypeImports,
      /import\("buffer"\)\.Buffer extends infer Buffer \? Buffer : never/,
    )
    t.regex(
      dtsWithTypeImports,
      /\{ Buffer \}: \{ Buffer: string \}, value: import\("buffer"\)\.Buffer/,
    )
    t.regex(
      dtsWithTypeImports,
      /assertionTarget\(Buffer: unknown\): asserts Buffer is string/,
    )
    t.regex(dtsWithTypeImports, /asserts value is import\("buffer"\)\.Buffer/)
    t.regex(
      dtsWithTypeImports,
      /parameterValueBinding\(before: typeof Buffer, Buffer: unknown\): typeof Buffer/,
    )
    t.regex(
      dtsWithTypeImports,
      /separateTypeAndValueBindings\(Buffer: unknown, value: import\("buffer"\)\.Buffer\): import\("buffer"\)\.Buffer/,
    )
    t.regex(
      dtsWithTypeImports,
      /destructuredValueBinding\(\{ value: Buffer \}: \{ value: unknown \}\): typeof Buffer/,
    )
    t.regex(
      dtsWithTypeImports,
      /arrayValueBinding\(\[Buffer\]: \[unknown\]\): typeof Buffer/,
    )
    t.regex(
      dtsWithTypeImports,
      /nestedValueBinding\(callback: \(Buffer: unknown\) => typeof Buffer, value: typeof import\("buffer"\)\.Buffer\): typeof import\("buffer"\)\.Buffer/,
    )
    t.regex(
      dtsWithTypeImports,
      /propertyNotBinding\(value: \{ Buffer: unknown \}\): typeof import\("buffer"\)\.Buffer/,
    )
    t.regex(
      dtsWithTypeImports,
      /qualifiedTypeQuery\(\): typeof import\("buffer"\)\.Buffer\.from/,
    )
    t.regex(
      dtsWithTypeImports,
      /qualifiedNames\(value: Other\.Buffer\): typeof Other\.Buffer/,
    )
    t.regex(
      dtsWithTypeImports,
      /importTypeProperty\(value: import\("other"\)\.Buffer\): import\("other"\)\.Buffer/,
    )
    t.regex(
      dtsWithTypeImports,
      /namespace TypeOnlyScope \{[\s\S]*typeOnlyScope\(value: Buffer\): typeof import\("buffer"\)\.Buffer/,
    )
    t.regex(
      dtsWithTypeImports,
      /namespace ValueOnlyScope \{[\s\S]*valueOnlyScope\(value: import\("buffer"\)\.Buffer\): typeof Buffer/,
    )
    t.true(dtsWithTypeImports.includes('"line\\nnext"'))
    t.true(
      dtsWithTypeImports.includes(
        '`template\\n${import("buffer").Buffer extends Uint8Array ? "buffer" : "other"}`',
      ),
    )
    t.regex(
      dtsWithTypeImports,
      /first: import\("buffer"\)\.Buffer\n  second: "line\\nnext"/,
    )
    t.notRegex(dtsWithTypeImports, /__NAPI_RS_TYPE_IMPORT_/)
    t.notRegex(dts, /import\("buffer"\)\.Buffer/)
    t.true(dts.includes('"line\\nnext"'))

    const threadlessDiagnostics = await compileDeclarations(
      dtsWithTypeImports,
      `declare module "buffer" { export class Buffer extends Uint8Array {} }
declare module "other" { export interface Buffer {} }
declare namespace Other {
  interface Buffer {}
  const Buffer: unknown
}
`,
    )
    t.deepEqual(threadlessDiagnostics, [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reports malformed legacy declaration input with TypeScript diagnostics', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-typegen-invalid-'))
  const fixture = join(directory, 'type-def.jsonl')

  try {
    await writeFile(
      fixture,
      `${JSON.stringify({
        kind: 'fn',
        name: 'broken',
        def: 'function broken(value: Buffer',
        type_imports: [{ name: 'Buffer', module: 'buffer' }],
      })}\n`,
    )

    const error = await t.throwsAsync(() =>
      generateTypeDef({
        typeDefDir: directory,
        cwd: directory,
        noDtsHeader: true,
      }),
    )
    t.regex(error.message, /Failed to parse declaration source/)
    t.regex(error.message, /\d+:\d+/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

async function compileIteratorConsumer(
  compiler: typeof typeScript,
  declarations: string,
  lib: string[],
  expectHelpers: boolean,
): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-iterator-typegen-'))
  const declarationPath = join(directory, 'index.d.ts')
  const consumerPath = join(directory, 'consumer.ts')
  const helperAssertion = expectHelpers
    ? `
const values: Array<[number, number]> = iterator
  .drop(1)
  .map((value) => value)
  .toArray()
void values
// @ts-expect-error napi-rs async iterators do not implement async disposal.
asyncIterator[Symbol.asyncDispose]()
`
    : ''

  try {
    await Promise.all([
      writeFile(declarationPath, declarations),
      writeFile(
        consumerPath,
        `
import { PortableAsyncIterator, PortableIterator } from './index'

let iterator = new PortableIterator()
iterator = iterator[Symbol.iterator]()
iterator.next()
iterator.next({ first: 1 })
iterator.return()
iterator.return(['complete', 1])
// @ts-expect-error omission is supported, but explicit undefined is not a next value.
iterator.next(undefined)
// @ts-expect-error omission is supported, but explicit undefined is not the return tuple.
iterator.return(undefined)
const standardIterator: Iterator<
  [number, number],
  [string, number] | undefined,
  Record<string, number>
> = iterator
void standardIterator

class Child extends PortableIterator {
  childOnly(): void {}
}

let child = new Child()
child = child[Symbol.iterator]()
child.childOnly()

const asyncIterator = new PortableAsyncIterator()[Symbol.asyncIterator]()
export const inferredAsyncIterator = asyncIterator[Symbol.asyncIterator]()
asyncIterator.next()
asyncIterator.next({ first: 1 })
asyncIterator.return()
asyncIterator.return(['complete', 1])
// @ts-expect-error omission is supported, but explicit undefined is not a next value.
asyncIterator.next(undefined)
// @ts-expect-error omission is supported, but explicit undefined is not the return tuple.
asyncIterator.return(undefined)
// @ts-expect-error napi-rs converts return values before entering the Rust hook.
asyncIterator.return(Promise.resolve(['complete', 1]))
inferredAsyncIterator.return(['complete', 1])
// @ts-expect-error recursive async iteration keeps the direct return contract.
inferredAsyncIterator.return(undefined)
// @ts-expect-error recursive async iteration keeps the direct return contract.
inferredAsyncIterator.return(Promise.resolve(['complete', 1]))
const standardAsyncIterator: AsyncIterator<
  [number, number],
  [string, number] | undefined,
  Record<string, number>
> = asyncIterator
void standardAsyncIterator
async function consumeAsyncIterator() {
  for await (const value of asyncIterator) {
    const pair: [number, number] = value
    void pair
  }
}
void consumeAsyncIterator
${helperAssertion}
`,
      ),
    ])

    const compilerOptions: typeScript.CompilerOptions = {
      lib,
      module: compiler.ModuleKind.Node16,
      moduleResolution: compiler.ModuleResolutionKind.Node16,
      skipLibCheck: false,
      strict: true,
      target: compiler.ScriptTarget.ES2022,
      types: [],
    }
    const program = compiler.createProgram([declarationPath, consumerPath], {
      ...compilerOptions,
      noEmit: true,
    })

    const diagnostics = compiler
      .getPreEmitDiagnostics(program)
      .map((diagnostic) =>
        compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      )
    if (diagnostics.length > 0) {
      return diagnostics
    }

    const emittedDirectory = join(directory, 'emitted')
    const emitProgram = compiler.createProgram(
      [declarationPath, consumerPath],
      {
        ...compilerOptions,
        declaration: true,
        emitDeclarationOnly: true,
        outDir: emittedDirectory,
      },
    )
    const emitResult = emitProgram.emit()
    diagnostics.push(
      ...compiler
        .getPreEmitDiagnostics(emitProgram)
        .concat(emitResult.diagnostics)
        .map((diagnostic) =>
          compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        ),
    )
    if (diagnostics.length > 0) {
      return diagnostics
    }

    const emittedDeclarationPath = join(emittedDirectory, 'index.d.ts')
    const downstreamPath = join(emittedDirectory, 'downstream.ts')
    await Promise.all([
      writeFile(emittedDeclarationPath, declarations),
      writeFile(
        downstreamPath,
        `
import { inferredAsyncIterator } from './consumer'

inferredAsyncIterator.return(['complete', 1])
// @ts-expect-error declaration emit must retain the direct return contract.
inferredAsyncIterator.return(undefined)
// @ts-expect-error declaration emit must retain the direct return contract.
inferredAsyncIterator.return(Promise.resolve(['complete', 1]))
`,
      ),
    ])
    const downstreamProgram = compiler.createProgram(
      [
        emittedDeclarationPath,
        join(emittedDirectory, 'consumer.d.ts'),
        downstreamPath,
      ],
      {
        ...compilerOptions,
        noEmit: true,
      },
    )
    return compiler
      .getPreEmitDiagnostics(downstreamProgram)
      .map((diagnostic) =>
        compiler.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function compileDeclarations(
  declarations: string,
  moduleDeclarations: string,
): Promise<string[]> {
  const directory = await mkdtemp(join(tmpdir(), 'napi-rs-typegen-compile-'))
  const declarationPath = join(directory, 'index.d.ts')
  const moduleDeclarationsPath = join(directory, 'modules.d.ts')

  try {
    await Promise.all([
      writeFile(declarationPath, declarations),
      writeFile(moduleDeclarationsPath, moduleDeclarations),
    ])
    const program = typeScript.createProgram(
      [declarationPath, moduleDeclarationsPath],
      {
        lib: ['lib.es2022.d.ts'],
        module: typeScript.ModuleKind.Node16,
        moduleResolution: typeScript.ModuleResolutionKind.Node16,
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: typeScript.ScriptTarget.ES2022,
        types: [],
      },
    )
    return typeScript
      .getPreEmitDiagnostics(program)
      .map((diagnostic) =>
        typeScript.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
