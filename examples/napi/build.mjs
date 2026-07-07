import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { unsupportedWasiFunctions } from './unsupported-wasi-exports.mjs'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const napiCli = fileURLToPath(new URL('../../cli/cli.mjs', import.meta.url))
const declarationPath = fileURLToPath(new URL('index.d.cts', import.meta.url))

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

async function exposeLifecycleExportsAcrossTargets() {
  const bindings = [
    {
      file: 'index.cjs',
      binding: 'nativeBinding',
      helper: 'getBindingExport',
      marker: 'module.exports = nativeBinding\n',
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
      assignment(name) {
        return [
          `export const ${name} = __napiModule.exports.${name}`,
          `export const ${name} = getWasiBindingExport('${name}')`,
        ]
      },
    },
  ]

  for (const { file, binding, helper, marker, assignment } of bindings) {
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
    for (const name of unsupportedWasiFunctions) {
      const [generated, replacement] = assignment(name)
      if (source.includes(replacement)) {
        continue
      }
      if (source.includes(generated)) {
        source = source.replace(generated, replacement)
      } else {
        source += `${source.endsWith('\n') ? '' : '\n'}${replacement}\n`
      }
    }
    await writeFile(path, source)
  }
}

export function mergeLifecycleDeclarations(source, previousSource) {
  const missingDeclarations = []
  const declarationStarts = [
    'export interface AsyncWorkLifecycleHandle {',
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
    missingDeclarations.push(previousSource.slice(start, end).trimEnd())
  }

  if (missingDeclarations.length === 0) {
    return source
  }

  return `${source.trimEnd()}\n\n${missingDeclarations.join('\n\n')}\n`
}

async function preserveLifecycleDeclarations(previousSource) {
  const source = await readFile(declarationPath, 'utf8')
  const nextSource = mergeLifecycleDeclarations(source, previousSource)

  if (nextSource !== source) {
    await writeFile(declarationPath, nextSource)
  }
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
