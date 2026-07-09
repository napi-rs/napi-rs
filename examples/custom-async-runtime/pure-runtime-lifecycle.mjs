import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads'

const timeoutMilliseconds = 20_000

function waitForMessage(worker) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timed out waiting for pure-runtime worker metrics'))
    }, timeoutMilliseconds)
    const onMessage = (message) => {
      cleanup()
      if (message?.error) {
        reject(new Error(message.error))
      } else {
        resolve(message)
      }
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code) => {
      cleanup()
      reject(new Error(`pure-runtime worker exited early with code ${code}`))
    }
    const cleanup = () => {
      clearTimeout(timer)
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }

    worker.once('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
  })
}

async function assertFileMissing(path, message) {
  await assert.rejects(
    access(path),
    (error) => error?.code === 'ENOENT',
    message,
  )
}

async function waitForFile(path, message) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error
      }
    }
    await delay(10)
  }
  throw new Error(message)
}

export async function findPureRuntimeBinding() {
  const directory = new URL('./.pure-runtime/', import.meta.url)
  const bindings = (await readdir(directory)).filter(
    (filename) =>
      filename.startsWith('custom_async_runtime_pure.') &&
      filename.endsWith('.node'),
  )
  assert.equal(
    bindings.length,
    1,
    `expected one pure-runtime native artifact, found ${bindings.join(', ')}`,
  )
  return fileURLToPath(new URL(bindings[0], directory))
}

