import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import test from 'ava'

import { formatGeneratedOutputs, regenerateArtifacts } from '../build.mjs'

const generatedArtifactDirectory = join(import.meta.dirname, '..')

function generatedExportNames(source: string, pattern: RegExp) {
  return [...source.matchAll(pattern)].map((match) => match[1])
}

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

test('checked WASI artifacts keep the deferred and flavor contracts', async (t) => {
  const [
    declarationSource,
    rootSource,
    rootDeclarationSource,
    rootBrowserSource,
  ] = await Promise.all([
    readFile(join(generatedArtifactDirectory, 'example.wasi.d.cts'), 'utf8'),
    readFile(join(generatedArtifactDirectory, 'index.cjs'), 'utf8'),
    readFile(join(generatedArtifactDirectory, 'index.d.cts'), 'utf8'),
    readFile(join(generatedArtifactDirectory, 'browser.js'), 'utf8'),
  ])
  const [deferredSource, deferredDeclarationSource] = await Promise.all([
    readFile(
      join(generatedArtifactDirectory, 'example.wasip1-deferred.js'),
      'utf8',
    ),
    readFile(
      join(generatedArtifactDirectory, 'example.wasip1-deferred.d.ts'),
      'utf8',
    ),
  ])

  t.false(declarationSource.includes('undici-types'))
  t.true(rootDeclarationSource.includes('export declare function fetch('))
  t.true(deferredDeclarationSource.includes('dispose(): Promise<void>'))
  t.false(deferredDeclarationSource.includes('dispose(): void | Promise<void>'))
  t.regex(rootSource, /['"]wasm32-wasi['"]/)
  t.regex(rootSource, /['"]wasm32-wasip1['"]/)
  t.is(rootBrowserSource, "export * from '@examples/napi-wasm32-wasip1'\n")
  t.truthy(deferredSource)
})

test('checked generated WASI JavaScript has valid syntax', (t) => {
  for (const file of [
    'browser.js',
    'index.cjs',
    'example.wasi-browser.js',
    'example.wasi.cjs',
    'example.wasip1-browser.js',
    'example.wasip1-deferred.js',
    'example.wasip1.cjs',
    'wasi-worker-browser.mjs',
    'wasi-worker.mjs',
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--check', join(generatedArtifactDirectory, file)],
      { encoding: 'utf8' },
    )
    t.is(
      result.status,
      0,
      `${file}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    )
  }
})

test('checked threaded browser artifact rolls workers back after context cleanup', async (t) => {
  const source = await readFile(
    join(generatedArtifactDirectory, 'example.wasi-browser.js'),
    'utf8',
  )
  // The loader emits its lifecycle helpers at the top level, so each function
  // ends at the first unindented closing brace after its declaration.
  const functionSource = (name: string) => {
    const start = source.indexOf(`function ${name}(`)
    t.true(start !== -1, `missing function ${name}`)
    const end = source.indexOf('\n}', start)
    t.true(end !== -1, `unterminated function ${name}`)
    return source.slice(start, end + 2)
  }

  // Workers created during initialization are tracked for rollback.
  t.true(source.includes('const __wasiWorkers = new Set()'))
  t.true(source.includes('__wasiWorkers.add(worker)'))

  // Termination untracks each worker and observes asynchronous terminate().
  const terminateSource = functionSource('__terminateWasiWorkers')
  t.true(terminateSource.includes('result = worker.terminate()'))
  t.true(terminateSource.includes('__wasiWorkers.delete(worker)'))

  // A failed initialization rolls back through the serialized cleanup path.
  t.true(
    source.includes(
      'const cleanupErrors = await __rollbackWasiInitialization()',
    ),
  )

  // Rollback destroys the emnapi context before the worker-termination
  // continuation runs, and an asynchronous destroy is awaited first.
  const rollbackSource = functionSource('__rollbackWasiInitialization')
  const contextCleanup = rollbackSource.indexOf('__destroyEmnapiContext()')
  const workerCleanup = rollbackSource.indexOf(
    '__finishWasiInitializationRollback(',
  )
  t.true(contextCleanup !== -1)
  t.true(workerCleanup !== -1)
  t.true(
    contextCleanup < workerCleanup,
    'context cleanup must quiesce runtime work before worker termination',
  )
  t.regex(
    rollbackSource,
    /Promise\.resolve\(destroyResult\)\s*\.catch\([\s\S]+?\)\s*\.then\(\(\) => __finishWasiInitializationRollback\(cleanupErrors\)\)/,
    'asynchronous context destruction must settle before terminating workers',
  )
  const finishRollbackSource = functionSource(
    '__finishWasiInitializationRollback',
  )
  t.true(finishRollbackSource.includes('__terminateWasiWorkers()'))

  // Explicit disposal keeps the same ordering: context first, workers second.
  const startDisposalSource = functionSource('__startWasiDisposal')
  const disposalContextCleanup = startDisposalSource.indexOf(
    '__destroyEmnapiContext()',
  )
  const disposalWorkerCleanup = startDisposalSource.indexOf(
    '__finishWasiDisposal',
  )
  t.true(disposalContextCleanup !== -1)
  t.true(disposalWorkerCleanup !== -1)
  t.true(disposalContextCleanup < disposalWorkerCleanup)
  // Ordering alone is not enough: an asynchronous context destruction must be
  // chained ahead of the worker-termination continuation, not merely started
  // first. A destroy rejection intentionally skips worker termination — the
  // binding stays alive for a disposal retry (executable counterpart:
  // wasi-deferred-dispose-failure spec; the Node loader lifecycle specs
  // execute the same emnapiContextLifecycle template block).
  t.regex(
    startDisposalSource,
    /Promise\.resolve\(destroyResult\)\.then\(__finishWasiDisposal\)/,
    'asynchronous context destruction must settle before terminating workers on disposal',
  )
  t.true(
    functionSource('__finishWasiDisposal').includes('__terminateWasiWorkers()'),
  )
})

test('checked WASI loaders keep browser and Node exports in parity', async (t) => {
  for (const suffix of ['wasi', 'wasip1']) {
    const [nodeSource, browserSource] = await Promise.all([
      readFile(
        join(generatedArtifactDirectory, `example.${suffix}.cjs`),
        'utf8',
      ),
      readFile(
        join(generatedArtifactDirectory, `example.${suffix}-browser.js`),
        'utf8',
      ),
    ])
    const nodeExports = generatedExportNames(
      nodeSource,
      /^module\.exports\.([A-Za-z_$][\w$]*)\s*=/gm,
    )
    const browserExports = generatedExportNames(
      browserSource,
      /^export const ([A-Za-z_$][\w$]*)\s*=/gm,
    ).filter((name) => !name.startsWith('__'))

    t.is(
      new Set(nodeExports).size,
      nodeExports.length,
      `${suffix} Node exports`,
    )
    t.is(
      new Set(browserExports).size,
      browserExports.length,
      `${suffix} browser exports`,
    )
    t.deepEqual(
      [...nodeExports].sort(),
      [...browserExports].sort(),
      `${suffix} loader exports`,
    )
  }
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
