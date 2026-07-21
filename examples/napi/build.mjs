import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, resolveConfig } from 'prettier'

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const napiCli = fileURLToPath(new URL('../../cli/cli.mjs', import.meta.url))
const REGENERATE_ALL_FLAG = '--regenerate-all'
const nativeRootOutputFiles = ['index.cjs', 'index.d.cts']
const configuredWasiTargets = ['wasm32-wasip1', 'wasm32-wasip1-threads']
const threadlessOutputFiles = [
  'browser.js',
  'example.wasm32-wasip1.wasm',
  'example.wasm32-wasip1.debug.wasm',
  'example.wasip1.cjs',
  'example.wasip1.d.cts',
  'example.wasip1-browser.js',
  'example.wasip1-deferred.js',
  'example.wasip1-deferred.d.ts',
]
const regenerationBuildArguments = [
  [],
  ...configuredWasiTargets.map((target) => [
    '--target',
    target,
    '--profile',
    'wasi',
  ]),
]
const cargoBuildTargetEnvironmentVariable = 'CARGO_BUILD_TARGET'

function withoutImplicitCargoTarget(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => name.toUpperCase() !== cargoBuildTargetEnvironmentVariable,
    ),
  )
}

function emittedWasiTargets(target) {
  return target?.startsWith('wasm32-') ? [target] : configuredWasiTargets
}

function run(arguments_, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [napiCli, ...arguments_], {
      cwd: packageDirectory,
      env: environment,
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

async function readNativeRootOutputs() {
  return Object.fromEntries(
    await Promise.all(
      nativeRootOutputFiles.map(async (file) => [
        file,
        await readFile(new URL(file, import.meta.url)),
      ]),
    ),
  )
}

async function restoreNativeRootOutputs(outputs) {
  await Promise.all(
    nativeRootOutputFiles.map((file) =>
      writeFile(new URL(file, import.meta.url), outputs[file]),
    ),
  )
}

async function readOutputFiles(files) {
  const outputs = {}
  await Promise.all(
    files.map(async (file) => {
      try {
        outputs[file] = await readFile(new URL(file, import.meta.url))
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error
        }
      }
    }),
  )
  return outputs
}

async function restoreOutputFiles(outputs) {
  await Promise.all(
    Object.entries(outputs).map(([file, contents]) =>
      writeFile(new URL(file, import.meta.url), contents),
    ),
  )
}

export async function formatGeneratedOutputs(paths) {
  await Promise.all(
    paths.map(async (path) => {
      const source = await readFile(path, 'utf8')
      const prettierConfig = await resolveConfig(path)
      const formatted = await format(source, {
        ...prettierConfig,
        filepath: path,
      })
      if (formatted !== source) {
        await writeFile(path, formatted)
      }
    }),
  )
}

export async function regenerateArtifacts({
  runBuild = main,
  readRootOutputs = readNativeRootOutputs,
  restoreRootOutputs = restoreNativeRootOutputs,
  readRetainedFlavorOutputs = () => readOutputFiles(threadlessOutputFiles),
  restoreRetainedFlavorOutputs = restoreOutputFiles,
  environment = process.env,
} = {}) {
  const explicitTargetEnvironment = withoutImplicitCargoTarget(environment)
  await runBuild(regenerationBuildArguments[0], explicitTargetEnvironment)
  const nativeRootOutputs = await readRootOutputs()
  let retainedFlavorOutputs
  try {
    await runBuild(regenerationBuildArguments[1], explicitTargetEnvironment)
    retainedFlavorOutputs = await readRetainedFlavorOutputs()
    await runBuild(regenerationBuildArguments[2], explicitTargetEnvironment)
  } finally {
    try {
      if (retainedFlavorOutputs !== undefined) {
        await restoreRetainedFlavorOutputs(retainedFlavorOutputs)
      }
    } finally {
      await restoreRootOutputs(nativeRootOutputs)
    }
  }
}

async function main(userArguments, environment = process.env) {
  const target =
    optionValue(userArguments, ['--target', '-t']) ??
    environment.CARGO_BUILD_TARGET
  const wasiTargets = emittedWasiTargets(target)

  await run(
    [
      'build',
      '--platform',
      '--js',
      'index.cjs',
      '--dts',
      'index.d.cts',
      ...userArguments,
    ],
    environment,
  )

  if (wasiTargets.includes('wasm32-wasip1')) {
    await formatGeneratedOutputs(
      [
        'example.wasip1-browser.js',
        'example.wasip1-deferred.js',
        'example.wasip1-deferred.d.ts',
      ].map((file) => fileURLToPath(new URL(file, import.meta.url))),
    )
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const userArguments = process.argv.slice(2)
  if (userArguments.includes(REGENERATE_ALL_FLAG)) {
    if (userArguments.length !== 1) {
      throw new Error(`${REGENERATE_ALL_FLAG} does not accept build arguments`)
    }
    await regenerateArtifacts()
  } else {
    await main(userArguments)
  }
}
