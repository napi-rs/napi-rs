import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const napiCli = fileURLToPath(new URL('../../cli/cli.mjs', import.meta.url))
const rawArguments = process.argv.slice(2)
const pureOnly = rawArguments.includes('--pure-only')
const userArguments = rawArguments.filter(
  (argument) => argument !== '--pure-only',
)

function run(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [napiCli, 'build', ...arguments_], {
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
            `napi build ${arguments_.join(' ')} exited with code ${code} and signal ${signal}`,
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

function pureRuntimeArguments(arguments_) {
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

if (!pureOnly) {
  await run([
    '--platform',
    '--js',
    'index.cjs',
    '--dts',
    'index.d.cts',
    ...userArguments,
  ])
}

const target =
  optionValue(userArguments, ['--target', '-t']) ??
  process.env.CARGO_BUILD_TARGET

if (!target?.startsWith('wasm32-')) {
  await rm(join(packageDirectory, '.pure-runtime'), {
    recursive: true,
    force: true,
  })
  await run([
    '--platform',
    '--no-js',
    '--package-json-path',
    'pure-runtime.package.json',
    '--output-dir',
    '.pure-runtime',
    '--dts',
    'index.d.cts',
    '--no-default-features',
    '--features',
    'async-runtime',
    ...pureRuntimeArguments(userArguments),
  ])
}
