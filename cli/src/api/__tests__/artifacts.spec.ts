import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import ava, { type TestFn } from 'ava'

import { collectArtifacts } from '../artifacts.js'
import { WASI_ARTIFACT_METADATA_PREFIX } from '../build.js'

const test = ava as TestFn<{ tmpDir: string }>

test.beforeEach(async (t) => {
  const tmpDir = join(
    tmpdir(),
    'napi-rs-test',
    `artifacts-spec-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )

  await mkdir(tmpDir, { recursive: true })
  t.context = { tmpDir }
})

test.afterEach.always(async (t) => {
  if (existsSync(t.context.tmpDir)) {
    await rm(t.context.tmpDir, { recursive: true, force: true })
  }
})

test('resolves a relative WASI build output directory from cwd', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'wasi-artifact'
  const packageName = '@napi-rs/wasi-artifact'
  const buildOutputDir = join(tmpDir, 'build-output')
  const wasiPackageDir = join(tmpDir, 'npm', 'wasm32-wasi')

  await Promise.all([
    mkdir(join(tmpDir, 'artifacts'), { recursive: true }),
    mkdir(buildOutputDir, { recursive: true }),
    mkdir(wasiPackageDir, { recursive: true }),
  ])
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      napi: {
        binaryName,
        targets: ['wasm32-wasi-preview1-threads'],
      },
    }),
  )

  const browserEntry =
    "const worker = new URL('./wasi-worker-browser.mjs', import.meta.url)\n"
  await Promise.all([
    writeFile(
      join(tmpDir, 'artifacts', `${binaryName}.wasm32-wasi.wasm`),
      'wasm artifact',
    ),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), 'node binding'),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'node binding types',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'node worker'),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      browserEntry,
    ),
    writeFile(
      join(buildOutputDir, 'wasi-worker-browser.mjs'),
      'browser worker',
    ),
    writeFile(join(buildOutputDir, 'browser.js'), 'root browser'),
    writeFile(join(buildOutputDir, 'index.js'), 'root index'),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(
    await readFile(
      join(wasiPackageDir, `${binaryName}.wasm32-wasi.wasm`),
      'utf8',
    ),
    'wasm artifact',
  )
  t.is(
    await readFile(join(wasiPackageDir, `${binaryName}.wasi.cjs`), 'utf8'),
    'node binding',
  )
  t.is(
    await readFile(join(wasiPackageDir, 'wasi-worker.mjs'), 'utf8'),
    'node worker',
  )
  t.is(
    await readFile(join(wasiPackageDir, 'wasi-worker-browser.mjs'), 'utf8'),
    'browser worker',
  )
  t.is(
    await readFile(
      join(wasiPackageDir, `${binaryName}.wasi-browser.js`),
      'utf8',
    ),
    browserEntry.replace(
      "new URL('./wasi-worker-browser.mjs', import.meta.url)",
      `new URL('${packageName}-wasm32-wasi/wasi-worker-browser.mjs', import.meta.url)`,
    ),
  )
})

test('keeps the generated WASI root entry when package.json#main is a handwritten wrapper', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'mixed-entry'
  const packageName = '@napi-rs/mixed-entry'
  const artifactsDir = join(tmpDir, 'artifacts')

  // Mirrors packages like @node-rs/bcrypt: `main` points at a handwritten
  // `index.js` wrapper while `napi build --js binding.js` generates the
  // loader under a different name recorded as `rootEntry` in the WASI
  // loader metadata.
  await mkdir(artifactsDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'index.js',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: [
      'browser.js',
      'binding.js',
      `${binaryName}.wasm`,
      `${binaryName}.debug.wasm`,
    ],
  })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(artifactsDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(artifactsDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(artifactsDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(artifactsDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(artifactsDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    // The generated loader sits at the package root alongside the wrapper,
    // next to neither the `.node` artifact nor `package.json#main`.
    writeFile(join(tmpDir, 'binding.js'), 'module.exports = {}\n'),
    writeFile(join(tmpDir, 'index.js'), 'module.exports = {}\n'),
  ])

  await collectArtifacts({ cwd: tmpDir })

  // `binding.js` is a managed root entry that `package.json#main` does not
  // cover; it must be kept rather than swept as a stale destination.
  t.is(
    await readFile(join(tmpDir, 'binding.js'), 'utf8'),
    'module.exports = {}\n',
  )
  t.is(
    await readFile(join(tmpDir, 'index.js'), 'utf8'),
    'module.exports = {}\n',
  )
})

