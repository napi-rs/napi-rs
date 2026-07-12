import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import test from 'ava'
import { format } from 'prettier'
import typeScript from 'typescript'

import {
  formatGeneratedOutputs,
  lifecycleOutputFiles,
  mergeLifecycleDeclarations,
  mergeLifecycleLoaderExports,
  preserveLifecycleDeclarations,
  regenerateArtifacts,
} from '../build.mjs'
import { unsupportedWasiFunctions } from '../unsupported-wasi-exports.mjs'

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

test('formatted lifecycle exports remain valid across a second build pass', async (t) => {
  const formattedSource = await format(
    `const __napiModule = { exports: {} }
function getWasiBindingExport(name) {
  return __napiModule.exports[name]
}
export const abandonDeferredClones = getWasiBindingExport('abandonDeferredClones')
`,
    { parser: 'babel' },
  )
  const output = {
    file: 'example.wasi-browser.js',
    binding: '__napiModule.exports',
    helper: 'getWasiBindingExport',
    forwardedFunctions: ['abandonDeferredClones'],
    marker: 'export const ',
    exportPattern: /^export const ([A-Za-z_$][\w$]*) = /gm,
    assignment(name: string) {
      return [
        `export const ${name} = __napiModule.exports.${name}`,
        `export const ${name} = getWasiBindingExport('${name}')`,
      ]
    },
  }

  const firstPass = mergeLifecycleLoaderExports(formattedSource, output)
  const secondPass = mergeLifecycleLoaderExports(firstPass, output)

  t.is(secondPass, formattedSource)
  t.is(secondPass.match(/export const abandonDeferredClones/g)?.length, 1)
  t.notThrows(() => Function(secondPass.replace(/^export /gm, ''))())
})

test('lifecycle export regeneration removes stale duplicate assignments', async (t) => {
  const formattedSource = await format(
    `const __napiModule = { exports: {} }
function getWasiBindingExport(name) {
  return __napiModule.exports[name]
}
export const abandonDeferredClones = __napiModule.exports.abandonDeferredClones
export const abandonDeferredClones = getWasiBindingExport(
  'abandonDeferredClones',
)
export const abandonDeferredClones = getWasiBindingExport('abandonDeferredClones')
`,
    { parser: 'babel' },
  )
  const output = {
    file: 'example.wasi-browser.js',
    binding: '__napiModule.exports',
    helper: 'getWasiBindingExport',
    forwardedFunctions: ['abandonDeferredClones'],
    marker: 'export const ',
    exportPattern: /^export const ([A-Za-z_$][\w$]*) = /gm,
    assignment(name: string) {
      return [
        `export const ${name} = __napiModule.exports.${name}`,
        `export const ${name} = getWasiBindingExport('${name}')`,
      ]
    },
  }

  const outputSource = mergeLifecycleLoaderExports(formattedSource, output)

  t.is(outputSource.match(/export const abandonDeferredClones/g)?.length, 1)
  t.true(
    outputSource.includes(
      "export const abandonDeferredClones = getWasiBindingExport('abandonDeferredClones')",
    ),
  )
  t.false(
    outputSource.includes(
      'export const abandonDeferredClones = __napiModule.exports.abandonDeferredClones',
    ),
  )
  t.notThrows(() => Function(outputSource.replace(/^export /gm, ''))())
})

