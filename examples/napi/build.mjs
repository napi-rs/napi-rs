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
  'abortBoundedTsfnPostCallFromOwnerAgent',
  'armBoundedTsfnPostCallNativeWait',
  'boundedTsfnOwnerAbortState',
  'boundedTsfnPostCallAbortState',
  'finishBoundedTsfnOwnerAbort',
  'finishBoundedTsfnPostCallAbort',
  'prepareBoundedTsfnOwnerAbort',
  'prepareBoundedTsfnPostCallAbort',
  'releaseBoundedTsfnNativeWait',
  'releaseBoundedTsfnPostCallSlot',
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

async function exposeLifecycleExportsAcrossTargets(target) {
  const forwardedFunctions = [
    ...unsupportedWasiFunctions,
    ...(target === 'wasm32-wasip1-threads'
      ? threadedWasiBrowserTestFunctions
      : []),
  ]
  const bindings = [
    {
      file: 'index.cjs',
      binding: 'nativeBinding',
      helper: 'getBindingExport',
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
  let source = await readFile(workerPath, 'utf8')
  const constantsMarker = 'const fs = createFsProxy(__memfsExported)\n'
  const onLoadMarker = '  onLoad({ wasmModule, wasmMemory }) {\n'
  const importsMarker = `      overwriteImports(importObject) {
        importObject.env = {`
  const beforeInitMarker = `          memory: wasmMemory,
        }
      },
    })`

  if (
    !source.includes(constantsMarker) ||
    !source.includes(onLoadMarker) ||
    !source.includes(importsMarker) ||
    !source.includes(beforeInitMarker)
  ) {
    throw new Error('Could not instrument the threaded WASI browser worker')
  }

  source = source.replace(
    constantsMarker,
    `${constantsMarker}
const TSFN_TEST_COUNTER_COUNT = 35
const TSFN_HOST_CALL_ARMED_INDEX = 4
const TSFN_NATIVE_QUEUE_CONFIRMED_INDEX = 5
const TSFN_NATIVE_WAIT_ENTERED_INDEX = 6
const TSFN_NATIVE_WAIT_RETURNED_INDEX = 7
const TSFN_AFTER_NATIVE_ENTERED_INDEX = 8
const TSFN_AFTER_NATIVE_RELEASED_INDEX = 9
const TSFN_BLOCKING_RETURNED_INDEX = 10
const TSFN_SLOT_RELEASE_CONFIRMED_INDEX = 27
const TSFN_NATIVE_WAIT_ADDRESS_CONFIRMED_INDEX = 28
const TSFN_UNEXPECTED_INDEX = 29
const TSFN_COND_OFFSET = 56
const TSFN_QUEUE_SIZE_OFFSET = 60
const TSFN_STATE_OFFSET = 140
const TSFN_MAX_QUEUE_SIZE_OFFSET = 152
`,
  )
  source = source.replace(
    onLoadMarker,
    `${onLoadMarker}    let tsfnTestStatePointerSlot\n`,
  )
  source = source.replace(
    importsMarker,
    `      overwriteImports(importObject) {
        let blockingCallFunction = 0
        const callThreadsafeFunction =
          importObject.napi.napi_call_threadsafe_function
        const releaseThreadsafeFunction =
          importObject.napi.napi_release_threadsafe_function
        importObject.napi.napi_release_threadsafe_function = function (
          func,
          mode,
        ) {
          const statePointer = tsfnTestStatePointerSlot
            ? Atomics.load(
                new Uint32Array(
                  wasmMemory.buffer,
                  tsfnTestStatePointerSlot,
                  1,
                ),
                0,
              )
            : 0
          if (statePointer && mode === 0 && blockingCallFunction !== 0) {
            const state = new Int32Array(
              wasmMemory.buffer,
              statePointer,
              TSFN_TEST_COUNTER_COUNT,
            )
            if (
              Atomics.load(state, TSFN_AFTER_NATIVE_ENTERED_INDEX) === 1 &&
              Atomics.load(state, TSFN_AFTER_NATIVE_RELEASED_INDEX) === 1 &&
              Atomics.load(state, TSFN_BLOCKING_RETURNED_INDEX) === 0
            ) {
              if (func !== blockingCallFunction) {
                Atomics.compareExchange(
                  state,
                  TSFN_UNEXPECTED_INDEX,
                  0,
                  51,
                )
                return 1
              }
              Atomics.store(
                state,
                TSFN_SLOT_RELEASE_CONFIRMED_INDEX,
                1,
              )
              blockingCallFunction = 0
            }
          }
          return releaseThreadsafeFunction(func, mode)
        }
        importObject.napi.napi_call_threadsafe_function = function (
          func,
          data,
          mode,
        ) {
          const statePointer = tsfnTestStatePointerSlot
            ? Atomics.load(
                new Uint32Array(
                  wasmMemory.buffer,
                  tsfnTestStatePointerSlot,
                  1,
                ),
                0,
              )
            : 0
          if (!statePointer || mode !== 1) {
            return callThreadsafeFunction(func, data, mode)
          }
          const state = new Int32Array(
            wasmMemory.buffer,
            statePointer,
            TSFN_TEST_COUNTER_COUNT,
          )
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
            Atomics.compareExchange(state, TSFN_UNEXPECTED_INDEX, 0, 50)
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
            return callThreadsafeFunction(func, data, mode)
          } finally {
            Atomics.wait = atomicWait
          }
        }
        importObject.env = {`,
  )
  source = source.replace(
    beforeInitMarker,
    `          memory: wasmMemory,
        }
      },
      beforeInit({ instance }) {
        tsfnTestStatePointerSlot =
          instance.exports.__napi_rs_test_tsfn_state_ptr()
      },
    })`,
  )
  const prettierConfig = await resolveConfig(workerPath)
  await writeFile(
    workerPath,
    await format(source, { ...prettierConfig, filepath: workerPath }),
  )
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

  await exposeLifecycleExportsAcrossTargets(target)
  if (previousDeclarationSource !== undefined) {
    await preserveLifecycleDeclarations(previousDeclarationSource)
  }
  if (target === 'wasm32-wasip1-threads') {
    await instrumentThreadedWasiBrowserTsfnWait()
  }

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
