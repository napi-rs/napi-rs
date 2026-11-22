import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'path'
import { fileURLToPath } from 'url'

import test from 'ava'

import {
  correctStringIdent,
  processTypeDef,
  processTypeDefs,
} from '../typegen.js'

async function processInlineTypeDef(
  lines: Array<Record<string, unknown>>,
  constEnum = true,
  runtimeStringEnum = false,
) {
  const dir = await mkdtemp(join(tmpdir(), 'napi-typegen-'))
  const file = join(dir, 'defs')
  await writeFile(
    file,
    lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
  )
  try {
    return await processTypeDef(file, constEnum, runtimeStringEnum)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

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

test('should process type def with noConstEnum and runtimeStringEnum correctly', async (t) => {
  const { dts } = await processTypeDef(flagFixture, false, true)

  t.snapshot(dts)
})

test('runtimeStringEnum is a no-op when constEnum is set', async (t) => {
  const { dts } = await processTypeDef(flagFixture, true, true)

  t.snapshot(dts)
})

test('simple type aliases stay on one line', async (t) => {
  const { dts } = await processInlineTypeDef([
    { kind: 'type', name: 'CustomU32', def: 'number' },
  ])
  t.true(dts.includes('export type CustomU32 = number'))
  t.false(/export type CustomU32 =\s*\n/.test(dts))
})

test('empty classes do not contain a blank body', async (t) => {
  const { dts } = await processInlineTypeDef([
    { kind: 'struct', name: 'Blake2BKey', def: '' },
  ])
  t.true(dts.includes('export declare class Blake2BKey {}'))
  t.false(dts.includes('class Blake2BKey {\n\n}'))
})

test('nested namespaces export their root object once', async (t) => {
  const { dts, exports } = await processInlineTypeDef([
    { kind: 'fn', name: 'a', def: 'function a(): void', js_mod: 'outer' },
    { kind: 'fn', name: 'b', def: 'function b(): void', js_mod: 'outer.b' },
    { kind: 'fn', name: 'c', def: 'function c(): void', js_mod: 'only.c' },
    { kind: 'fn', name: 'd', def: 'function d(): void', js_mod: 'only.d' },
  ])
  t.true(dts.includes('export declare namespace outer.b {'))
  t.true(dts.includes('export declare namespace only.d {'))
  t.deepEqual(exports, ['only', 'outer'])
})

test('well-known symbol members are not taken as the async iterator helper', async (t) => {
  // `#[napi(well_known_symbol = "asyncIterator")]` emits a `globalThis` key,
  // which the `#[napi(async_iterator)]` rewrite must leave alone.
  const member =
    '[globalThis.Symbol.asyncIterator](): AsyncGenerator<number, void, undefined>'
  const { dts } = await processInlineTypeDef([
    { kind: 'struct', name: 'Stream', def: '' },
    { kind: 'impl', name: 'Stream', def: ` ${member}` },
  ])
  t.true(dts.includes(member))
  t.false(dts.includes('__NapiRsAsyncGenerator'))
})

test('no-const-enum string enums emit a spaced union', async (t) => {
  const { dts } = await processTypeDef(flagFixture, false, false)
  t.true(dts.includes("export type Status = 'Active' | 'Inactive'"))
  t.false(dts.includes("'Active'|"))
})

test('no-const-enum string enums keep commas inside variant docs', async (t) => {
  const { dts } = await processInlineTypeDef(
    [
      {
        kind: 'string_enum',
        name: 'Status',
        def: "/** First, documented variant */\n Active = 'Active',\n Inactive = 'Inactive'",
      },
    ],
    false,
    false,
  )
  t.true(dts.includes("export type Status = 'Active' | 'Inactive'"))
  t.false(dts.includes('/** First |'))
})

test('no-const-enum string enums keep Unicode variant names', async (t) => {
  const { dts } = await processInlineTypeDef(
    [
      {
        kind: 'string_enum',
        name: 'Status',
        def: "成功 = '成功',\n Failed = 'Failed'",
      },
    ],
    false,
    false,
  )
  t.true(dts.includes("export type Status = '成功' | 'Failed'"))
})

test('no-const-enum string enums keep quoted JS property names', async (t) => {
  const { dts } = await processInlineTypeDef(
    [
      {
        kind: 'string_enum',
        name: 'Header',
        def: "'content-type' = 'content-type',\n Plain = 'plain'",
      },
    ],
    false,
    false,
  )
  t.true(dts.includes("export type Header = 'content-type' | 'plain'"))
})

test('no-const-enum string enums keep commas and escapes inside values', async (t) => {
  const { dts } = await processInlineTypeDef(
    [
      {
        kind: 'string_enum',
        name: 'Label',
        def: "Csv = 'a,b',\n Quoted = 'say \\'hi\\'',\n Count = 2",
      },
    ],
    false,
    false,
  )
  t.true(dts.includes("export type Label = 'a,b' | 'say \\'hi\\'' | 2"))
})

test('correctStringIdent keeps nested object-type fields indented', (t) => {
  const input = `export declare function bufferComplexOverride(value: {
  Buffer(): "line"
mapped: { [Buffer in keyof T]: T[Buffer] }
external: Buffer
}): void`
  const formatted = correctStringIdent(input, 0)
  t.true(formatted.includes('  mapped: { [Buffer in keyof T]: T[Buffer] }'))
  t.true(formatted.includes('  external: Buffer'))
  t.false(formatted.includes('\nmapped:'))
})

test('processTypeDefs returns empty string for 0-byte marker files', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'napi-typegen-'))
  const fileA = join(dir, 'crate_a')
  const fileB = join(dir, 'crate_b')
  await Promise.all([writeFile(fileA, ''), writeFile(fileB, '   \r\n\t\n')])
  try {
    const result = await processTypeDefs([fileA, fileB], true)
    t.is(result.dts, '')
    t.deepEqual(result.exports, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('processTypeDefs filters empty file groups without stray blank lines', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'napi-typegen-'))
  const empty1 = join(dir, 'a_empty')
  const real1 = join(dir, 'b_real')
  const empty2 = join(dir, 'c_empty')
  const real2 = join(dir, 'd_real')
  await Promise.all([
    writeFile(empty1, ''),
    writeFile(
      real1,
      `${JSON.stringify({ kind: 'fn', name: 'alpha', def: 'function alpha(): void' })}\r\n\r\n   \t\r\n`,
    ),
    writeFile(empty2, ''),
    writeFile(
      real2,
      `${JSON.stringify({ kind: 'fn', name: 'beta', def: 'function beta(): void' })}\n`,
    ),
  ])
  try {
    const result = await processTypeDefs([empty1, real1, empty2, real2], true)
    t.is(
      result.dts,
      'export declare function alpha(): void\n\nexport declare function beta(): void\n',
    )
    t.deepEqual(result.exports, ['alpha', 'beta'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('readIntermediateTypeFile reports file and 1-based line number on corrupt or invalid JSONL', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'napi-typegen-'))
  const corruptFile = join(dir, 'corrupt')
  const invalidShapeFile = join(dir, 'invalid-shape')
  await Promise.all([
    writeFile(
      corruptFile,
      [
        JSON.stringify({ kind: 'fn', name: 'ok', def: 'function ok(): void' }),
        '   ',
        '{not valid json',
      ].join('\r\n'),
    ),
    writeFile(
      invalidShapeFile,
      ['', JSON.stringify({ kind: 'fn', name: 'missingDef' })].join('\n'),
    ),
  ])
  try {
    const parseErr = await t.throwsAsync(() =>
      processTypeDef(corruptFile, true),
    )
    t.regex(
      parseErr!.message,
      new RegExp(`Failed to parse intermediate type definition at .*corrupt:3`),
    )
    t.truthy(parseErr!.cause)

    const shapeErr = await t.throwsAsync(() =>
      processTypeDef(invalidShapeFile, true),
    )
    t.regex(
      shapeErr!.message,
      /Invalid intermediate type definition at .*invalid-shape:2/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