test('the WASI artifact source wins over a stale package-root root entry', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'mixed-entry'
  const packageName = '@napi-rs/mixed-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // Same layout as above but with --build-output-dir: binaries land in
  // `artifacts`, the generated WASI loader set including `binding.js` lands
  // in `build-output`, and the package root holds a stale `binding.js` next
  // to the handwritten `index.js` wrapper. A second stale copy beside the
  // `.node` artifacts must not suppress the WASI-source copy either.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'index.js',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'binding.js'],
  })}\nmodule.exports = {}\n`
  const freshBinding = 'module.exports = { fresh: true }\n'

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(
      join(artifactsDir, 'binding.js'),
      'module.exports = { stale: "native-adjacent" }\n',
    ),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'binding.js'), freshBinding),
    writeFile(join(tmpDir, 'binding.js'), 'module.exports = { stale: true }\n'),
    writeFile(join(tmpDir, 'index.js'), 'module.exports = {}\n'),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  // The artifact-source copy of the generated loader must replace the stale
  // package-root file; the handwritten wrapper is untouched.
  t.is(await readFile(join(tmpDir, 'binding.js'), 'utf8'), freshBinding)
  t.is(
    await readFile(join(tmpDir, 'index.js'), 'utf8'),
    'module.exports = {}\n',
  )
})

test('a WASI-source root entry never replaces the shared native main loader', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'same-entry'
  const packageName = '@napi-rs/same-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // The default layout: `main` is the generated loader `index.js`, which the
  // WASI metadata also records as rootEntry. The `index.js` inside the WASI
  // artifact source is the WASI loader (`*.wasi.cjs` chain), so it must lose
  // to the native loader copies even though all three differ.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'index.js',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'index.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'index.js'],
  })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'index.js'),
      "module.exports = require('./same-entry.wasi.cjs')\n",
    ),
    writeFile(join(tmpDir, 'index.js'), 'module.exports = { native: true }\n'),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  // The committed native loader survives; the WASI-source copy of the same
  // name must not overwrite it.
  t.is(
    await readFile(join(tmpDir, 'index.js'), 'utf8'),
    'module.exports = { native: true }\n',
  )
})

test('a package main like ./binding.js aliases the same root destination', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'alias-entry'
  const packageName = '@napi-rs/alias-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // `main: "./binding.js"` and metadata `rootEntry: "binding.js"` resolve to
  // the same package-root path, so the entry is the shared native loader and
  // the WASI-source copy must not claim it.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './binding.js',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'binding.js'],
  })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'binding.js'),
      "module.exports = require('./alias-entry.wasi.cjs')\n",
    ),
    writeFile(
      join(tmpDir, 'binding.js'),
      'module.exports = { native: true }\n',
    ),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(
    await readFile(join(tmpDir, 'binding.js'), 'utf8'),
    'module.exports = { native: true }\n',
  )
})

test('a symlinked parent cannot redirect a root entry outside the package root', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'link-entry'
  const packageName = '@napi-rs/link-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const siblingDir = join(tmpDir, '..', `sibling-${Date.now()}`)

  // `nested/binding.js` passes the lexical `..` check, but `nested` is a
  // symlink to a sibling directory, so the canonical destination leaves the
  // package root even though it stays inside the transaction boundary.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(siblingDir, { recursive: true })
  await symlink(siblingDir, join(tmpDir, 'nested'))
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'index.js',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'nested/binding.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'nested/binding.js'],
  })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(artifactsDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(artifactsDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(artifactsDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(artifactsDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(artifactsDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(join(tmpDir, 'index.js'), 'module.exports = {}\n'),
  ])

  try {
    await t.throwsAsync(collectArtifacts({ cwd: tmpDir }), {
      message: /resolves outside the package root/,
    })
    t.false(existsSync(join(siblingDir, 'binding.js')))
  } finally {
    await rm(siblingDir, { recursive: true, force: true })
  }
})

test('a WASI-declared index.js resolves from the artifact source when main is a different wrapper', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'index-entry'
  const packageName = '@napi-rs/index-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // `main` points at a handwritten `wrapper.js` and the WASI loader metadata
  // declares `index.js` as its generated root entry. `index.js` is only a
  // shared name when it is the effective main; here it is a distinct WASI
  // root entry that must resolve from the build output, not from the stale
  // package-root copy.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'wrapper.js',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'index.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'index.js'],
  })}\nmodule.exports = {}\n`
  const freshIndex = "module.exports = require('./index-entry.wasi.cjs')\n"

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'index.js'), freshIndex),
    writeFile(join(tmpDir, 'index.js'), 'module.exports = { stale: true }\n'),
    writeFile(
      join(tmpDir, 'wrapper.js'),
      'module.exports = { native: true }\n',
    ),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  // The WASI-source copy of the declared `index.js` replaces the stale
  // package-root file; the handwritten wrapper stays untouched.
  t.is(await readFile(join(tmpDir, 'index.js'), 'utf8'), freshIndex)
  t.is(
    await readFile(join(tmpDir, 'wrapper.js'), 'utf8'),
    'module.exports = { native: true }\n',
  )
})

