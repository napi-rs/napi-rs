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
  reservedDeclarationText = '',
) {
  const dir = await mkdtemp(join(tmpdir(), 'napi-typegen-'))
  const file = join(dir, 'defs')
  await writeFile(
    file,
    lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
  )
  try {
    return reservedDeclarationText
      ? await processTypeDefs(
          [file],
          constEnum,
          runtimeStringEnum,
          reservedDeclarationText,
        )
      : await processTypeDef(file, constEnum, runtimeStringEnum)
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

test('an export and a namespace of the same name are exported once', async (t) => {
  const { dts, exports } = await processInlineTypeDef([
    { kind: 'fn', name: 'Deep', def: 'function Deep(): void' },
    { kind: 'fn', name: 'x', def: 'function x(): void', js_mod: 'Deep.left' },
    { kind: 'fn', name: 'y', def: 'function y(): void', js_mod: 'Deep' },
  ])
  t.true(dts.includes('export declare function Deep(): void'))
  t.true(dts.includes('export declare namespace Deep.left {'))
  t.deepEqual(exports, ['Deep'])
})

test('`globalThis` is reserved as a namespace root', async (t) => {
  await t.throwsAsync(
    processInlineTypeDef([
      {
        kind: 'fn',
        name: 'f',
        def: 'function f(): void',
        js_mod: 'globalThis.foo',
      },
    ]),
    { message: /`globalThis` is reserved/ },
  )
})

test('empty namespace segments and `__proto__` are rejected', async (t) => {
  for (const [jsMod, message] of [
    ['', /`` is empty or has an empty segment/],
    ['a..b', /`a\.\.b` is empty or has an empty segment/],
    ['a.', /`a\.` is empty or has an empty segment/],
    ['__proto__', /must not use `__proto__`/],
    ['a.__proto__', /must not use `__proto__`/],
  ] as const) {
    await t.throwsAsync(
      processInlineTypeDef([
        { kind: 'fn', name: 'f', def: 'function f(): void', js_mod: jsMod },
      ]),
      { message },
      jsMod,
    )
  }
})

test('a shadowed reference from a namespace goes through a root alias', async (t) => {
  const { dts } = await processInlineTypeDef([
    { kind: 'interface', name: 'BObj', def: 'y: number', js_mod: 'b' },
    { kind: 'interface', name: 'AbObj', def: 'z: number', js_mod: 'a.b' },
    { kind: 'interface', name: 'Shared', def: 'top: number' },
    { kind: 'interface', name: 'Shared', def: 'inner: string', js_mod: 'a' },
    {
      kind: 'fn',
      name: 'f',
      // Inside `namespace a.b`, `b` is `a.b`.
      def: 'function f(o: b.BObj): Array<b.BObj>',
      js_mod: 'a.b',
      root_refs: ['b.BObj'],
    },
    {
      kind: 'fn',
      name: 'g',
      // Inside `namespace a`, `Shared` is `a.Shared`.
      def: 'function g(s: Shared, own: a.Shared): Shared',
      js_mod: 'a',
      root_refs: ['Shared', 'a.Shared'],
    },
    {
      kind: 'fn',
      name: 'h',
      // Hand-written `ts_type` text is not recorded and stays as written.
      def: 'function h(o: b.AbObj): void',
      js_mod: 'a.b',
    },
  ])
  t.true(
    dts.includes(
      'export function f(o: __NapiRsRoot_b.BObj): Array<__NapiRsRoot_b.BObj>',
    ),
  )
  t.true(
    dts.includes(
      'export function g(s: __NapiRsRoot_Shared, own: a.Shared): __NapiRsRoot_Shared',
    ),
  )
  t.true(dts.includes('export function h(o: b.AbObj): void'))
  t.true(
    dts.endsWith(
      '\n\nimport __NapiRsRoot_b = b\ntype __NapiRsRoot_Shared = Shared\n',
    ),
  )
})

test('a root reference nothing shadows is left as written', async (t) => {
  const { dts } = await processInlineTypeDef([
    { kind: 'interface', name: 'BObj', def: 'y: number', js_mod: 'b' },
    {
      kind: 'fn',
      name: 'f',
      def: 'function f(o: b.BObj): void',
      js_mod: 'a',
      root_refs: ['b.BObj'],
    },
  ])
  t.true(dts.includes('export function f(o: b.BObj): void'))
  t.false(dts.includes('__NapiRsRoot'))
})

test('a root alias does not take a name the declarations use', async (t) => {
  const { dts } = await processInlineTypeDef([
    { kind: 'interface', name: '__NapiRsRoot_b', def: 'x: number' },
    { kind: 'interface', name: 'BObj', def: 'y: number', js_mod: 'b' },
    { kind: 'interface', name: 'AbObj', def: 'z: number', js_mod: 'a.b' },
    {
      kind: 'fn',
      name: 'f',
      def: 'function f(o: b.BObj): void',
      js_mod: 'a.b',
      root_refs: ['b.BObj'],
    },
  ])
  t.true(dts.includes('export function f(o: __NapiRsRoot_b_1.BObj): void'))
  t.true(dts.endsWith('\n\nimport __NapiRsRoot_b_1 = b\n'))
})

test('a type declared after its use is written by its JS path', async (t) => {
  const { dts } = await processInlineTypeDef([
    {
      kind: 'fn',
      name: 'f',
      // napi-derive writes the Rust name of a type it has not seen yet.
      def: 'function f(o: MyType, r: Renamed, c: Later): MyType | null',
      unresolved_refs: ['MyType', 'Renamed', 'Later'],
    },
    {
      kind: 'fn',
      name: 'g',
      def: 'function g(o: MyType): void',
      js_mod: 'b',
      unresolved_refs: ['MyType'],
    },
    {
      kind: 'interface',
      name: 'MyType',
      original_name: 'MyType',
      def: 'x: number',
      js_mod: 'a',
    },
    {
      kind: 'interface',
      name: 'JsRenamed',
      original_name: 'Renamed',
      def: 'r: number',
    },
    { kind: 'struct', name: 'Later', original_name: 'Later', def: '' },
  ])
  t.true(
    dts.includes(
      'export declare function f(o: a.MyType, r: JsRenamed, c: Later): a.MyType | null',
    ),
  )
  t.true(dts.includes('export function g(o: a.MyType): void'))
})

test('a Rust name shared by two types is left as written', async (t) => {
  const { dts } = await processInlineTypeDef([
    {
      kind: 'fn',
      name: 'f',
      def: 'function f(o: Options): void',
      unresolved_refs: ['Options'],
    },
    {
      kind: 'interface',
      name: 'Options',
      original_name: 'Options',
      def: 'x: number',
      js_mod: 'a',
    },
    {
      kind: 'interface',
      name: 'Options',
      original_name: 'Options',
      def: 'y: number',
      js_mod: 'b',
    },
  ])
  t.true(dts.includes('export declare function f(o: Options): void'))
})

test('hand-written text in another declaration is not taken for a recorded reference', async (t) => {
  const { dts } = await processInlineTypeDef([
    {
      kind: 'interface',
      name: 'Cfg',
      original_name: 'Cfg',
      def: 'top: number',
    },
    {
      kind: 'interface',
      name: 'Cfg',
      original_name: 'ACfg',
      def: 'inner: string',
      js_mod: 'a',
    },
    {
      kind: 'fn',
      name: 'useTop',
      def: 'function useTop(c: Cfg): number',
      js_mod: 'a',
      root_refs: ['Cfg'],
    },
    {
      kind: 'fn',
      name: 'handWritten',
      // `ts_args_type = "c: Cfg"`, meaning `a.Cfg`.
      def: 'function handWritten(c: Cfg): number',
      js_mod: 'a',
    },
    { kind: 'struct', name: 'Client', def: '', js_mod: 'a' },
    {
      kind: 'impl',
      name: 'Client',
      def: 'take(c: Cfg): void',
      js_mod: 'a',
      root_refs: ['Cfg'],
    },
  ])
  t.true(dts.includes('export function useTop(c: __NapiRsRoot_Cfg): number'))
  t.true(dts.includes('export function handWritten(c: Cfg): number'))
  // An `impl` block's references belong to its class.
  t.true(dts.includes('take(c: __NapiRsRoot_Cfg): void'))
})

test('a recorded reference spelled like hand-written text of its declaration is left as written', async (t) => {
  // napi-rs/napi-rs#3476 review: `#[napi(ts_arg_type = "Input")]` inside
  // `namespace api` means `api.Input`, even when a neighbouring method of the
  // class refers to the top-level `Input`.
  const { dts } = await processInlineTypeDef([
    { kind: 'type', name: 'Input', original_name: 'Input', def: 'string' },
    { kind: 'type', name: 'Other', original_name: 'Other', def: 'string' },
    {
      kind: 'enum',
      name: 'Input',
      original_name: 'ApiInput',
      def: 'A = 0',
      js_mod: 'api',
    },
    {
      kind: 'enum',
      name: 'Other',
      original_name: 'ApiOther',
      def: 'C = 0',
      js_mod: 'api',
    },
    {
      kind: 'struct',
      name: 'Holder',
      original_name: 'Holder',
      // A field's `ts_type = "Input"`.
      def: 'hand: Input',
      js_mod: 'api',
      ts_override_names: ['Input'],
    },
    {
      kind: 'impl',
      name: 'Holder',
      def: 'take(x: Input): void\nother(y: Other): void',
      js_mod: 'api',
      root_refs: ['Input', 'Other'],
    },
    {
      kind: 'fn',
      name: 'handWritten',
      def: 'function handWritten(x: Input, y: Other): void',
      js_mod: 'api',
      root_refs: ['Other'],
      ts_override_names: ['x', 'Input'],
    },
  ])
  t.true(dts.includes('    hand: Input\n    take(x: Input): void\n'))
  t.true(dts.includes('    other(y: __NapiRsRoot_Other): void\n'))
  t.true(
    dts.includes(
      'export function handWritten(x: Input, y: __NapiRsRoot_Other): void',
    ),
  )
  t.false(dts.includes('__NapiRsRoot_Input'))
})

test("a later type's Rust name that already resolves to another type is left as written", async (t) => {
  // Known limit: inside `namespace api`, napi-derive's `Config` (the later
  // `settings::Config`, exported as `settings.PublicConfig`) resolves to
  // `api.Config`. The CLI cannot tell it from a Rust alias
  // (`type Config = ApiConfig`) napi-derive cannot see, so it is left as
  // written, like any later type's Rust name that resolves where it is used.
  const header = 'export interface Manual { m: number }\n'
  const { dts } = await processInlineTypeDef(
    [
      {
        kind: 'interface',
        name: 'Config',
        original_name: 'ApiConfig',
        def: 'label: string',
        js_mod: 'api',
      },
      {
        kind: 'interface',
        name: 'Mine',
        original_name: 'Mine',
        def: 'mine: string',
        js_mod: 'api',
      },
      {
        kind: 'fn',
        name: 'forward',
        def: 'function forward(c: Config, m: Mine, h: Manual, l: Later): Config',
        js_mod: 'api',
        unresolved_refs: ['Config', 'Mine', 'Manual', 'Later'],
      },
      {
        kind: 'interface',
        name: 'PublicConfig',
        original_name: 'Config',
        def: 'id: number',
        js_mod: 'settings',
      },
      {
        kind: 'interface',
        name: 'Manual',
        original_name: 'Manual',
        def: 'generated: number',
        js_mod: 'settings',
      },
      {
        kind: 'struct',
        name: 'PublicLater',
        original_name: 'Later',
        def: '',
      },
    ],
    true,
    false,
    header,
  )
  // `Config` is `api.Config`, `Mine` already is the type, `Manual` is the
  // header's and `Later` the alias a renamed class gets.
  t.true(
    dts.includes(
      'export function forward(c: Config, m: Mine, h: Manual, l: Later): Config',
    ),
  )
  t.false(dts.includes('settings.PublicConfig'))
  t.false(dts.includes('__NapiRsRoot'))
})

test("hand-written text spelling a later type's Rust name that resolves nowhere gets its JS path", async (t) => {
  // napi-rs/napi-rs#3476 review: `#[napi(ts_args_type = "o: Options")]` next
  // to a return of the later `opts::Options`. Where `Options` names nothing,
  // the text is an error as written; where it resolves, it is left.
  const { dts } = await processInlineTypeDef([
    {
      kind: 'interface',
      name: 'Options',
      original_name: 'Api2Options',
      def: 'y: number',
      js_mod: 'api2',
    },
    {
      kind: 'fn',
      name: 'configure',
      def: 'function configure(o: Options): Options',
      js_mod: 'api',
      unresolved_refs: ['Options'],
      ts_override_names: ['o', 'Options'],
    },
    {
      kind: 'fn',
      name: 'configure',
      def: 'function configure(o: Options): Options',
      js_mod: 'api2',
      unresolved_refs: ['Options'],
      ts_override_names: ['o', 'Options'],
    },
    {
      kind: 'interface',
      name: 'Options',
      original_name: 'Options',
      def: 'x: number',
      js_mod: 'opts',
    },
  ])
  t.true(
    dts.includes(
      'export declare namespace api {\n  export function configure(o: opts.Options): opts.Options\n',
    ),
  )
  t.true(dts.includes('  export function configure(o: Options): Options\n'))
})

test("hand-written text spelling a later top-level type's Rust name that resolves where it is used is left as written", async (t) => {
  // `#[napi(ts_args_type = "x: Input")]` inside `namespace api` means
  // `api.Input`, even when the inferred return type is the later top-level
  // `Input`: the two spellings cannot be told apart, so the text wins.
  const { dts } = await processInlineTypeDef([
    {
      kind: 'enum',
      name: 'Input',
      original_name: 'ApiInput',
      def: 'A = 0',
      js_mod: 'api',
    },
    {
      kind: 'fn',
      name: 'take',
      def: 'function take(x: Input, y: Input): void',
      js_mod: 'api',
      unresolved_refs: ['Input'],
      ts_override_names: ['Input'],
    },
    {
      kind: 'interface',
      name: 'Input',
      original_name: 'Input',
      def: 'v: string',
    },
  ])
  t.true(dts.includes('  export function take(x: Input, y: Input): void\n'))
  t.false(dts.includes('__NapiRsRoot_Input'))
})

test('a top-level type declared after its use from a namespace that shadows it goes through a root alias', async (t) => {
  const { dts } = await processInlineTypeDef([
    {
      kind: 'interface',
      name: 'Late',
      original_name: 'ALate',
      def: 'inner: string',
      js_mod: 'a',
    },
    {
      kind: 'fn',
      name: 'useLate',
      def: 'function useLate(l: Late): number',
      js_mod: 'a',
      unresolved_refs: ['Late'],
    },
    {
      kind: 'interface',
      name: 'Late',
      original_name: 'Late',
      def: 'top: number',
    },
  ])
  t.true(dts.includes('export function useLate(l: __NapiRsRoot_Late): number'))
  t.true(dts.endsWith('\n\ntype __NapiRsRoot_Late = Late\n'))
})

test('a reference to a type whose Rust name two types share is left as written', async (t) => {
  // napi-derive keys types by Rust name, so it may have named the wrong one.
  const { dts } = await processInlineTypeDef([
    {
      kind: 'interface',
      name: 'Shared',
      original_name: 'Shared',
      def: 'inner: string',
      js_mod: 'a',
    },
    {
      kind: 'interface',
      name: 'Shared',
      original_name: 'Shared',
      def: 'top: number',
    },
    {
      kind: 'fn',
      name: 'g',
      def: 'function g(s: Shared): string',
      js_mod: 'a',
      root_refs: ['Shared'],
    },
  ])
  t.true(dts.includes('export function g(s: Shared): string'))
  t.false(dts.includes('__NapiRsRoot'))
})

test('generic types keep their type parameters when references are fixed', async (t) => {
  const { dts } = await processInlineTypeDef([
    {
      kind: 'fn',
      name: 'usePair',
      def: 'function usePair(v: Pair<number>, b: Buffer): number',
      def_with_type_import_markers:
        'function usePair(v: Pair<number>, b: __NAPI_RS_TYPE_IMPORT_BUFFER__): number',
      type_imports: [
        {
          marker: '__NAPI_RS_TYPE_IMPORT_BUFFER__',
          name: 'Buffer',
          module: 'buffer',
        },
      ],
      js_mod: 'y',
      unresolved_refs: ['Pair'],
    },
    {
      kind: 'type',
      name: 'Pair<T>',
      original_name: 'Pair',
      def: 'T | undefined | null',
      js_mod: 'x',
    },
    {
      kind: 'type',
      name: 'Wrap<T = void>',
      original_name: 'Wrap',
      def: 'T | undefined | null',
    },
    {
      kind: 'interface',
      name: 'Wrap',
      original_name: 'SWrap',
      def: 'v: number',
      js_mod: 's',
    },
    {
      kind: 'fn',
      name: 'useWrap',
      def: 'function useWrap(v: Wrap<number>): number',
      js_mod: 's',
      root_refs: ['Wrap'],
    },
  ])
  t.true(
    dts.includes(
      'export function usePair(v: x.Pair<number>, b: Buffer): number',
    ),
  )
  t.true(
    dts.includes(
      'export function useWrap(v: __NapiRsRoot_Wrap<number>): number',
    ),
  )
  t.true(dts.endsWith('\n\ntype __NapiRsRoot_Wrap<T = void> = Wrap<T>\n'))
})

test("a root alias's type parameter defaults are rewritten like the type's own", async (t) => {
  // CodeRabbit on napi-rs/napi-rs#3735: the alias copied `T = LateCfg` as
  // written, while the type itself got `T = models.LateCfg`.
  const { dts } = await processInlineTypeDef([
    {
      kind: 'type',
      name: 'Wrap<T = LateCfg>',
      original_name: 'Wrap',
      def: '[T, LateCfg]',
      unresolved_refs: ['LateCfg'],
    },
    {
      kind: 'interface',
      name: 'Wrap',
      original_name: 'ApiWrap',
      def: 'a: number',
      js_mod: 'api',
    },
    {
      kind: 'fn',
      name: 'take',
      def: 'function take(x: Wrap<number>): number',
      js_mod: 'api',
      root_refs: ['Wrap'],
    },
    {
      kind: 'interface',
      name: 'LateCfg',
      original_name: 'LateCfg',
      def: 'id: number',
      js_mod: 'models',
    },
  ])
  t.true(
    dts.includes(
      'export type Wrap<T = models.LateCfg> = [T, models.LateCfg]\n',
    ),
  )
  t.true(
    dts.includes('export function take(x: __NapiRsRoot_Wrap<number>): number'),
  )
  t.true(
    dts.endsWith('\n\ntype __NapiRsRoot_Wrap<T = models.LateCfg> = Wrap<T>\n'),
  )
})

test('a name the dts header declares counts as resolved', async (t) => {
  const header = 'export interface Config { manual: number }\n'
  const lines = [
    {
      kind: 'fn',
      name: 'loadManual',
      def: 'function loadManual(c: Config): number',
      unresolved_refs: ['Config'],
    },
    {
      kind: 'interface',
      name: 'Config',
      original_name: 'Config',
      def: 'napiOnly: string',
      js_mod: 'x',
    },
  ]
  const withHeader = await processInlineTypeDef(lines, true, false, header)
  t.true(
    withHeader.dts.includes(
      'export declare function loadManual(c: Config): number',
    ),
  )
  const withoutHeader = await processInlineTypeDef(lines)
  t.true(
    withoutHeader.dts.includes(
      'export declare function loadManual(c: x.Config): number',
    ),
  )
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