function runPureRuntimeFailedStartRollback(bindingFile) {
  const environment = { ...process.env }
  for (const name of [
    'NAPI_CUSTOM_RUNTIME_DROP_PROBE',
    'NAPI_CUSTOM_RUNTIME_TEST_DUPLICATE',
    'NAPI_CUSTOM_RUNTIME_TEST_MISSING',
  ]) {
    delete environment[name]
  }
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const bindingFile = ${JSON.stringify(bindingFile)}
        const cacheKey = require.resolve(bindingFile)
        process.env.NAPI_CUSTOM_RUNTIME_TEST_START_ERROR = '1'
        let startError
        try {
          require(bindingFile)
        } catch (error) {
          startError = error
        } finally {
          delete process.env.NAPI_CUSTOM_RUNTIME_TEST_START_ERROR
        }
        if (!startError) {
          throw new Error('pure addon load unexpectedly survived the injected start failure')
        }
        const errors = []
        for (let current = startError; current; current = current.cause) {
          errors.push(String(current))
        }
        if (!/injected custom runtime start error/i.test(errors.join('\\n'))) {
          throw startError
        }
        if (require.cache[cacheKey] !== undefined) {
          throw new Error('failed pure addon load remained in require.cache')
        }

        const binding = require(bindingFile)
        const timeout = setTimeout(
          () => {
            console.error('timed out waiting for pure failed-start recovery')
            process.exitCode = 1
          },
          5000,
        )
        ;(async () => {
          const value = await binding.asyncDouble(21)
          if (value !== 42) {
            throw new Error(\`unexpected pure failed-start recovery result: \${value}\`)
          }
          const metrics = binding.getRuntimeMetrics()
          if (metrics.tokioRuntimeEnabled !== false) {
            throw new Error('pure failed-start recovery unexpectedly enabled Tokio')
          }
          if (
            metrics.moduleInitCalls !== 1 ||
            metrics.runtimeRegistrationCalls !== 1 ||
            metrics.backendDropCalls !== 0 ||
            metrics.startCalls !== 1 ||
            metrics.shutdownCalls !== 1
          ) {
            throw new Error(
              \`pure failed-start recovery has invalid metrics: \${JSON.stringify(metrics)}\`,
            )
          }
          console.log('pure failed-start rollback recovered async submissions')
        })().then(
          () => clearTimeout(timeout),
          (error) => {
            clearTimeout(timeout)
            console.error(error)
            process.exitCode = 1
          },
        )
      `,
    ],
    {
      encoding: 'utf8',
      env: environment,
      timeout: timeoutMilliseconds,
    },
  )
  assert.equal(result.error, undefined, result.error?.stack)
  assert.equal(result.signal, null, `${result.stdout}\n${result.stderr}`)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  assert.match(
    result.stdout,
    /pure failed-start rollback recovered async submissions/,
  )
}

export async function runPureRuntimeReloadLifecycle(bindingFile) {
  assert.ok(
    isAbsolute(bindingFile),
    'pure-runtime binding path must be absolute',
  )

  const require = createRequire(import.meta.url)
  assert.equal(
    require.cache[bindingFile],
    undefined,
    'the parent process must not load the pure-runtime artifact',
  )

  const missingResult = spawnSync(
    process.execPath,
    [
      '-e',
      `
        const binding = require(${JSON.stringify(bindingFile)})
        console.log('pure addon loaded without a backend')
        const timeout = setTimeout(
          () => {
            console.error('timed out waiting for missing-backend rejection')
            process.exitCode = 1
          },
          5000,
        )
        ;(async () => {
          async function assertMissingRuntimePromise(operation, label) {
            let promise
            try {
              promise = operation()
            } catch (error) {
              throw new Error(
                \`\${label} threw synchronously instead of returning a Promise: \${error}\`,
                { cause: error },
              )
            }
            if (!(promise instanceof Promise)) {
              throw new TypeError(\`\${label} did not return a Promise\`)
            }
            try {
              await promise
            } catch (error) {
              const errors = []
              let current = error
              while (current) {
                errors.push(String(current))
                current = current.cause
              }
              if (/No AsyncRuntime backend is registered/i.test(errors.join('\\n'))) {
                return
              }
              throw error
            }
            throw new Error(\`\${label} unexpectedly succeeded without a backend\`)
          }

          await assertMissingRuntimePromise(
            () => binding.asyncDouble(21),
            'generated async export',
          )
          console.log('pure async operation rejected without a backend')

          for (const [method, argument] of [
            ['next', undefined],
            ['return', undefined],
            ['throw', new Error('missing runtime iterator throw')],
          ]) {
            const iterator = new binding.RuntimeAsyncIterator()[Symbol.asyncIterator]()
            await assertMissingRuntimePromise(
              () => iterator[method](argument),
              \`\${method}()\`,
            )
          }
          console.log('pure async iterators rejected without a backend')
        })().then(
          () => clearTimeout(timeout),
          (error) => {
            clearTimeout(timeout)
            console.error(error)
            process.exitCode = 1
          },
        )
      `,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, NAPI_CUSTOM_RUNTIME_TEST_MISSING: '1' },
      timeout: timeoutMilliseconds,
    },
  )
  assert.equal(
    missingResult.signal,
    null,
    `${missingResult.stdout}\n${missingResult.stderr}`,
  )
  assert.equal(
    missingResult.status,
    0,
    `${missingResult.stdout}\n${missingResult.stderr}`,
  )
  assert.match(missingResult.stdout, /loaded without a backend/)
  assert.match(missingResult.stdout, /operation rejected without a backend/)
  assert.match(
    missingResult.stdout,
    /async iterators rejected without a backend/,
  )
  runPureRuntimeFailedStartRollback(bindingFile)

  const directory = await mkdtemp(join(tmpdir(), 'napi-pure-runtime-reload-'))
  const dropMarker = join(directory, 'backend-dropped')
  const previousDropProbe = process.env.NAPI_CUSTOM_RUNTIME_DROP_PROBE
  process.env.NAPI_CUSTOM_RUNTIME_DROP_PROBE = dropMarker
  let backendIdentity

  try {
    for (let generation = 0; generation < 3; generation += 1) {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { bindingFile },
      })
      try {
        const result = await waitForMessage(worker)
        assert.equal(result.value, 42)
        assert.equal(result.metrics.tokioRuntimeEnabled, false)
        assert.equal(result.metrics.moduleInitCalls, 1)
        assert.equal(result.metrics.runtimeRegistrationCalls, 1)
        assert.equal(result.metrics.startCalls, generation + 1)
        assert.equal(result.metrics.shutdownCalls, generation)
        assert.equal(result.metrics.backendDropCalls, 0)
        if (backendIdentity === undefined) {
          backendIdentity = result.metrics.backendIdentity
          assert.ok(backendIdentity, 'backend identity must not be empty')
        } else {
          assert.equal(
            result.metrics.backendIdentity,
            backendIdentity,
            'sequential workers must reuse one retained backend',
          )
        }
      } finally {
        await worker.terminate()
      }

      await assertFileMissing(
        dropMarker,
        `backend Drop ran after worker generation ${generation + 1}`,
      )
      assert.equal(
        require.cache[bindingFile],
        undefined,
        'the parent process must remain free of the pure-runtime artifact',
      )
    }

    console.log('pure async-runtime reload lifecycle passed')
  } finally {
    if (previousDropProbe === undefined) {
      delete process.env.NAPI_CUSTOM_RUNTIME_DROP_PROBE
    } else {
      process.env.NAPI_CUSTOM_RUNTIME_DROP_PROBE = previousDropProbe
    }
    await rm(directory, { recursive: true, force: true })
  }
}