test('a distinct root entry follows the threaded root loader across WASI flavors', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'flavor-entry'
  const packageName = '@napi-rs/flavor-entry'
  const nativeDir = join(tmpDir, 'artifacts', 'native')
  const threadlessDir = join(tmpDir, 'artifacts', 'wasip1')
  const threadsDir = join(tmpDir, 'artifacts', 'threads')

  // Both WASI flavors are configured, the threadless target first. The root
  // loader comes from the threaded target, so the generated `binding.js`
  // must come from the threaded source too: each flavor's copy embeds
  // loader references for its own `*.wasi.cjs` chain.
  await Promise.all([
    mkdir(nativeDir, { recursive: true }),
    mkdir(threadlessDir, { recursive: true }),
    mkdir(threadsDir, { recursive: true }),
  ])
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'index.js',
      napi: {
        binaryName,
        targets: [
          'x86_64-unknown-linux-gnu',
          'wasm32-wasip1',
          'wasm32-wasip1-threads',
        ],
      },
    }),
  )

  const loaderFor = (rootEntryFlavor: string) =>
    `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
      version: 2,
      rootEntry: 'binding.js',
      exports: ['create'],
      managedRootEntries: ['browser.js', 'binding.js'],
    })}\nmodule.exports = { flavor: '${rootEntryFlavor}' }\n`

  await Promise.all([
    writeFile(join(nativeDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(
      join(threadsDir, `${binaryName}.wasm32-wasi.wasm`),
      'threads wasm',
    ),
    writeFile(join(threadsDir, `${binaryName}.wasi.cjs`), loaderFor('threads')),
    writeFile(
      join(threadsDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(join(threadsDir, `${binaryName}.wasi-browser.js`), 'export {}\n'),
    writeFile(join(threadsDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(threadsDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(threadsDir, 'binding.js'),
      "module.exports = require('./flavor-entry.wasi.cjs')\n",
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasm32-wasip1.wasm`),
      'threadless wasm',
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasip1.cjs`),
      loaderFor('wasip1'),
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasip1.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasip1-browser.js`),
      'export {}\n',
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasip1-deferred.js`),
      'export {}\n',
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasip1-deferred.d.ts`),
      'export {}\n',
    ),
    writeFile(
      join(threadlessDir, 'binding.js'),
      "module.exports = require('./flavor-entry.wasip1.cjs')\n",
    ),
    writeFile(join(tmpDir, 'index.js'), 'module.exports = { native: true }\n'),
  ])

  await collectArtifacts({ cwd: tmpDir })

  // The published root entry must match the threaded root loader even
  // though the threadless target is configured first.
  t.is(
    await readFile(join(tmpDir, 'binding.js'), 'utf8'),
    "module.exports = require('./flavor-entry.wasi.cjs')\n",
  )
})

test('a main specifier Node resolves to a declared root entry stays shared', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'extless-entry'
  const packageName = '@napi-rs/extless-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // CommonJS `main` resolution maps `./binding` to `binding.js`, so the
  // WASI-declared `binding.js` is the native root entry — the WASI-source
  // copy is the WASI loader chain and must never claim that destination.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './binding',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'binding.js'],
  })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'binding.js'),
      "module.exports = require('./extless-entry.wasi.cjs')\n",
    ),
    writeFile(
      join(tmpDir, 'binding.js'),
      'module.exports = { native: true }\n',
    ),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(
    await readFile(join(tmpDir, 'binding.js'), 'utf8'),
    'module.exports = { native: true }\n',
  )
})

test('a directory main keeps its index.js shared with the native root entry', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'dir-entry'
  const packageName = '@napi-rs/dir-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // `main: "./dist"` resolves via the directory lookup to `dist/index.js`,
  // so a WASI-declared `dist/index.js` is the native root entry and the
  // WASI-source copy must not claim it.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(join(buildOutputDir, 'dist'), { recursive: true })
  await mkdir(join(tmpDir, 'dist'), { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './dist',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'dist/index.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'dist/index.js'],
  })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'dist', 'index.js'),
      "module.exports = require('./dir-entry.wasi.cjs')\n",
    ),
    writeFile(
      join(tmpDir, 'dist', 'index.js'),
      'module.exports = { native: true }\n',
    ),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(
    await readFile(join(tmpDir, 'dist', 'index.js'), 'utf8'),
    'module.exports = { native: true }\n',
  )
})

test('a file shadowing a directory main leaves the declared entry distinct', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'shadow-entry'
  const packageName = '@napi-rs/shadow-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // `main: "./dist"` resolves to `dist.js` because the file exists, so the
  // directory lookup never runs and `dist/index.js` is not the package
  // entry. The WASI-declared `dist/index.js` is a distinct generated file
  // and resolves from the build output, replacing the stale root copy.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(join(buildOutputDir, 'dist'), { recursive: true })
  await mkdir(join(tmpDir, 'dist'), { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './dist',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'dist/index.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'dist/index.js'],
  })}\nmodule.exports = {}\n`
  const freshIndex = "module.exports = require('./shadow-entry.wasi.cjs')\n"

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'dist', 'index.js'), freshIndex),
    writeFile(join(tmpDir, 'dist.js'), 'module.exports = { native: true }\n'),
    writeFile(
      join(tmpDir, 'dist', 'index.js'),
      'module.exports = { stale: true }\n',
    ),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(await readFile(join(tmpDir, 'dist', 'index.js'), 'utf8'), freshIndex)
  t.is(
    await readFile(join(tmpDir, 'dist.js'), 'utf8'),
    'module.exports = { native: true }\n',
  )
})

test('a self-referential directory main resolves to index.js', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'self-entry'
  const packageName = '@napi-rs/self-entry'
  const artifactsDir = join(tmpDir, 'artifacts')

  // `main: "."` names the package directory itself; its own package.json
  // main points back at the same directory, which Node resolves as
  // index.js. Collection must terminate instead of recursing through the
  // same manifest forever.
  await mkdir(artifactsDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: '.',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu'],
      },
    }),
  )

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(tmpDir, 'index.js'), 'module.exports = { native: true }\n'),
  ])

  await collectArtifacts({ cwd: tmpDir })

  t.is(
    await readFile(join(tmpDir, 'index.js'), 'utf8'),
    'module.exports = { native: true }\n',
  )
})

