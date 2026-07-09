import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, resolveConfig } from 'prettier'

import { unsupportedWasiFunctions } from './unsupported-wasi-exports.mjs'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const napiCli = fileURLToPath(new URL('../../cli/cli.mjs', import.meta.url))
const declarationPath = fileURLToPath(new URL('index.d.cts', import.meta.url))
const unsupportedWasiFunctionSet = new Set(unsupportedWasiFunctions)
const threadedWasiBrowserTestFunctions = [
  'abortBoundedTsfnFromOwnerAgent',
  'boundedTsfnOwnerAbortState',
  'finishBoundedTsfnOwnerAbort',
  'prepareBoundedTsfnOwnerAbort',
  'releaseBoundedTsfnNativeWait',
]

function run(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [napiCli, ...arguments_], {
      cwd: packageDirectory,
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolve()
      } else {
        reject(
          new Error(
            `napi-raw ${arguments_.join(' ')} exited with code ${code} and signal ${signal}`,
          ),
        )
      }
    })
  })
}

function optionValue(arguments_, names) {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (names.includes(argument)) {
      return arguments_[index + 1]
    }
    for (const name of names) {
      if (argument.startsWith(`${name}=`)) {
        return argument.slice(name.length + 1)
      }
    }
  }
}

function fixtureArguments(arguments_) {
  const valueOptions = new Set(['--profile', '--target', '--target-dir', '-t'])
  const flagOptions = new Set([
    '--cross-compile',
    '--release',
    '--strip',
    '--use-cross',
    '--use-napi-cross',
    '--verbose',
    '-r',
    '-s',
    '-v',
    '-x',
  ])
  const forwarded = []

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]
    if (argument === '--') {
      forwarded.push(...arguments_.slice(index))
      break
    }
    if (flagOptions.has(argument)) {
      forwarded.push(argument)
      continue
    }
    if (valueOptions.has(argument)) {
      forwarded.push(argument, arguments_[index + 1])
      index += 1
      continue
    }
    if ([...valueOptions].some((option) => argument.startsWith(`${option}=`))) {
      forwarded.push(argument)
    }
  }

  return forwarded
}

function unsupportedWasiExportHelper(binding, helperName) {
  const names = unsupportedWasiFunctions
    .map((name) => `  '${name}',`)
    .join('\n')
  return `const unsupportedWasiFunctions = new Set([\n${names}\n])

function ${helperName}(name) {
  const value = ${binding}[name]
  if (
    value !== undefined ||
    !unsupportedWasiFunctions.has(name)
  ) {
    return value
  }
  return function unsupportedWasiFunction() {
    const error = new Error(
      \`The "\${name}" export is not supported by this WASI binding\`,
    )
    error.code = 'NAPI_RS_UNSUPPORTED_WASI_EXPORT'
    throw error
  }
}

`
}

function compareGeneratedNames(left, right) {
  const normalizedLeft = left.toLowerCase()
  const normalizedRight = right.toLowerCase()
  if (normalizedLeft < normalizedRight) {
    return -1
  }
  if (normalizedLeft > normalizedRight) {
    return 1
  }
  return left < right ? -1 : left > right ? 1 : 0
}

function insertGeneratedExport(source, name, assignment, pattern) {
  let callableExportsStarted = false
  for (const match of source.matchAll(pattern)) {
    const candidate = match[1]
    if (candidate[0] === candidate[0].toLowerCase()) {
      callableExportsStarted = true
    }
    if (callableExportsStarted && compareGeneratedNames(candidate, name) > 0) {
      return `${source.slice(0, match.index)}${assignment}\n${source.slice(match.index)}`
    }
  }
  return `${source.trimEnd()}\n${assignment}\n`
}

