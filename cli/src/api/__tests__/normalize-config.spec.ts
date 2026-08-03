import test from 'ava'

import {
  getTypeDefCacheFolder,
  normalizeConfig,
  type NormalizedBinary,
} from '../build.js'
import type { NapiConfig } from '../../utils/index.js'

// `normalizeConfig` is a pure function — no filesystem, no cargo — so the
// multi-binary expansion and all its validation rules are exercised here
// directly, without building anything. The end-to-end runtime behavior (warm
// caches, actual per-binary artifacts) is covered separately by the real-build
// matrix in `multi-binary.spec.ts`.

// Extract the exact parameter types from the function signature so the fixtures
// stay in step with it without re-exporting the internal option type by name.
type Options = Parameters<typeof normalizeConfig>[1]

function makeConfig(overrides: Partial<NapiConfig> = {}): NapiConfig {
  return {
    binaryName: 'index',
    packageName: '@scope/pkg',
    npmClient: 'npm',
    targets: [],
    packageJson: { name: '@scope/pkg', version: '0.0.0' },
    ...overrides,
  }
}

function makeOptions(overrides: Partial<Options> = {}): Options {
  return { cwd: '/project', dtsCache: true, ...overrides } as Options
}

test('no binaries[] returns the single-binary build unchanged', (t) => {
  const config = makeConfig()
  const options = makeOptions({ manifestPath: 'Cargo.toml' })

  const result = normalizeConfig(config, options)

  t.is(result.length, 1)
  t.is(result[0].config, config, 'the config is passed through by reference')
  t.is(
    result[0].options,
    options,
    'the options are passed through by reference',
  )
  t.is(result[0].binaryFolderName, undefined)
})

test('binaries[] expands into one build spec per entry', (t) => {
  const config = makeConfig({
    binaries: [
      {
        name: 'full',
        manifestPath: 'crates/full/Cargo.toml',
        binaryName: 'index',
        js: 'index.js',
        dts: 'index.d.ts',
      },
      {
        name: 'client',
        manifestPath: 'crates/client/Cargo.toml',
        binaryName: 'index-client',
        js: 'index-client.js',
        dts: 'index-client.d.ts',
      },
    ],
  })

  const result = normalizeConfig(config, makeOptions())

  t.is(result.length, 2)

  const [full, client] = result as [NormalizedBinary, NormalizedBinary]
  t.is(full.binaryFolderName, 'full')
  t.is(full.config.binaryName, 'index')
  t.is(full.options.manifestPath, 'crates/full/Cargo.toml')
  t.is(full.options.dts, 'index.d.ts')
  t.is(full.options.jsBinding, 'index.js')
  t.is(full.options.package, undefined)

  t.is(client.binaryFolderName, 'client')
  t.is(client.config.binaryName, 'index-client')
  t.is(client.options.manifestPath, 'crates/client/Cargo.toml')
  t.is(client.options.dts, 'index-client.d.ts')
  t.is(client.options.jsBinding, 'index-client.js')
})

test('an entry omitting binaryName/js/dts inherits the top-level defaults', (t) => {
  const config = makeConfig({
    binaryName: 'top',
    binaries: [{ name: 'only', manifestPath: 'a/Cargo.toml' }],
  })

  const [entry] = normalizeConfig(config, makeOptions({ dts: 'shared.d.ts' }))

  t.is(entry.config.binaryName, 'top', 'binaryName falls back to the top level')
  t.is(entry.options.dts, 'shared.d.ts', 'dts falls back to the base option')
})

test('a `package` entry selects the workspace member and keeps the anchor manifest', (t) => {
  const config = makeConfig({
    binaries: [{ name: 'full', package: 'full-crate', binaryName: 'index' }],
  })

  const [entry] = normalizeConfig(
    config,
    makeOptions({ manifestPath: 'Cargo.toml' }),
  )

  t.is(entry.options.package, 'full-crate')
  t.is(
    entry.options.manifestPath,
    'Cargo.toml',
    'the top-level manifest stays as the workspace anchor for cargo metadata',
  )
})

test('duplicate binary names are rejected', (t) => {
  const config = makeConfig({
    binaries: [
      { name: 'dup', manifestPath: 'a/Cargo.toml', binaryName: 'a' },
      { name: 'dup', manifestPath: 'b/Cargo.toml', binaryName: 'b' },
    ],
  })

  t.throws(() => normalizeConfig(config, makeOptions()), {
    message: /Duplicate `binaries\[\]` name "dup"/,
  })
})

test('two entries writing the same .node artifact are rejected', (t) => {
  const config = makeConfig({
    binaries: [
      { name: 'a', manifestPath: 'a/Cargo.toml', binaryName: 'index' },
      { name: 'b', manifestPath: 'b/Cargo.toml', binaryName: 'index' },
    ],
  })

  t.throws(() => normalizeConfig(config, makeOptions()), {
    message: /both produce the binary name `index`/,
  })
})