test('a main resolved through the native artifacts keeps the native loader', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'clean-entry'
  const packageName = '@napi-rs/clean-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // The package root has no pre-existing loader: `main: "./binding"`
  // resolves to `binding.js`, which ships inside the native artifacts. The
  // WASI metadata declares the same name, but the resolved entry is the
  // native loader — publishing the WASI-source copy would make `require`
  // of the package main load the WASM build.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './binding',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'binding.js'],
  })}\nmodule.exports = {}\n`
  const nativeBinding =
    "module.exports = require('./clean-entry.linux-x64-gnu.node')\n"

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(artifactsDir, 'binding.js'), nativeBinding),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'binding.js'),
      "module.exports = require('./clean-entry.wasi.cjs')\n",
    ),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  // The resolved main entry comes from the native artifacts, not the
  // WASI-source copy of the same name.
  t.is(await readFile(join(tmpDir, 'binding.js'), 'utf8'), nativeBinding)
})

test('an existing extensionless main shadows the declared extension variant', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'exact-entry'
  const packageName = '@napi-rs/exact-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // `main: "./binding"` resolves to the extensionless file `binding`
  // because it exists, so `binding.js` is unreachable as the package
  // entry. The WASI-declared `binding.js` is a distinct generated file and
  // resolves from the build output, replacing the stale root copy.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './binding',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'binding.js'],
  })}\nmodule.exports = {}\n`
  const freshBinding = "module.exports = require('./exact-entry.wasi.cjs')\n"

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'binding.js'), freshBinding),
    writeFile(join(tmpDir, 'binding'), 'module.exports = { exact: true }\n'),
    writeFile(join(tmpDir, 'binding.js'), 'module.exports = { stale: true }\n'),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(await readFile(join(tmpDir, 'binding.js'), 'utf8'), freshBinding)
  t.is(
    await readFile(join(tmpDir, 'binding'), 'utf8'),
    'module.exports = { exact: true }\n',
  )
})

