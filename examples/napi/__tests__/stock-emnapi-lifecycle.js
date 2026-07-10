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

function packageRoot(specifier) {
  let current = dirname(require.resolve(specifier))
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

async function copyPackage(specifier, destination) {
  await mkdir(dirname(destination), { recursive: true })
  await cp(packageRoot(specifier), destination, { recursive: true })
}

async function runIsolatedLifecycle(directory) {
  const loaderName = `example.${loaderSuffix}.cjs`
  const loaderPath = join(directory, loaderName)
  const isolatedRequire = createRequire(loaderPath)
  const resolvedLoaderPath = isolatedRequire.resolve(loaderPath)
  const emnapiRuntime = isolatedRequire('@emnapi/runtime')
  const originalCreateContext = emnapiRuntime.createContext
  const initialBeforeExitListeners = new Set(process.rawListeners('beforeExit'))
  const initialExitListeners = new Set(process.rawListeners('exit'))
  let destroyCalls = 0

  assert.equal(isolatedRequire('@emnapi/runtime').version, '1.11.2')
  assert.equal(isolatedRequire('@emnapi/core').version, '1.11.2')

  function load() {
    const contexts = []
    emnapiRuntime.createContext = function captureContext(...args) {
      const context = Reflect.apply(originalCreateContext, this, args)
      const originalDestroy = context.destroy
      context.destroy = function capturedDestroy(...destroyArgs) {
        destroyCalls += 1
        return Reflect.apply(originalDestroy, this, destroyArgs)
      }
      contexts.push(context)
      return context
    }
    let binding
    try {
      binding = isolatedRequire(resolvedLoaderPath)
    } finally {
      emnapiRuntime.createContext = originalCreateContext
    }
    assert.equal(contexts.length, 1)
    return binding
  }

  const binding = load()
  assert.equal(binding.add(1, 2), 3)
  binding.registerEnvCleanupRuntimeLifecycleProbes(
    join(directory, 'cleanup'),
    join(directory, 'async-cleanup'),
  )
  assert.equal(
    process
      .rawListeners('beforeExit')
      .filter((listener) => !initialBeforeExitListeners.has(listener)).length,
    0,
  )
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
    assert.equal(completedCycles, 3)
    assert.equal(destroyCalls, 1)
    process.stdout.write(`stock emnapi lifecycle passed: ${loaderSuffix}\n`)
  })
}

if (childMode) {
  await runIsolatedLifecycle(process.argv[4])
} else {
  const directory = await mkdtemp(join(tmpdir(), 'napi-stock-emnapi-'))
  const loaderName = `example.${loaderSuffix}.cjs`
  const wasmFlavor = loaderSuffix === 'wasi' ? 'wasm32-wasi' : 'wasm32-wasip1'
  const wasmName = `example.${wasmFlavor}.wasm`

  try {
    assert.notEqual(
      packageRoot('@emnapi/core-stock'),
      packageRoot('@emnapi/core'),
      'stock @emnapi/core must bypass the workspace patch',
    )
    assert.notEqual(
      packageRoot('@emnapi/runtime-stock'),
      packageRoot('@emnapi/runtime'),
      'stock @emnapi/runtime must bypass the workspace patch',
    )

    await Promise.all([
      cp(join(exampleDirectory, loaderName), join(directory, loaderName)),
      cp(join(exampleDirectory, wasmName), join(directory, wasmName)),
      copyPackage(
        '@emnapi/core-stock',
        join(directory, 'node_modules', '@emnapi', 'core'),
      ),
      copyPackage(
        '@emnapi/runtime-stock',
        join(directory, 'node_modules', '@emnapi', 'runtime'),
      ),
      copyPackage(
        '@emnapi/wasi-threads',
        join(directory, 'node_modules', '@emnapi', 'wasi-threads'),
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
    assert.match(result.stdout, /stock emnapi lifecycle passed/)
    assert.equal(await readFile(join(directory, 'cleanup'), 'utf8'), '0')
    assert.equal(await readFile(join(directory, 'async-cleanup'), 'utf8'), '0')
    process.stdout.write(result.stdout)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