export async function runPureRuntimeRegistrationRace(bindingFile) {
  assert.ok(
    isAbsolute(bindingFile),
    'pure-runtime binding path must be absolute',
  )

  const directory = await mkdtemp(
    join(tmpdir(), 'napi-pure-runtime-registration-race-'),
  )
  const enteredPath = join(directory, 'shutdown-entered')
  const replacementAttemptPath = join(directory, 'replacement-attempted')
  const releasePath = join(directory, 'shutdown-release')
  const workerEnvironment = {
    ...process.env,
    NAPI_CUSTOM_RUNTIME_LIFECYCLE_TEST: '1',
  }
  let retiringWorker
  let replacementWorker
  let retiringTermination

  try {
    retiringWorker = new Worker(new URL(import.meta.url), {
      env: workerEnvironment,
      workerData: {
        bindingFile,
        enteredPath,
        mode: 'arm-shutdown',
        releasePath,
      },
    })
    const ready = await waitForMessage(retiringWorker)
    assert.equal(ready.value, 42)
    assert.equal(ready.metrics.tokioRuntimeEnabled, false)

    retiringTermination = retiringWorker.terminate()
    await waitForFile(
      enteredPath,
      'pure-runtime shutdown did not enter the lifecycle barrier',
    )

    replacementWorker = new Worker(new URL(import.meta.url), {
      env: workerEnvironment,
      workerData: {
        attemptPath: replacementAttemptPath,
        bindingFile,
        mode: 'load',
      },
    })
    let replacementSettled = false
    const replacement = waitForMessage(replacementWorker).then(
      (result) => {
        replacementSettled = true
        return result
      },
      (error) => {
        replacementSettled = true
        throw error
      },
    )

    await waitForFile(
      replacementAttemptPath,
      'replacement worker did not reach module registration',
    )
    await delay(100)
    assert.equal(
      replacementSettled,
      false,
      'replacement registration completed before last-environment shutdown',
    )

    await writeFile(releasePath, 'release')
    await retiringTermination
    retiringTermination = undefined
    const replacementResult = await replacement
    assert.equal(replacementResult.value, 42)
    assert.equal(replacementResult.metrics.tokioRuntimeEnabled, false)
    assert.equal(replacementResult.metrics.backendDropCalls, 0)

    console.log('pure async-runtime registration race passed')
  } finally {
    await writeFile(releasePath, 'release').catch(() => {})
    await retiringTermination?.catch(() => {})
    await retiringWorker?.terminate().catch(() => {})
    await replacementWorker?.terminate().catch(() => {})
    await rm(directory, { recursive: true, force: true })
  }
}

async function runWorker() {
  try {
    const require = createRequire(import.meta.url)
    if (workerData.attemptPath) {
      await writeFile(workerData.attemptPath, 'attempted')
    }
    const binding = require(workerData.bindingFile)
    if (workerData.mode === 'arm-shutdown') {
      const value = await binding.asyncDouble(21)
      binding.armSubmissionTransitionBarrier(
        'shutdown',
        workerData.enteredPath,
        workerData.releasePath,
      )
      parentPort.postMessage({
        metrics: binding.getRuntimeMetrics(),
        value,
      })
      return
    }
    const value = await binding.asyncDouble(21)
    parentPort.postMessage({
      metrics: binding.getRuntimeMetrics(),
      value,
    })
  } catch (error) {
    parentPort.postMessage({ error: error?.stack ?? String(error) })
  }
}

if (!isMainThread) {
  await runWorker()
} else if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await runPureRuntimeReloadLifecycle(
    process.argv[2] ?? (await findPureRuntimeBinding()),
  )
}