test('an exports entry target shares its name with the native root entry', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'exports-entry'
  const packageName = '@napi-rs/exports-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // `exports["."]` resolves ahead of `main`, so `entry.js` is the package
  // entry even though `main` names a wrapper. The WASI metadata declares
  // the same name; the native artifact copy must win over the WASI-source
  // loader chain.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'wrapper.js',
      exports: { '.': './entry.js' },
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'entry.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'entry.js'],
  })}\nmodule.exports = {}\n`
  const nativeEntry =
    "module.exports = require('./exports-entry.linux-x64-gnu.node')\n"

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(artifactsDir, 'entry.js'), nativeEntry),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'entry.js'),
      "module.exports = require('./exports-entry.wasi.cjs')\n",
    ),
    writeFile(join(tmpDir, 'wrapper.js'), 'module.exports = { wrap: true }\n'),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(await readFile(join(tmpDir, 'entry.js'), 'utf8'), nativeEntry)
})

test('a missing nested main falls back to the directory index', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'nested-miss'
  const packageName = '@napi-rs/nested-miss'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // `main: "./dist"` finds `dist/package.json` whose `main` points at a
  // file that does not exist. Node then falls back to `dist/index.js`, so
  // the WASI-declared `dist/index.js` shares the native root entry and the
  // WASI-source copy must not overwrite the existing native file.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(join(buildOutputDir, 'dist'), { recursive: true })
  await mkdir(join(tmpDir, 'dist'), { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './dist',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )
  await writeFile(
    join(tmpDir, 'dist', 'package.json'),
    JSON.stringify({ main: './lib.js' }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'dist/index.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'dist/index.js'],
  })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'dist', 'index.js'),
      "module.exports = require('./nested-miss.wasi.cjs')\n",
    ),
    writeFile(
      join(tmpDir, 'dist', 'index.js'),
      'module.exports = { native: true }\n',
    ),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(
    await readFile(join(tmpDir, 'dist', 'index.js'), 'utf8'),
    'module.exports = { native: true }\n',
  )
})

test('a condition-only exports map shares the declared root entry', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'cond-entry'
  const packageName = '@napi-rs/cond-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // A condition-only exports map has no '.' key but still declares the
  // package entry. The WASI-declared `binding.js` shares the native root
  // entry, so the WASI-source copy never claims it.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      exports: { node: './binding.js', default: './binding.js' },
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'binding.js'],
  })}\nmodule.exports = {}\n`
  const nativeBinding =
    "module.exports = require('./cond-entry.linux-x64-gnu.node')\n"

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(artifactsDir, 'binding.js'), nativeBinding),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'binding.js'),
      "module.exports = require('./cond-entry.wasi.cjs')\n",
    ),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(await readFile(join(tmpDir, 'binding.js'), 'utf8'), nativeBinding)
})

