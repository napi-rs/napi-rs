import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const exampleDirectory = join(__dirname, '..')
const loaderSuffix = process.argv[2]
const childMode = process.argv[3] === '--isolated-child'

assert.ok(
  loaderSuffix === 'wasi' || loaderSuffix === 'wasip1',
  `unsupported WASI loader suffix: ${loaderSuffix}`,
)

function packageRoot(specifier, resolver = require) {
  let current = dirname(resolver.resolve(specifier))
  while (!existsSync(join(current, 'package.json'))) {
    const parent = dirname(current)
    assert.notEqual(
      parent,
      current,
      `could not find package root for ${specifier}`,
    )
    current = parent
  }
  return current
}

async function copyPackage(specifier, destination, resolver = require) {
  await mkdir(dirname(destination), { recursive: true })
  await cp(packageRoot(specifier, resolver), destination, { recursive: true })
}

async function runIsolatedLifecycle(directory) {
  const loaderName = `example.${loaderSuffix}.cjs`
  const loaderPath = join(directory, loaderName)
  const isolatedRequire = createRequire(loaderPath)
  const resolvedLoaderPath = isolatedRequire.resolve(loaderPath)
  const emnapiCoreRequire = createRequire(
    isolatedRequire.resolve('@emnapi/core'),
  )
  const emnapiRuntime = isolatedRequire('@emnapi/runtime')
  const { Context } = emnapiRuntime
  const originalSuppressDestroy = Context.prototype.suppressDestroy
  const originalDestroy = Context.prototype.destroy
  const initialBeforeExitListeners = new Set(process.rawListeners('beforeExit'))
  const initialExitListeners = new Set(process.rawListeners('exit'))
  const contexts = new Set()
  let destroyCalls = 0
  let suppressDestroyCalls = 0

  const runtimeVersion = emnapiRuntime.version
  const coreVersion = isolatedRequire('@emnapi/core').version
  const wasiThreadsVersion = JSON.parse(
    await readFile(
      join(
        packageRoot('@emnapi/wasi-threads', emnapiCoreRequire),
        'package.json',
      ),
      'utf8',
    ),
  ).version
  assert.match(runtimeVersion, /^2\./)
  assert.equal(coreVersion, runtimeVersion)
  assert.match(wasiThreadsVersion, /^2\./)

  Context.prototype.suppressDestroy = function capturedSuppressDestroy(
    ...suppressArgs
  ) {
    contexts.add(this)
    suppressDestroyCalls += 1
    return Reflect.apply(originalSuppressDestroy, this, suppressArgs)
  }
  Context.prototype.destroy = function capturedDestroy(...destroyArgs) {
    if (contexts.has(this)) {
      destroyCalls += 1
    }
    return Reflect.apply(originalDestroy, this, destroyArgs)
  }

  function restoreContextPrototype() {
    Context.prototype.suppressDestroy = originalSuppressDestroy
    Context.prototype.destroy = originalDestroy
  }

  function load() {
    let binding
    try {
      binding = isolatedRequire(resolvedLoaderPath)
    } catch (error) {
      restoreContextPrototype()
      throw error
    }
    assert.equal(contexts.size, 1)
    assert.equal(suppressDestroyCalls, 1)
    return binding
  }

  const binding = load()
  assert.equal(binding.add(1, 2), 3)
  binding.registerEnvCleanupRuntimeLifecycleProbes(
    join(directory, 'cleanup'),
    join(directory, 'async-cleanup'),
  )
  const addedBeforeExitListeners = process
    .rawListeners('beforeExit')
    .filter((listener) => !initialBeforeExitListeners.has(listener))
  assert.equal(addedBeforeExitListeners.length, 0)
  assert.equal(
    process
      .rawListeners('exit')
      .filter((listener) => !initialExitListeners.has(listener)).length,
    1,
  )

  let completedCycles = 0
  const resumeWork = () => {
    const cycle = completedCycles + 1
    setImmediate(() => {
      assert.equal(binding.add(cycle, 40), cycle + 40)
      completedCycles = cycle
      if (completedCycles === 3) {
        process.removeListener('beforeExit', resumeWork)
      }
    })
  }
  process.on('beforeExit', resumeWork)
  process.once('exit', () => {
    try {
      assert.equal(completedCycles, 3)
      assert.equal(destroyCalls, 1)
      process.stdout.write(
        `published emnapi v2 lifecycle passed: ${loaderSuffix}\n`,
      )
    } finally {
      restoreContextPrototype()
    }
  })
}

if (childMode) {
  await runIsolatedLifecycle(process.argv[4])
} else {
  const directory = await mkdtemp(join(tmpdir(), 'napi-emnapi-v2-'))
  const loaderName = `example.${loaderSuffix}.cjs`
  const wasmFlavor = loaderSuffix === 'wasi' ? 'wasm32-wasi' : 'wasm32-wasip1'
  const wasmName = `example.${wasmFlavor}.wasm`
  const emnapiCoreRequire = createRequire(require.resolve('@emnapi/core'))

  try {
    await Promise.all([
      cp(join(exampleDirectory, loaderName), join(directory, loaderName)),
      cp(join(exampleDirectory, wasmName), join(directory, wasmName)),
      copyPackage(
        '@emnapi/core',
        join(directory, 'node_modules', '@emnapi', 'core'),
      ),
      copyPackage(
        '@emnapi/runtime',
        join(directory, 'node_modules', '@emnapi', 'runtime'),
      ),
      copyPackage(
        '@emnapi/wasi-threads',
        join(directory, 'node_modules', '@emnapi', 'wasi-threads'),
        emnapiCoreRequire,
      ),
      copyPackage(
        '@napi-rs/wasm-runtime',
        join(directory, 'node_modules', '@napi-rs', 'wasm-runtime'),
      ),
      copyPackage(
        '@tybys/wasm-util',
        join(directory, 'node_modules', '@tybys', 'wasm-util'),
      ),
      copyPackage('tslib', join(directory, 'node_modules', 'tslib')),
      ...(loaderSuffix === 'wasi'
        ? [
            cp(
              join(exampleDirectory, 'wasi-worker.mjs'),
              join(directory, 'wasi-worker.mjs'),
            ),
          ]
        : []),
    ])

    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(import.meta.url),
        loaderSuffix,
        '--isolated-child',
        directory,
      ],
      {
        encoding: 'utf8',
        timeout: 30_000,
      },
    )
    const output = `${result.stdout}\n${result.stderr}`
    assert.equal(result.error, undefined, result.error?.stack)
    assert.equal(result.signal, null, output)
    assert.equal(result.status, 0, output)
    assert.match(result.stdout, /published emnapi v2 lifecycle passed/)
    process.stdout.write(result.stdout)
    assert.equal(await readFile(join(directory, 'cleanup'), 'utf8'), '0')
    assert.equal(await readFile(join(directory, 'async-cleanup'), 'utf8'), '0')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