async function exposeLifecycleExportsAcrossTargets() {
  const bindings = [
    {
      file: 'index.cjs',
      binding: 'nativeBinding',
      helper: 'getBindingExport',
      forwardedFunctions: unsupportedWasiFunctions,
      marker: 'module.exports = nativeBinding\n',
      exportPattern: /^module\.exports\.([A-Za-z_$][\w$]*) = /gm,
      assignment(name) {
        return [
          `module.exports.${name} = nativeBinding.${name}`,
          `module.exports.${name} = getBindingExport('${name}')`,
        ]
      },
    },
    {
      file: 'example.wasi.cjs',
      binding: '__napiModule.exports',
      helper: 'getWasiBindingExport',
      forwardedFunctions: [
        ...unsupportedWasiFunctions,
        ...threadedWasiBrowserTestFunctions,
      ],
      marker: 'module.exports = __napiModule.exports\n',
      exportPattern: /^module\.exports\.([A-Za-z_$][\w$]*) = /gm,
      assignment(name) {
        return [
          `module.exports.${name} = __napiModule.exports.${name}`,
          `module.exports.${name} = getWasiBindingExport('${name}')`,
        ]
      },
    },
    {
      file: 'example.wasi-browser.js',
      binding: '__napiModule.exports',
      helper: 'getWasiBindingExport',
      forwardedFunctions: [
        ...unsupportedWasiFunctions,
        ...threadedWasiBrowserTestFunctions,
      ],
      marker: 'export const ',
      exportPattern: /^export const ([A-Za-z_$][\w$]*) = /gm,
      assignment(name) {
        return [
          `export const ${name} = __napiModule.exports.${name}`,
          `export const ${name} = getWasiBindingExport('${name}')`,
        ]
      },
    },
  ]

  for (const {
    file,
    binding,
    helper,
    forwardedFunctions,
    marker,
    exportPattern,
    assignment,
  } of bindings) {
    const path = fileURLToPath(new URL(file, import.meta.url))
    let source
    try {
      source = await readFile(path, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue
      }
      throw error
    }

    if (!source.includes(marker)) {
      throw new Error(`Could not locate lifecycle export marker in ${file}`)
    }
    if (!source.includes(`function ${helper}(`)) {
      source = source.replace(
        marker,
        `${unsupportedWasiExportHelper(binding, helper)}${marker}`,
      )
    }
    for (const name of forwardedFunctions) {
      const [generated, replacement] = assignment(name)
      const desired = unsupportedWasiFunctionSet.has(name)
        ? replacement
        : generated
      const alternative = desired === generated ? replacement : generated
      if (source.includes(desired)) {
        continue
      }
      if (source.includes(alternative)) {
        source = source.replace(alternative, desired)
      } else {
        source = insertGeneratedExport(source, name, desired, exportPattern)
      }
    }
    await writeFile(path, source)
  }
}

function insertGeneratedDeclaration(source, name, declaration) {
  const declarationPattern =
    /^export\s+(?:declare\s+)?(?:class|interface|function|type|const(?:\s+enum)?|enum)\s+([A-Za-z_$][\w$]*)/gm
  let callableDeclarationsStarted = false
  for (const match of source.matchAll(declarationPattern)) {
    if (match[0].startsWith('export declare function ')) {
      callableDeclarationsStarted = true
    }
    if (
      callableDeclarationsStarted &&
      compareGeneratedNames(match[1], name) > 0
    ) {
      const previousSeparator = source.lastIndexOf('\n\n', match.index)
      const insertionIndex =
        previousSeparator === -1 ? 0 : previousSeparator + 2
      return `${source.slice(0, insertionIndex)}${declaration}\n\n${source.slice(insertionIndex)}`
    }
  }
  return `${source.trimEnd()}\n\n${declaration}\n`
}

export function mergeLifecycleDeclarations(source, previousSource) {
  const declarationStarts = [
    'export interface AsyncWorkLifecycleHandle {',
    'export interface RequestInit {',
    ...unsupportedWasiFunctions.map(
      (name) => `export declare function ${name}(`,
    ),
  ]

  for (const declarationStart of declarationStarts) {
    if (source.includes(declarationStart)) {
      continue
    }
    const start = previousSource.indexOf(declarationStart)
    const separator = start === -1 ? -1 : previousSource.indexOf('\n\n', start)
    const end = separator === -1 ? previousSource.length : separator
    if (start === -1) {
      throw new Error(
        `Could not preserve declaration starting with ${declarationStart} for WASI`,
      )
    }
    const declaration = previousSource.slice(start, end).trimEnd()
    const name = declarationStart.match(
      /(?:interface|function)\s+([A-Za-z_$][\w$]*)/,
    )[1]
    source = insertGeneratedDeclaration(source, name, declaration)
  }

  return source
}