test('auxiliary export targets do not consume the native root slot', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'typed-entry'
  const packageName = '@napi-rs/typed-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // `types` lists first in the conditional map, but a declaration file is
  // not a runtime entry. The native scan must still copy `binding.js` from
  // the artifacts rather than stopping at the `.d.ts`.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './binding.js',
      exports: {
        '.': {
          types: './binding.d.ts',
          default: './binding.js',
        },
      },
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'binding.js'],
  })}\nmodule.exports = {}\n`
  const nativeBinding =
    "module.exports = require('./typed-entry.linux-x64-gnu.node')\n"

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(artifactsDir, 'binding.js'), nativeBinding),
    writeFile(join(artifactsDir, 'binding.d.ts'), 'declare const x: 1\n'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'binding.js'),
      "module.exports = require('./typed-entry.wasi.cjs')\n",
    ),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(await readFile(join(tmpDir, 'binding.js'), 'utf8'), nativeBinding)
})

test('a stale managed entry cannot escape the package root through a symlink', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'escape-entry'
  const packageName = '@napi-rs/escape-entry'
  const packageDir = join(tmpDir, 'pkg')
  const siblingDir = join(tmpDir, 'sibling')
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(packageDir, 'build-output')

  // The old loader at the package root recorded `linked/old.js` as a
  // managed root entry. `linked` is now a symlink into a sibling package,
  // so deleting the stale entry must not follow the link.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await mkdir(siblingDir, { recursive: true })
  await mkdir(join(packageDir), { recursive: true })
  await symlink(siblingDir, join(packageDir, 'linked'))
  await writeFile(join(siblingDir, 'old.js'), 'module.exports = {}\n')
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'index.js',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const oldLoader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'linked/old.js',
    managedRootEntries: ['browser.js', 'linked/old.js'],
  })}\nmodule.exports = {}\n`
  const newLoader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'binding.js'],
  })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(packageDir, `${binaryName}.wasi.cjs`), oldLoader),
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), newLoader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'binding.js'), 'module.exports = {}\n'),
    writeFile(
      join(packageDir, 'index.js'),
      'module.exports = { native: true }\n',
    ),
  ])

  await collectArtifacts({
    cwd: packageDir,
    outputDir: artifactsDir,
    buildOutputDir: 'build-output',
  })

  // The sibling file survives: the stale managed entry resolves outside
  // the package root through the symlink and is skipped.
  t.is(
    await readFile(join(siblingDir, 'old.js'), 'utf8'),
    'module.exports = {}\n',
  )
})

