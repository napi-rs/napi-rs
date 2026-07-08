import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import test from 'ava'
import typeScript from 'typescript'

import {
  formatGeneratedOutputs,
  preserveLifecycleDeclarations,
  regenerateArtifacts,
} from '../build.mjs'
import { unsupportedWasiFunctions } from '../unsupported-wasi-exports.mjs'

test('generated threadless outputs are finalized with repository formatting', async (t) => {
  const directory = await mkdtemp(
    join(import.meta.dirname, '..', '.generated-format-'),
  )
  const browserPath = join(directory, 'example.wasip1-browser.js')
  const declarationPath = join(directory, 'example.wasip1-deferred.d.ts')
  try {
    await Promise.all([
      writeFile(
        browserPath,
        'export const binding={value:"threadless",nested:{enabled:true}}\n',
      ),
      writeFile(
        declarationPath,
        'export type WasiModuleInput=WebAssembly.Module|PromiseLike<WebAssembly.Module>\n',
      ),
    ])

    await formatGeneratedOutputs([browserPath, declarationPath])

    t.is(
      await readFile(browserPath, 'utf8'),
      "export const binding = { value: 'threadless', nested: { enabled: true } }\n",
    )
    t.is(
      await readFile(declarationPath, 'utf8'),
      'export type WasiModuleInput =\n  WebAssembly.Module | PromiseLike<WebAssembly.Module>\n',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('checked threaded artifacts retain the WASI export surface and portable stubs', async (t) => {
  const directory = join(import.meta.dirname, '..')
  const [
    browserSource,
    nodeSource,
    declarationSource,
    rootSource,
    rootBrowserSource,
  ] = await Promise.all([
    readFile(join(directory, 'example.wasi-browser.js'), 'utf8'),
    readFile(join(directory, 'example.wasi.cjs'), 'utf8'),
    readFile(join(directory, 'example.wasi.d.cts'), 'utf8'),
    readFile(join(directory, 'index.cjs'), 'utf8'),
    readFile(join(directory, 'browser.js'), 'utf8'),
  ])
  const deferredSource = await readFile(
    join(directory, 'example.wasip1-deferred.js'),
    'utf8',
  )
  const wasiOnlyExports = [
    'dropUnregisteredWeakTsfnForWasi',
    'startTokioWakerAfterCleanupProbe',
  ]

  for (const name of wasiOnlyExports) {
    t.regex(
      browserSource,
      new RegExp(
        `export const ${name}\\s*=\\s*__napiModule\\.exports\\.${name}`,
      ),
      name,
    )
    t.regex(
      nodeSource,
      new RegExp(
        `module\\.exports\\.${name}\\s*=\\s*__napiModule\\.exports\\.${name}`,
      ),
      name,
    )
    t.regex(
      declarationSource,
      new RegExp(`export declare function ${name}\\(`),
      name,
    )
  }

  for (const name of unsupportedWasiFunctions) {
    t.regex(
      declarationSource,
      new RegExp(
        `export declare function ${name}\\(\\s*\\.\\.\\.args:\\s*unknown\\[\\]\\s*\\):\\s*never`,
      ),
      name,
    )
  }
  t.false(declarationSource.includes('undici-types'))
  for (const name of unsupportedWasiFunctions) {
    t.true(deferredSource.includes(`'${name}',`), name)
  }
  t.true(
    deferredSource.includes(
      '__napiModule.exports[name] = getDeferredWasiBindingExport(',
    ),
  )
  t.regex(rootSource, /['"]wasm32-wasi['"]/)
  t.regex(rootSource, /['"]wasm32-wasip1['"]/)
  t.is(rootBrowserSource, "export * from '@examples/napi-wasm32-wasip1'\n")
})

test('artifact regeneration isolates the native pass from Cargo target environment', async (t) => {
  const state = {
    'browser.js': 'initial browser JavaScript',
    'index.cjs': 'initial root JavaScript',
    'index.d.cts': 'initial root declarations',
    'example.wasip1-browser.js': 'initial threadless browser JavaScript',
    'example.wasip1.cjs': 'initial threadless JavaScript',
    'example.wasip1.d.cts': 'initial threadless declarations',
    'example.wasi-browser.js': 'initial threaded browser JavaScript',
    'example.wasi.cjs': 'initial threaded JavaScript',
    'example.wasi.d.cts': 'initial threaded declarations',
  }
  const inheritedEnvironment = {
    CARGO_BUILD_TARGET: 'wasm32-wasip1',
    PATH: '/test/path',
  }
  const builds: Array<{
    arguments_: string[]
    cargoBuildTarget: string | undefined
    path: string | undefined
  }> = []
  let restoredFiles: string[] = []

  await regenerateArtifacts({
    environment: inheritedEnvironment,
    runBuild: async (arguments_, environment) => {
      if (environment === undefined) {
        t.fail('regeneration did not provide an isolated build environment')
        return
      }
      builds.push({
        arguments_,
        cargoBuildTarget: environment.CARGO_BUILD_TARGET,
        path: environment.PATH,
      })
      const targetIndex = arguments_.indexOf('--target')
      const flavor =
        targetIndex === -1
          ? (environment.CARGO_BUILD_TARGET ?? 'native')
          : arguments_[targetIndex + 1]
      state['index.cjs'] = `${flavor} root JavaScript`
      state['index.d.cts'] = `${flavor} root declarations`
      if (flavor === 'wasm32-wasip1') {
        state['browser.js'] = `${flavor} root browser JavaScript`
        state['example.wasip1-browser.js'] =
          `${flavor} threadless browser JavaScript`
        state['example.wasip1.cjs'] = `${flavor} threadless JavaScript`
        state['example.wasip1.d.cts'] = `${flavor} threadless declarations`
      } else {
        state['browser.js'] = `${flavor} root browser JavaScript`
        state['example.wasi-browser.js'] =
          `${flavor} threaded browser JavaScript`
        state['example.wasi.cjs'] = `${flavor} threaded JavaScript`
        state['example.wasi.d.cts'] = `${flavor} threaded declarations`
      }
    },
    readRootOutputs: async () => ({
      'index.cjs': state['index.cjs'],
      'index.d.cts': state['index.d.cts'],
    }),
    restoreRootOutputs: async (outputs) => {
      restoredFiles = Object.keys(outputs).sort()
      Object.assign(state, outputs)
    },
    readRetainedFlavorOutputs: async () =>
      Object.fromEntries(
        Object.entries(state).filter(
          ([file]) => file === 'browser.js' || file.includes('.wasip1'),
        ),
      ),
    restoreRetainedFlavorOutputs: async (outputs) => {
      Object.assign(state, outputs)
    },
  })

  t.deepEqual(builds, [
    {
      arguments_: [],
      cargoBuildTarget: undefined,
      path: '/test/path',
    },
    {
      arguments_: ['--target', 'wasm32-wasip1', '--profile', 'wasi'],
      cargoBuildTarget: undefined,
      path: '/test/path',
    },
    {
      arguments_: ['--target', 'wasm32-wasip1-threads', '--profile', 'wasi'],
      cargoBuildTarget: undefined,
      path: '/test/path',
    },
  ])
  t.is(inheritedEnvironment.CARGO_BUILD_TARGET, 'wasm32-wasip1')
  t.deepEqual(restoredFiles, ['index.cjs', 'index.d.cts'])
  t.is(state['index.cjs'], 'native root JavaScript')
  t.is(state['index.d.cts'], 'native root declarations')
  t.is(state['browser.js'], 'wasm32-wasip1 root browser JavaScript')
  t.is(
    state['example.wasip1-browser.js'],
    'wasm32-wasip1 threadless browser JavaScript',
  )
  t.is(state['example.wasip1.cjs'], 'wasm32-wasip1 threadless JavaScript')
  t.is(state['example.wasip1.d.cts'], 'wasm32-wasip1 threadless declarations')
  t.is(
    state['example.wasi-browser.js'],
    'wasm32-wasip1-threads threaded browser JavaScript',
  )
  t.is(state['example.wasi.cjs'], 'wasm32-wasip1-threads threaded JavaScript')
  t.is(
    state['example.wasi.d.cts'],
    'wasm32-wasip1-threads threaded declarations',
  )
})

test('artifact regeneration restores native roots when a WASI pass fails', async (t) => {
  const state = {
    'index.cjs': 'initial JavaScript',
    'index.d.cts': 'initial declarations',
  }
  const error = new Error('threaded build failed')
  let restored = 0

  const rejected = await t.throwsAsync(() =>
    regenerateArtifacts({
      runBuild: async (arguments_) => {
        const targetIndex = arguments_.indexOf('--target')
        const target =
          targetIndex === -1 ? 'native' : arguments_[targetIndex + 1]
        state['index.cjs'] = `${target} JavaScript`
        state['index.d.cts'] = `${target} declarations`
        if (target === 'wasm32-wasip1-threads') {
          throw error
        }
      },
      readRootOutputs: async () => ({ ...state }),
      restoreRootOutputs: async (outputs) => {
        restored += 1
        Object.assign(state, outputs)
      },
      readRetainedFlavorOutputs: async () => ({}),
      restoreRetainedFlavorOutputs: async () => {},
    }),
  )

  t.is(rejected, error)
  t.is(restored, 1)
  t.deepEqual(state, {
    'index.cjs': 'native JavaScript',
    'index.d.cts': 'native declarations',
  })
})

test('artifact regeneration restores native roots when retained flavor restoration fails', async (t) => {
  const state = {
    'index.cjs': 'initial JavaScript',
    'index.d.cts': 'initial declarations',
  }
  const restoreError = new Error('threadless restoration failed')
  let restored = 0

  const rejected = await t.throwsAsync(() =>
    regenerateArtifacts({
      runBuild: async (arguments_) => {
        const targetIndex = arguments_.indexOf('--target')
        const target =
          targetIndex === -1 ? 'native' : arguments_[targetIndex + 1]
        state['index.cjs'] = `${target} JavaScript`
        state['index.d.cts'] = `${target} declarations`
      },
      readRootOutputs: async () => ({ ...state }),
      restoreRootOutputs: async (outputs) => {
        restored += 1
        Object.assign(state, outputs)
      },
      readRetainedFlavorOutputs: async () => ({}),
      restoreRetainedFlavorOutputs: async () => {
        throw restoreError
      },
    }),
  )

  t.is(rejected, restoreError)
  t.is(restored, 1)
  t.deepEqual(state, {
    'index.cjs': 'native JavaScript',
    'index.d.cts': 'native declarations',
  })
})

test('WASI declaration preservation emits portable throwing stubs in both public files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-wasi-declarations-'))
  try {
    const generatedSource = 'export interface Generated {}\n'
    const lifecycleHandle = `export interface AsyncWorkLifecycleHandle {
  id: number
  promise: Promise<number>
}`
    const requestInit = `export interface RequestInit {
  method?: string
}`
    const nativeDeclarations = unsupportedWasiFunctions.map((name) =>
      name === 'createQueuedAsyncWorkLifecycle'
        ? `export declare function ${name}(): AsyncWorkLifecycleHandle`
        : name === 'fetch'
          ? `export declare function ${name}(requestInit?: RequestInit): Promise<import('undici-types').Response>`
          : name === 'stashBufferAcrossDuplicateLoad'
            ? `export declare function ${name}(value: Buffer): void`
            : `export declare function ${name}(): void`,
    )
    const preservedDeclarations = unsupportedWasiFunctions.map(
      (name) => `export declare function ${name}(...args: unknown[]): never`,
    )
    const previousSource = `${lifecycleHandle}\n\n${requestInit}\n\n${nativeDeclarations.join('\n\n')}\n`
    const declarationPaths = ['index.d.ts', 'example.wasi.d.ts'].map((file) =>
      join(directory, file),
    )
    await Promise.all(
      declarationPaths.map((path) => writeFile(path, generatedSource)),
    )
    await preserveLifecycleDeclarations(declarationPaths, previousSource)

    const firstBuild = await Promise.all(
      declarationPaths.map((path) => readFile(path, 'utf8')),
    )
    t.is(firstBuild[1], firstBuild[0])

    await Promise.all(
      declarationPaths.map((path) => writeFile(path, generatedSource)),
    )
    await preserveLifecycleDeclarations(declarationPaths, firstBuild[0])

    const secondBuild = await Promise.all(
      declarationPaths.map((path) => readFile(path, 'utf8')),
    )
    t.deepEqual(secondBuild, firstBuild)

    for (const source of secondBuild) {
      t.true(source.endsWith(`${preservedDeclarations.at(-1)}\n`))
      t.false(source.includes('undici-types'))
      t.false(source.includes('value: Buffer'))
      for (const dependency of [lifecycleHandle, requestInit]) {
        t.is(source.split(dependency).length - 1, 1)
      }
      t.true(
        source.indexOf(lifecycleHandle) <
          source.indexOf(preservedDeclarations[0]),
      )
      t.true(
        source.indexOf(requestInit) < source.indexOf(preservedDeclarations[0]),
      )
      for (const declaration of preservedDeclarations) {
        t.is(source.split(declaration).length - 1, 1)
      }
    }

    const program = typeScript.createProgram(declarationPaths, {
      lib: ['lib.es2022.d.ts'],
      noEmit: true,
      skipLibCheck: false,
      strict: true,
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
})