async function preserveLifecycleDeclarations(previousSource) {
  const source = await readFile(declarationPath, 'utf8')
  const nextSource = mergeLifecycleDeclarations(source, previousSource)

  if (nextSource !== source) {
    await writeFile(declarationPath, nextSource)
  }
}

async function instrumentThreadedWasiBrowserTsfnWait() {
  const workerPath = fileURLToPath(
    new URL('wasi-worker-browser.mjs', import.meta.url),
  )
  let workerSource = await readFile(workerPath, 'utf8')
  const constantsMarker = 'const fs = createFsProxy(__memfsExported)\n'
  const onLoadMarker = '  onLoad({ wasmModule, wasmMemory }) {\n'
  const importsMarker = `      overwriteImports(importObject) {
        importObject.env = {`
  const beforeInitMarker = `          memory: wasmMemory,
        }
      },
    })`

  if (
    !workerSource.includes(constantsMarker) ||
    !workerSource.includes(onLoadMarker) ||
    !workerSource.includes(importsMarker) ||
    !workerSource.includes(beforeInitMarker)
  ) {
    throw new Error('Could not instrument the threaded WASI browser worker')
  }

  workerSource = workerSource.replace(
    constantsMarker,
    `${constantsMarker}
const TSFN_TEST_COUNTER_COUNT = 35
const TSFN_SCENARIO_INDEX = 0
const TSFN_DEFERRED_ABORT_SCENARIO = 1
const TSFN_POST_NATIVE_ABORT_SCENARIO = 2
const TSFN_HOST_CALL_ARMED_INDEX = 4
const TSFN_NATIVE_QUEUE_CONFIRMED_INDEX = 5
const TSFN_NATIVE_WAIT_ENTERED_INDEX = 6
const TSFN_NATIVE_WAIT_RETURNED_INDEX = 7
const TSFN_AFTER_NATIVE_ENTERED_INDEX = 8
const TSFN_AFTER_NATIVE_RELEASED_INDEX = 9
const TSFN_BLOCKING_RETURNED_INDEX = 10
const TSFN_LIFECYCLE_GATE_ARMED_INDEX = 12
const TSFN_LIFECYCLE_GATE_ENTERED_INDEX = 13
const TSFN_LIFECYCLE_GATE_RELEASED_INDEX = 14
const TSFN_NATIVE_ABORT_CALLED_INDEX = 17
const TSFN_SLOT_RELEASE_CONFIRMED_INDEX = 27
const TSFN_NATIVE_WAIT_ADDRESS_CONFIRMED_INDEX = 28
const TSFN_UNEXPECTED_INDEX = 29
const TSFN_COND_OFFSET = 56
const TSFN_QUEUE_SIZE_OFFSET = 60
const TSFN_STATE_OFFSET = 140
const TSFN_MAX_QUEUE_SIZE_OFFSET = 152
`,
  )
  workerSource = workerSource.replace(
    onLoadMarker,
    `${onLoadMarker}    let tsfnTestStatePointer\n`,
  )
  workerSource = workerSource.replace(
    importsMarker,
    `      overwriteImports(importObject) {
        let blockingCallFunction = 0
        const getTsfnTestState = () =>
          tsfnTestStatePointer
            ? new Int32Array(
                wasmMemory.buffer,
                tsfnTestStatePointer,
                TSFN_TEST_COUNTER_COUNT,
              )
            : undefined
        const failTsfnTest = (state, code) => {
          Atomics.compareExchange(state, TSFN_UNEXPECTED_INDEX, 0, code)
        }
        const waitForTsfnGate = (state, index) => {
          const deadline = Date.now() + 10_000
          while (Atomics.load(state, index) === 0) {
            const remaining = deadline - Date.now()
            if (remaining <= 0) {
              return false
            }
            Atomics.wait(state, index, 0, Math.min(remaining, 10))
          }
          return true
        }
        const callThreadsafeFunction =
          importObject.napi.napi_call_threadsafe_function
        const releaseThreadsafeFunction =
          importObject.napi.napi_release_threadsafe_function
        importObject.napi.napi_release_threadsafe_function = function (
          func,
          mode,
        ) {
          const status = releaseThreadsafeFunction(func, mode)
          const state = getTsfnTestState()
          if (state && Atomics.load(state, TSFN_SCENARIO_INDEX) !== 0) {
            if (mode === 1) {
              if (
                status !== 0 ||
                Atomics.compareExchange(
                  state,
                  TSFN_NATIVE_ABORT_CALLED_INDEX,
                  0,
                  1,
                ) !== 0
              ) {
                failTsfnTest(state, 40)
              }
            }
            if (
              mode === 0 &&
              blockingCallFunction !== 0 &&
              Atomics.load(state, TSFN_AFTER_NATIVE_ENTERED_INDEX) === 1 &&
              Atomics.load(state, TSFN_AFTER_NATIVE_RELEASED_INDEX) === 1 &&
              Atomics.load(state, TSFN_BLOCKING_RETURNED_INDEX) === 0
            ) {
              if (status !== 0 || func !== blockingCallFunction) {
                failTsfnTest(state, 41)
              } else {
                Atomics.store(
                  state,
                  TSFN_SLOT_RELEASE_CONFIRMED_INDEX,
                  1,
                )
              }
              blockingCallFunction = 0
            }
          }
          return status
        }
        importObject.napi.napi_call_threadsafe_function = function (
          func,
          data,
          mode,
        ) {
          const state = getTsfnTestState()
          if (!state || Atomics.load(state, TSFN_SCENARIO_INDEX) === 0) {
            return callThreadsafeFunction(func, data, mode)
          }

          if (
            mode === 0 &&
            Atomics.load(state, TSFN_SCENARIO_INDEX) ===
              TSFN_DEFERRED_ABORT_SCENARIO &&
            Atomics.compareExchange(
              state,
              TSFN_LIFECYCLE_GATE_ARMED_INDEX,
              1,
              2,
            ) === 1
          ) {
            Atomics.store(state, TSFN_LIFECYCLE_GATE_ENTERED_INDEX, 1)
            if (!waitForTsfnGate(state, TSFN_LIFECYCLE_GATE_RELEASED_INDEX)) {
              failTsfnTest(state, 42)
            }
          }

          if (mode !== 1) {
            return callThreadsafeFunction(func, data, mode)
          }
          if (
            Atomics.compareExchange(
              state,
              TSFN_HOST_CALL_ARMED_INDEX,
              1,
              0,
            ) !== 1
          ) {
            return callThreadsafeFunction(func, data, mode)
          }
          blockingCallFunction = func

          const loadTsfnWord = (offset) =>
            Atomics.load(
              new Int32Array(wasmMemory.buffer, func + offset, 1),
              0,
            )
          if (
            loadTsfnWord(TSFN_QUEUE_SIZE_OFFSET) !== 1 ||
            loadTsfnWord(TSFN_STATE_OFFSET) !== 0 ||
              loadTsfnWord(TSFN_MAX_QUEUE_SIZE_OFFSET) !== 1
          ) {
            failTsfnTest(state, 43)
            throw new Error(
              'Bounded TSFN call did not enter native N-API with a full open queue',
            )
          }
          Atomics.store(state, TSFN_NATIVE_QUEUE_CONFIRMED_INDEX, 1)

          const atomicWait = Atomics.wait
          Atomics.wait = function (array, index, value, timeout) {
            const waitAddress =
              array.byteOffset + index * Int32Array.BYTES_PER_ELEMENT
            if (
              array.buffer !== wasmMemory.buffer ||
              waitAddress !== func + TSFN_COND_OFFSET
            ) {
              return atomicWait(array, index, value, timeout)
            }
            Atomics.store(
              state,
              TSFN_NATIVE_WAIT_ADDRESS_CONFIRMED_INDEX,
              1,
            )
            Atomics.store(state, TSFN_NATIVE_WAIT_ENTERED_INDEX, 1)
            try {
              return atomicWait(array, index, value, timeout)
            } finally {
              Atomics.store(state, TSFN_NATIVE_WAIT_RETURNED_INDEX, 1)
            }
          }
          try {
            const status = callThreadsafeFunction(func, data, mode)
            if (
              Atomics.load(state, TSFN_SCENARIO_INDEX) ===
              TSFN_POST_NATIVE_ABORT_SCENARIO
            ) {
              Atomics.store(state, TSFN_AFTER_NATIVE_ENTERED_INDEX, 1)
              if (!waitForTsfnGate(state, TSFN_AFTER_NATIVE_RELEASED_INDEX)) {
                failTsfnTest(state, 44)
              }
            }
            return status
          } finally {
            Atomics.wait = atomicWait
          }
        }
        importObject.env = {`,
  )
  workerSource = workerSource.replace(
    beforeInitMarker,
    `          memory: wasmMemory,
        }
      },
      beforeInit({ instance }) {
        tsfnTestStatePointer =
          instance.exports.__napi_rs_test_tsfn_state_ptr()
      },
    })`,
  )
  const prettierConfig = await resolveConfig(workerPath)
  await writeFile(
    workerPath,
    await format(workerSource, { ...prettierConfig, filepath: workerPath }),
  )

  const browserPath = fileURLToPath(
    new URL('example.wasi-browser.js', import.meta.url),
  )
  let browserSource = await readFile(browserPath, 'utf8')
  const browserScopeMarker = `const {
  instance: __napiInstance,`
  const browserWorkerReuseMarker = `  asyncWorkPoolSize: 4,
  wasi: __wasi,`
  const browserImportsMarker = `  overwriteImports(importObject) {
    importObject.env = {`
  const browserBeforeInitMarker = `  beforeInit({ instance }) {
    __wrapEmnapiContextDestroy(instance)
    for (const name of Object.keys(instance.exports)) {`

  if (
    !browserSource.includes(browserScopeMarker) ||
    !browserSource.includes(browserWorkerReuseMarker) ||
    !browserSource.includes(browserImportsMarker) ||
    !browserSource.includes(browserBeforeInitMarker)
  ) {
    throw new Error('Could not instrument the threaded WASI browser host')
  }

  browserSource = browserSource.replace(
    browserScopeMarker,
    `let __tsfnTestStatePointer

${browserScopeMarker}`,
  )
  browserSource = browserSource.replace(
    browserWorkerReuseMarker,
    `  asyncWorkPoolSize: 4,
  reuseWorker: true,
  wasi: __wasi,`,
  )
  browserSource = browserSource.replace(
    browserImportsMarker,
    `  overwriteImports(importObject) {
    const TSFN_TEST_COUNTER_COUNT = 35
    const TSFN_SCENARIO_INDEX = 0
    const TSFN_CLEANUP_TRACKING_ARMED_INDEX = 22
    const TSFN_CLEANUP_HOOK_ADDED_INDEX = 23
    const TSFN_CLEANUP_HOOK_REMOVED_INDEX = 24
    const TSFN_NATIVE_ABORT_CALLED_INDEX = 17
    const TSFN_UNEXPECTED_INDEX = 29
    const trackedTsfnCleanupHooks = new Map()
    const getTsfnTestState = (pointer = __tsfnTestStatePointer) =>
      pointer
        ? new Int32Array(
            __sharedMemory.buffer,
            pointer,
            TSFN_TEST_COUNTER_COUNT,
          )
        : undefined
    const failTsfnTest = (state, code) => {
      Atomics.compareExchange(state, TSFN_UNEXPECTED_INDEX, 0, code)
    }
    const cleanupHookKey = (env, callback, data) =>
      \`\${env}:\${callback}:\${data}\`

    const addEnvCleanupHook = importObject.napi.napi_add_env_cleanup_hook
    importObject.napi.napi_add_env_cleanup_hook = function (
      env,
      callback,
      data,
    ) {
      const state = getTsfnTestState()
      const scenario = state
        ? Atomics.load(state, TSFN_SCENARIO_INDEX)
        : 0
      const track =
        scenario !== 0 &&
        Atomics.compareExchange(
          state,
          TSFN_CLEANUP_TRACKING_ARMED_INDEX,
          1,
          0,
        ) === 1
      const status = addEnvCleanupHook(env, callback, data)
      if (track) {
        const key = cleanupHookKey(env, callback, data)
        const previous = trackedTsfnCleanupHooks.get(key)
        if (
          status !== 0 ||
          (previous && !previous.removed) ||
          Atomics.load(state, TSFN_CLEANUP_HOOK_ADDED_INDEX) !== 0
        ) {
          failTsfnTest(state, 50)
        } else {
          Atomics.store(state, TSFN_CLEANUP_HOOK_ADDED_INDEX, 1)
          trackedTsfnCleanupHooks.set(key, {
            pointer: __tsfnTestStatePointer,
            removed: false,
            scenario,
          })
        }
      }
      return status
    }

    const removeEnvCleanupHook =
      importObject.napi.napi_remove_env_cleanup_hook
    importObject.napi.napi_remove_env_cleanup_hook = function (
      env,
      callback,
      data,
    ) {
      const key = cleanupHookKey(env, callback, data)
      const tracked = trackedTsfnCleanupHooks.get(key)
      const status = removeEnvCleanupHook(env, callback, data)
      if (tracked) {
        const state = getTsfnTestState(tracked.pointer)
        if (
          status !== 0 ||
          tracked.removed ||
          Atomics.load(state, TSFN_SCENARIO_INDEX) !== tracked.scenario ||
          Atomics.load(state, TSFN_CLEANUP_HOOK_REMOVED_INDEX) !== 0
        ) {
          failTsfnTest(state, 51)
        } else {
          tracked.removed = true
          Atomics.store(state, TSFN_CLEANUP_HOOK_REMOVED_INDEX, 1)
        }
      }
      return status
    }

    const releaseThreadsafeFunction =
      importObject.napi.napi_release_threadsafe_function
    importObject.napi.napi_release_threadsafe_function = function (
      func,
      mode,
    ) {
      const status = releaseThreadsafeFunction(func, mode)
      const state = getTsfnTestState()
      if (
        state &&
        Atomics.load(state, TSFN_SCENARIO_INDEX) !== 0 &&
        mode === 1
      ) {
        if (
          status !== 0 ||
          Atomics.compareExchange(
            state,
            TSFN_NATIVE_ABORT_CALLED_INDEX,
            0,
            1,
          ) !== 0
        ) {
          failTsfnTest(state, 52)
        }
      }
      return status
    }

    importObject.env = {`,
  )
  browserSource = browserSource.replace(
    browserBeforeInitMarker,
    `  beforeInit({ instance }) {
    __wrapEmnapiContextDestroy(instance)
    __tsfnTestStatePointer =
      instance.exports.__napi_rs_test_tsfn_state_ptr()
    for (const name of Object.keys(instance.exports)) {`,
  )
  await writeFile(browserPath, browserSource)
}