test('an extensionless declared main entry is copied from native artifacts', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'bare-entry'
  const packageName = '@napi-rs/bare-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // `main: "./binding"` resolves to the extensionless file `binding`, which
  // ships in the native artifacts. The WASI metadata declares the same
  // name, so the entry is shared and the native copy must reach the
  // package root — filtering it out of the scan because it lacks an
  // extension would fail collection instead.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './binding',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'binding'],
  })}\nmodule.exports = {}\n`
  const nativeBinding =
    "module.exports = require('./bare-entry.linux-x64-gnu.node')\n"

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(artifactsDir, 'binding'), nativeBinding),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'binding'),
      "module.exports = require('./bare-entry.wasi.cjs')\n",
    ),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(await readFile(join(tmpDir, 'binding'), 'utf8'), nativeBinding)
})

test('a dying managed entry does not shadow a declared main resolution', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'moved-entry'
  const packageName = '@napi-rs/moved-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // The previous loader managed `dist.js` at the package root; the new
  // contract declares `dist/index.js`. The transaction deletes `dist.js`,
  // so `main: "./dist"` resolves through the directory form and
  // `dist/index.js` is shared — the WASI-source copy must not overwrite
  // the native loader that wins after `dist.js` is gone.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(join(buildOutputDir, 'dist'), { recursive: true })
  await mkdir(join(tmpDir, 'dist'), { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './dist',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const oldLoader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'dist.js',
    managedRootEntries: ['browser.js', 'dist.js'],
  })}\nmodule.exports = {}\n`
  const newLoader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'dist/index.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'dist/index.js'],
  })}\nmodule.exports = {}\n`
  const nativeIndex = 'module.exports = { native: true }\n'

  await Promise.all([
    writeFile(join(tmpDir, `${binaryName}.wasi.cjs`), oldLoader),
    writeFile(join(tmpDir, 'dist.js'), 'module.exports = { old: true }\n'),
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), newLoader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'dist', 'index.js'),
      "module.exports = require('./moved-entry.wasi.cjs')\n",
    ),
    writeFile(join(tmpDir, 'dist', 'index.js'), nativeIndex),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  // The surviving main resolution is the native `dist/index.js`; the stale
  // managed `dist.js` is removed rather than shadowing it.
  t.is(await readFile(join(tmpDir, 'dist', 'index.js'), 'utf8'), nativeIndex)
  t.false(existsSync(join(tmpDir, 'dist.js')))
})

test('an unresolvable main falls back to the package-root index.js', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'fallback-entry'
  const packageName = '@napi-rs/fallback-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // `main` points at a file that exists nowhere, so Node falls back to the
  // package-root `index.js`. The WASI-declared `index.js` shares that
  // entry: the native root file survives and the WASI-source copy must
  // not replace it.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: './gone.js',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'index.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'index.js'],
  })}\nmodule.exports = {}\n`
  const nativeIndex =
    "module.exports = require('./fallback-entry.linux-x64-gnu.node')\n"

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(buildOutputDir, 'index.js'),
      "module.exports = require('./fallback-entry.wasi.cjs')\n",
    ),
    writeFile(join(tmpDir, 'index.js'), nativeIndex),
  ])

  await collectArtifacts({
    cwd: tmpDir,
    buildOutputDir: 'build-output',
  })

  t.is(await readFile(join(tmpDir, 'index.js'), 'utf8'), nativeIndex)
})

