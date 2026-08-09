import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runtimeDirectory = dirname(fileURLToPath(import.meta.url))

const writeModulePackage = async (
  fixtureDirectory,
  packageName,
  version,
  esmSource,
  cjsSource,
  extraExports = {},
) => {
  const packageDirectory = join(
    fixtureDirectory,
    'node_modules',
    ...packageName.split('/'),
  )
  await mkdir(packageDirectory, { recursive: true })
  await Promise.all([
    writeFile(
      join(packageDirectory, 'package.json'),
      JSON.stringify({
        name: packageName,
        version,
        type: 'module',
        exports: {
          '.': {
            import: './index.js',
            require: './index.cjs',
          },
          ...extraExports,
        },
      }),
    ),
    writeFile(join(packageDirectory, 'index.js'), esmSource),
    writeFile(join(packageDirectory, 'index.cjs'), cjsSource),
  ])
}

const createRuntimeFixture = async (generation) => {
  const fixtureDirectory = await mkdtemp(
    join(tmpdir(), `napi-rs-wasm-runtime-${generation}-`),
  )
  const emnapiVersion = generation === 'v1' ? '1.11.1' : '2.0.0-alpha.3'

  await Promise.all([
    mkdir(join(fixtureDirectory, 'dist'), { recursive: true }),
    writeFile(
      join(fixtureDirectory, 'package.json'),
      JSON.stringify({ type: 'module' }),
    ),
    cp(
      join(runtimeDirectory, 'runtime.cjs'),
      join(fixtureDirectory, 'runtime.cjs'),
    ),
    cp(
      join(runtimeDirectory, 'runtime.js'),
      join(fixtureDirectory, 'runtime.js'),
    ),
    cp(
      join(runtimeDirectory, 'dist', 'emnapi-plugins.cjs'),
      join(fixtureDirectory, 'dist', 'emnapi-plugins.cjs'),
    ),
    cp(
      join(runtimeDirectory, 'dist', 'emnapi-plugins.js'),
      join(fixtureDirectory, 'dist', 'emnapi-plugins.js'),
    ),
    writeFile(
      join(fixtureDirectory, 'fs-proxy.js'),
      `export const createFsProxy = () => 'fs-proxy-${generation}'
export const createOnMessage = () => 'on-message-${generation}'
`,
    ),
    writeFile(
      join(fixtureDirectory, 'dist', 'fs-proxy.cjs'),
      `module.exports = {
  createFsProxy: () => 'fs-proxy-${generation}',
  createOnMessage: () => 'on-message-${generation}',
}
`,
    ),
  ])

  const unavailablePluginExport =
    generation === 'v1'
      ? {}
      : {
          './plugins': {
            import: './plugins.js',
            require: './plugins.cjs',
          },
        }

  await Promise.all([
    writeModulePackage(
      fixtureDirectory,
      '@emnapi/core',
      emnapiVersion,
      `export const version = '${emnapiVersion}'
export class MessageHandler {
  static generation = '${generation}'
}
export const instantiateNapiModule = () => 'async-${generation}'
export const instantiateNapiModuleSync = () => 'sync-${generation}'
`,
      `module.exports = {
  version: '${emnapiVersion}',
  MessageHandler: class MessageHandler {
    static generation = '${generation}'
  },
  instantiateNapiModule: () => 'async-${generation}',
  instantiateNapiModuleSync: () => 'sync-${generation}',
}
`,
      unavailablePluginExport,
    ),
    writeModulePackage(
      fixtureDirectory,
      '@emnapi/runtime',
      emnapiVersion,
      `export const createContext = () => 'context-${generation}'
export const getDefaultContext = () => 'default-context-${generation}'
`,
      `module.exports = {
  createContext: () => 'context-${generation}',
  getDefaultContext: () => 'default-context-${generation}',
}
`,
    ),
    writeModulePackage(
      fixtureDirectory,
      '@tybys/wasm-util',
      '0.10.3',
      `export class WASI {
  static generation = '${generation}'
}
export const wasmUtilGeneration = '${generation}'
`,
      `module.exports = {
  WASI: class WASI {
    static generation = '${generation}'
  },
  wasmUtilGeneration: '${generation}',
}
`,
    ),
  ])

  if (generation === 'v2') {
    const coreDirectory = join(
      fixtureDirectory,
      'node_modules',
      '@emnapi',
      'core',
    )
    await Promise.all([
      writeFile(
        join(coreDirectory, 'plugins.js'),
        `throw new Error('runtime must use its bundled emnapi plugins')\n`,
      ),
      writeFile(
        join(coreDirectory, 'plugins.cjs'),
        `throw new Error('runtime must use its bundled emnapi plugins')\n`,
      ),
    ])
  }

  return fixtureDirectory
}

const assertRuntimeExports = (runtime, generation) => {
  assert.equal(runtime.MessageHandler.generation, generation)
  assert.equal(runtime.instantiateNapiModule(), `async-${generation}`)
  assert.equal(runtime.instantiateNapiModuleSync(), `sync-${generation}`)
  assert.equal(runtime.createContext(), `context-${generation}`)
  assert.equal(runtime.getDefaultContext(), `default-context-${generation}`)
  assert.equal(typeof runtime.emnapiAsyncWorkPlugin, 'function')
  assert.equal(typeof runtime.emnapiTSFNPlugin, 'function')
  assert.equal(runtime.WASI.generation, generation)
  assert.equal(runtime.createFsProxy(), `fs-proxy-${generation}`)
  assert.equal(runtime.createOnMessage(), `on-message-${generation}`)
}

for (const generation of ['v1', 'v2']) {
  test(`loads ${generation} emnapi packages from CommonJS and ESM`, async (t) => {
    const fixtureDirectory = await createRuntimeFixture(generation)
    t.after(() => rm(fixtureDirectory, { force: true, recursive: true }))

    const fixtureRequire = createRequire(
      join(fixtureDirectory, 'test-entry.cjs'),
    )
    const commonjsRuntime = fixtureRequire(
      join(fixtureDirectory, 'runtime.cjs'),
    )
    assertRuntimeExports(commonjsRuntime, generation)

    const esmRuntime = await import(
      pathToFileURL(join(fixtureDirectory, 'runtime.js')).href
    )
    assertRuntimeExports(esmRuntime, generation)
    assert.equal(esmRuntime.wasmUtilGeneration, generation)
  })
}