async function main(userArguments) {
  const target =
    optionValue(userArguments, ['--target', '-t']) ??
    process.env.CARGO_BUILD_TARGET
  const previousDeclarationSource = target?.startsWith('wasm32-')
    ? await readFile(declarationPath, 'utf8')
    : undefined

  await run([
    'build',
    '--platform',
    '--js',
    'index.cjs',
    '--dts',
    'index.d.cts',
    ...userArguments,
  ])

  await exposeLifecycleExportsAcrossTargets()
  if (previousDeclarationSource !== undefined) {
    await preserveLifecycleDeclarations(previousDeclarationSource)
  }
  await instrumentThreadedWasiBrowserTsfnWait()

  if (!target?.startsWith('wasm32-')) {
    await run([
      'build',
      '--manifest-path',
      'module-init-rollback/Cargo.toml',
      '--package-json-path',
      'module-init-rollback/package.json',
      '--output-dir',
      'module-init-rollback',
      '--dts',
      '../../../target/napi-module-init-rollback-fixture.d.ts',
      ...fixtureArguments(userArguments),
    ])

    await run([
      'build',
      '--manifest-path',
      'tsfn-retention/Cargo.toml',
      '--package-json-path',
      'tsfn-retention/package.json',
      '--output-dir',
      'tsfn-retention',
      '--dts',
      '../../../target/napi-tsfn-retention-fixture.d.ts',
      ...fixtureArguments(userArguments),
    ])
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main(process.argv.slice(2))
}