test('conflicting WASI root entry declarations are rejected', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'skewed-entry'
  const packageName = '@napi-rs/skewed-entry'
  const nativeDir = join(tmpDir, 'artifacts', 'native')
  const threadlessDir = join(tmpDir, 'artifacts', 'wasip1')
  const threadsDir = join(tmpDir, 'artifacts', 'threads')

  // The flavors were built with different `--js` names, so their root-entry
  // contracts cannot be spliced into one coherent package. Splicing would
  // let a stale same-named file in the preferred source satisfy a contract
  // it never declared.
  await Promise.all([
    mkdir(nativeDir, { recursive: true }),
    mkdir(threadlessDir, { recursive: true }),
    mkdir(threadsDir, { recursive: true }),
  ])
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'index.js',
      napi: {
        binaryName,
        targets: [
          'x86_64-unknown-linux-gnu',
          'wasm32-wasip1',
          'wasm32-wasip1-threads',
        ],
      },
    }),
  )

  const loaderFor = (rootEntry: string) =>
    `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
      version: 2,
      rootEntry,
      exports: ['create'],
      managedRootEntries: ['browser.js', rootEntry],
    })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(nativeDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(
      join(threadsDir, `${binaryName}.wasm32-wasi.wasm`),
      'threads wasm',
    ),
    writeFile(
      join(threadsDir, `${binaryName}.wasi.cjs`),
      loaderFor('binding.js'),
    ),
    writeFile(
      join(threadsDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(join(threadsDir, `${binaryName}.wasi-browser.js`), 'export {}\n'),
    writeFile(join(threadsDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(threadsDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(
      join(threadlessDir, `${binaryName}.wasm32-wasip1.wasm`),
      'threadless wasm',
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasip1.cjs`),
      loaderFor('index.js'),
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasip1.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasip1-browser.js`),
      'export {}\n',
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasip1-deferred.js`),
      'export {}\n',
    ),
    writeFile(
      join(threadlessDir, `${binaryName}.wasip1-deferred.d.ts`),
      'export {}\n',
    ),
    writeFile(join(tmpDir, 'index.js'), 'module.exports = { native: true }\n'),
  ])

  await t.throwsAsync(collectArtifacts({ cwd: tmpDir }), {
    message: /conflicting root entries/,
  })
})

test('an explicit build output without the declared root entry is rejected', async (t) => {
  const { tmpDir } = t.context
  const binaryName = 'strict-entry'
  const packageName = '@napi-rs/strict-entry'
  const artifactsDir = join(tmpDir, 'artifacts')
  const buildOutputDir = join(tmpDir, 'build-output')

  // --build-output-dir makes the WASI output authoritative: its loader
  // metadata declares binding.js, the directory does not contain it, and a
  // stale package-root copy must not paper over the incomplete source.
  await mkdir(artifactsDir, { recursive: true })
  await mkdir(buildOutputDir, { recursive: true })
  await writeFile(
    join(tmpDir, 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '0.0.0',
      main: 'index.js',
      napi: {
        binaryName,
        targets: ['x86_64-unknown-linux-gnu', 'wasm32-wasip1-threads'],
      },
    }),
  )

  const loader = `${WASI_ARTIFACT_METADATA_PREFIX}${JSON.stringify({
    version: 2,
    rootEntry: 'binding.js',
    exports: ['create'],
    managedRootEntries: ['browser.js', 'binding.js'],
  })}\nmodule.exports = {}\n`

  await Promise.all([
    writeFile(join(artifactsDir, `${binaryName}.linux-x64-gnu.node`), 'bin'),
    writeFile(join(artifactsDir, `${binaryName}.wasm32-wasi.wasm`), 'wasm'),
    writeFile(join(buildOutputDir, `${binaryName}.wasi.cjs`), loader),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi.d.cts`),
      'declare const _default: {}\nexport = _default\n',
    ),
    writeFile(
      join(buildOutputDir, `${binaryName}.wasi-browser.js`),
      'export {}\n',
    ),
    writeFile(join(buildOutputDir, 'wasi-worker.mjs'), 'export {}\n'),
    writeFile(join(buildOutputDir, 'wasi-worker-browser.mjs'), 'export {}\n'),
    writeFile(join(tmpDir, 'binding.js'), 'module.exports = { stale: true }\n'),
    writeFile(join(tmpDir, 'index.js'), 'module.exports = {}\n'),
  ])

  await t.throwsAsync(
    collectArtifacts({ cwd: tmpDir, buildOutputDir: 'build-output' }),
    { message: /does not contain it/ },
  )
})