test('checked threaded artifacts retain the WASI export surface and portable stubs', async (t) => {
  const [
    browserSource,
    nodeSource,
    declarationSource,
    rootSource,
    rootDeclarationSource,
    rootBrowserSource,
  ] = await Promise.all([
    readFile(
      join(generatedArtifactDirectory, 'example.wasi-browser.js'),
      'utf8',
    ),
    readFile(join(generatedArtifactDirectory, 'example.wasi.cjs'), 'utf8'),
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
  const privateWasiTestExports = [
    'dropUnregisteredWeakTsfnForWasi',
    'startTokioWakerAfterCleanupProbe',
  ]

  for (const name of privateWasiTestExports) {
    t.false(browserSource.includes(`export const ${name}`), name)
    t.false(nodeSource.includes(`module.exports.${name} =`), name)
    t.false(
      declarationSource.includes(`export declare function ${name}(`),
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
  t.true(
    rootDeclarationSource.includes(
      'export declare function abandonDeferredClones(): void',
    ),
  )
  t.false(
    rootDeclarationSource.includes(
      'export declare function abandonDeferredClones(...args: unknown[]): never',
    ),
  )
  for (const name of unsupportedWasiFunctions) {
    t.true(deferredSource.includes(`'${name}',`), name)
  }
  t.true(
    deferredSource.includes(
      '__napiModule.exports[name] = getDeferredWasiBindingExport(',
    ),
  )
  t.true(deferredDeclarationSource.includes('dispose(): Promise<void>'))
  t.false(deferredDeclarationSource.includes('dispose(): void | Promise<void>'))
  t.regex(rootSource, /['"]wasm32-wasi['"]/)
  t.regex(rootSource, /['"]wasm32-wasip1['"]/)
  t.is(rootBrowserSource, "export * from '@examples/napi-wasm32-wasip1'\n")
})

test('checked WASI artifacts are a clean lifecycle regeneration', async (t) => {
  const rootDeclarationSource = await readFile(
    join(generatedArtifactDirectory, 'index.d.cts'),
    'utf8',
  )

  for (const target of ['wasm32-wasip1', 'wasm32-wasip1-threads']) {
    const outputs = lifecycleOutputFiles(target)
    for (const output of outputs.loaders) {
      const source = await readFile(
        join(generatedArtifactDirectory, output.file),
        'utf8',
      )
      t.is(mergeLifecycleLoaderExports(source, output), source, output.file)
    }
    for (const file of outputs.declarations.filter(
      (file) => file !== 'index.d.cts',
    )) {
      const source = await readFile(
        join(generatedArtifactDirectory, file),
        'utf8',
      )
      t.is(
        mergeLifecycleDeclarations(source, rootDeclarationSource),
        source,
        file,
      )
    }
  }
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
  t.true(
    functionSource('__finishWasiDisposal').includes('__terminateWasiWorkers()'),
  )
})

test('checked WASI loaders keep browser, Node, and unsupported declarations in parity', async (t) => {
  const [rootSource, rootDeclarationSource, deferredSource] = await Promise.all(
    [
      readFile(join(generatedArtifactDirectory, 'index.cjs'), 'utf8'),
      readFile(join(generatedArtifactDirectory, 'index.d.cts'), 'utf8'),
      readFile(
        join(generatedArtifactDirectory, 'example.wasip1-deferred.js'),
        'utf8',
      ),
    ],
  )

  for (const suffix of ['wasi', 'wasip1']) {
    const [nodeSource, browserSource, declarationSource] = await Promise.all([
      readFile(
        join(generatedArtifactDirectory, `example.${suffix}.cjs`),
        'utf8',
      ),
      readFile(
        join(generatedArtifactDirectory, `example.${suffix}-browser.js`),
        'utf8',
      ),
      readFile(
        join(generatedArtifactDirectory, `example.${suffix}.d.cts`),
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

    for (const name of unsupportedWasiFunctions) {
      t.true(
        new RegExp(
          `module\\.exports\\.${name}\\s*=\\s*getWasiBindingExport\\(\\s*'${name}'\\s*,?\\s*\\)`,
        ).test(nodeSource),
        `${suffix} Node ${name}`,
      )
      t.true(
        new RegExp(
          `export const ${name}\\s*=\\s*getWasiBindingExport\\(\\s*'${name}'\\s*,?\\s*\\)`,
        ).test(browserSource),
        `${suffix} browser ${name}`,
      )
      t.regex(
        declarationSource,
        new RegExp(
          `export declare function ${name}\\(\\s*\\.\\.\\.args:\\s*unknown\\[\\]\\s*\\):\\s*never`,
        ),
        `${suffix} declaration ${name}`,
      )
    }
  }

  for (const name of unsupportedWasiFunctions) {
    t.true(
      rootSource.includes(
        `module.exports.${name} = getBindingExport('${name}')`,
      ),
      `root ${name}`,
    )
    t.true(
      rootDeclarationSource.includes(`export declare function ${name}(`),
      `root declaration ${name}`,
    )
    t.true(deferredSource.includes(`'${name}',`), `deferred ${name}`)
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

test('WASI declaration preservation emits portable throwing stubs in both public files', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'napi-wasi-declarations-'))
  try {
    const generatedSource = `export interface Generated {}

export declare function abandonDeferredClones(): void
`
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
      t.false(
        source.includes(
          'export declare function abandonDeferredClones(): void',
        ),
      )
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