test('two entries writing the same dts are rejected', (t) => {
  const config = makeConfig({
    binaries: [
      {
        name: 'a',
        manifestPath: 'a/Cargo.toml',
        binaryName: 'a',
        js: 'a.js',
        dts: 'shared.d.ts',
      },
      {
        name: 'b',
        manifestPath: 'b/Cargo.toml',
        binaryName: 'b',
        js: 'b.js',
        dts: 'shared.d.ts',
      },
    ],
  })

  t.throws(() => normalizeConfig(config, makeOptions()), {
    message: /both produce the type def `shared.d.ts`/,
  })
})

test('two entries defaulting to the same index.js are rejected', (t) => {
  // Neither sets `js`, so both default to `index.js` and would clobber.
  const config = makeConfig({
    binaries: [
      {
        name: 'a',
        manifestPath: 'a/Cargo.toml',
        binaryName: 'a',
        dts: 'a.d.ts',
      },
      {
        name: 'b',
        manifestPath: 'b/Cargo.toml',
        binaryName: 'b',
        dts: 'b.d.ts',
      },
    ],
  })

  t.throws(() => normalizeConfig(config, makeOptions()), {
    message: /both produce the js binding `index.js`/,
  })
})

test('an entry with both manifestPath and package is rejected', (t) => {
  const config = makeConfig({
    binaries: [
      {
        name: 'x',
        manifestPath: 'a/Cargo.toml',
        package: 'a',
        binaryName: 'x',
      },
    ],
  })

  t.throws(() => normalizeConfig(config, makeOptions()), {
    message: /must set exactly one of `manifestPath` or `package` \(got both\)/,
  })
})

test('an entry with neither manifestPath nor package is rejected', (t) => {
  const config = makeConfig({
    binaries: [{ name: 'x', binaryName: 'x' }],
  })

  t.throws(() => normalizeConfig(config, makeOptions()), {
    message:
      /must set exactly one of `manifestPath` or `package` \(got neither\)/,
  })
})

test('a nested binaries array inside an entry is rejected', (t) => {
  const config = makeConfig({
    binaries: [
      {
        name: 'x',
        manifestPath: 'a/Cargo.toml',
        binaryName: 'x',
        // A hand-written JSON config could nest this even though the type forbids it.
        binaries: [{ name: 'y', manifestPath: 'b/Cargo.toml' }],
      } as NonNullable<NapiConfig['binaries']>[number],
    ],
  })

  t.throws(() => normalizeConfig(config, makeOptions()), {
    message: /must not contain a nested `binaries` array/,
  })
})

// A valid two-binary config: each entry writes distinct outputs.
const FULL_CLIENT_BINARIES: NapiConfig['binaries'] = [
  {
    name: 'full',
    manifestPath: 'full/Cargo.toml',
    binaryName: 'index',
    js: 'index.js',
    dts: 'index.d.ts',
  },
  {
    name: 'client',
    manifestPath: 'client/Cargo.toml',
    binaryName: 'index-client',
    js: 'index-client.js',
    dts: 'index-client.d.ts',
  },
]

test('--binary selects exactly the matching entry', (t) => {
  const config = makeConfig({ binaries: FULL_CLIENT_BINARIES })

  const result = normalizeConfig(config, makeOptions({ binary: 'client' }))

  t.is(result.length, 1)
  t.is(result[0].binaryFolderName, 'client')
  t.is(result[0].config.binaryName, 'index-client')
})

test('--binary naming no entry lists the available binaries', (t) => {
  const config = makeConfig({ binaries: FULL_CLIENT_BINARIES })

  t.throws(() => normalizeConfig(config, makeOptions({ binary: 'nope' })), {
    message: /does not match any configured binary\. Available: full, client\./,
  })
})

test('--binary without any binaries[] config is rejected', (t) => {
  t.throws(
    () => normalizeConfig(makeConfig(), makeOptions({ binary: 'full' })),
    { message: /no `binaries` are configured/ },
  )
})

test('--watch combined with binaries[] is rejected', (t) => {
  const config = makeConfig({
    binaries: [
      { name: 'full', manifestPath: 'full/Cargo.toml', binaryName: 'index' },
    ],
  })

  t.throws(() => normalizeConfig(config, makeOptions({ watch: true })), {
    message: /`--watch` cannot be combined with a `binaries\[\]`/,
  })
})

test('the type-def cache folder is stable and independent of any binary name', (t) => {
  const base = {
    targetDir: '/t',
    crateName: 'crate',
    manifestPath: '/c/Cargo.toml',
    targetTriple: 'x86_64-unknown-linux-gnu',
    profile: 'debug',
  }

  t.is(
    getTypeDefCacheFolder(base),
    getTypeDefCacheFolder({ ...base }),
    'the folder is deterministic for identical inputs',
  )
  t.is(
    getTypeDefCacheFolder({ ...base, name: undefined }),
    getTypeDefCacheFolder(base),
    'an undefined name matches the single-binary folder (back-compat)',
  )
})

test('the type-def cache folder differs per binary name for one shared crate', (t) => {
  const base = {
    targetDir: '/t',
    crateName: 'shared',
    manifestPath: '/c/Cargo.toml',
    targetTriple: 'x86_64-unknown-linux-gnu',
    profile: 'debug',
  }

  t.not(
    getTypeDefCacheFolder({ ...base, name: 'full' }),
    getTypeDefCacheFolder({ ...base, name: 'client' }),
    'two binaries built from the same crate get isolated caches',
  )
})
