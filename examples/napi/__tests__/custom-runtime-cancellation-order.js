import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from 'node:worker_threads'

const pureRuntimeDirectory = fileURLToPath(
  new URL('../../custom-async-runtime/.pure-runtime/', import.meta.url),
)
const bindingFiles = (await readdir(pureRuntimeDirectory)).filter(
  (filename) =>
    filename.startsWith('custom_async_runtime_pure.') &&
    filename.endsWith('.node'),
)
assert.equal(
  bindingFiles.length,
  1,
  `expected one pure custom-runtime binding, found ${bindingFiles.join(', ')}`,
)
const bindingFile = join(pureRuntimeDirectory, bindingFiles[0])
const require = createRequire(import.meta.url)
const binding = require(bindingFile)
const timeoutMilliseconds = 10_000

async function waitForFile(path) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await delay(5)
    }
  }
  throw new Error(`timed out waiting for ${path}`)
}

async function assertFileMissing(path, message) {
  await assert.rejects(
    access(path),
    (error) => error?.code === 'ENOENT',
    message,
  )
}

function withTimeout(promise, timeout, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout)
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function waitForWorkerReady(worker, description) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      cleanup()
      resolve(message)
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code) => {
      cleanup()
      reject(new Error(`${description} exited early with code ${code}`))
    }
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }

    worker.once('message', onMessage)
    worker.once('error', onError)
    worker.once('exit', onExit)
  })
}

function futureDropOrder(futureDropPath) {
  try {
    return readFileSync(futureDropPath, 'utf8') === 'dropped'
      ? 'after-drop'
      : 'before-drop'
  } catch {
    return 'before-drop'
  }
}

if (!isMainThread) {
  const workerBinding = require(workerData.bindingFile)
  if (
    workerData.role === 'active-poll' ||
    workerData.role === 'env-active-poll'
  ) {
    const activePoll = workerBinding.customRuntimePollCleanupOrder(
      workerData.wakePath,
      workerData.pollEnteredPath,
      workerData.pollReleasePath,
      workerData.futureDropEnteredPath,
      workerData.futureDropReleasePath,
      workerData.futureDropPath,
      workerData.terminalOrderPath,
      workerData.completionDropEnteredPath,
      workerData.completionDropReleasePath,
      workerData.role === 'active-poll',
    )
    if (workerData.settlementPath) {
      void activePoll.then(
        () => writeFileSync(workerData.settlementPath, 'resolved'),
        () => writeFileSync(workerData.settlementPath, 'rejected'),
      )
    } else {
      void activePoll.catch(() => {})
    }
  } else if (workerData.role === 'env-spawn-future') {
    const pending = workerBinding.customRuntimeSpawnFutureCancellationOrder(
      workerData.pollEnteredPath,
      workerData.futureDropEnteredPath,
      workerData.futureDropReleasePath,
      workerData.futureDropPath,
    )
    void pending.then(
      () =>
        writeFileSync(
          workerData.settlementPath,
          `resolved-${futureDropOrder(workerData.futureDropPath)}`,
        ),
      () =>
        writeFileSync(
          workerData.settlementPath,
          `rejected-${futureDropOrder(workerData.futureDropPath)}`,
        ),
    )
  } else {
    let optionProbe = new workerBinding.CancellationBorrowProbe(
      11,
      workerData.optionDropPath,
    )
    let eitherProbe = new workerBinding.CancellationBorrowProbe(
      12,
      workerData.eitherDropPath,
    )
    let firstSharedProbe = new workerBinding.CancellationBorrowProbe(
      13,
      workerData.firstSharedDropPath,
    )
    let secondSharedProbe = new workerBinding.CancellationBorrowProbe(
      14,
      workerData.secondSharedDropPath,
    )
    let firstMutableProbe = new workerBinding.CancellationBorrowProbe(
      15,
      workerData.firstMutableDropPath,
    )
    let secondMutableProbe = new workerBinding.CancellationBorrowProbe(
      16,
      workerData.secondMutableDropPath,
    )
    void workerBinding
      .customRuntimeNestedCancellationBorrow(
        optionProbe,
        eitherProbe,
        [firstSharedProbe, secondSharedProbe],
        [firstMutableProbe, secondMutableProbe],
        workerData.futureDropPath,
      )
      .catch(() => {})
    optionProbe = null
    eitherProbe = null
    firstSharedProbe = null
    secondSharedProbe = null
    firstMutableProbe = null
    secondMutableProbe = null
  }
  parentPort.postMessage('ready')
  await new Promise(() => {})
}

const directory = await mkdtemp(
  join(tmpdir(), 'napi-custom-runtime-cancellation-order-'),
)
const enteredPath = join(directory, 'drop-entered')
const releasePath = join(directory, 'drop-release')
const cancellationPath = join(directory, 'cancellation-complete')
const reentryPath = join(directory, 'runtime-reentry-result')
const futureDropPath = join(directory, 'nested-future-drop')
const activePollWakePath = join(directory, 'active-poll-wake')
const activePollShutdownEnteredPath = join(
  directory,
  'active-poll-shutdown-entered',
)
const activePollShutdownCompletedPath = join(
  directory,
  'active-poll-shutdown-completed',
)
const activePollEnteredPath = join(directory, 'active-poll-entered')
const activePollReleasePath = join(directory, 'active-poll-release')
const activePollFutureDropEnteredPath = join(
  directory,
  'active-poll-future-drop-entered',
)
const activePollFutureDropReleasePath = join(
  directory,
  'active-poll-future-drop-release',
)
const activePollFutureDropPath = join(directory, 'active-poll-future-drop')
const activePollTerminalOrderPath = join(
  directory,
  'active-poll-terminal-order',
)
const activePollSettlementPath = join(directory, 'active-poll-settlement')
const activePollCompletionDropEnteredPath = join(
  directory,
  'active-poll-completion-drop-entered',
)
const activePollCompletionDropReleasePath = join(
  directory,
  'active-poll-completion-drop-release',
)
const envPollWakePath = join(directory, 'env-poll-wake')
const envPollEnteredPath = join(directory, 'env-poll-entered')
const envPollReleasePath = join(directory, 'env-poll-release')
const envPollFutureDropEnteredPath = join(
  directory,
  'env-poll-future-drop-entered',
)
const envPollFutureDropReleasePath = join(
  directory,
  'env-poll-future-drop-release',
)
const envPollFutureDropPath = join(directory, 'env-poll-future-drop')
const envPollTerminalOrderPath = join(directory, 'env-poll-terminal-order')
const envSpawnPollEnteredPath = join(directory, 'env-spawn-poll-entered')
const envSpawnFutureDropEnteredPath = join(
  directory,
  'env-spawn-future-drop-entered',
)
const envSpawnFutureDropReleasePath = join(
  directory,
  'env-spawn-future-drop-release',
)
const envSpawnFutureDropPath = join(directory, 'env-spawn-future-drop')
const envSpawnSettlementPath = join(directory, 'env-spawn-settlement')
const explicitSpawnPollEnteredPath = join(
  directory,
  'explicit-spawn-poll-entered',
)
const explicitSpawnFutureDropEnteredPath = join(
  directory,
  'explicit-spawn-future-drop-entered',
)
const explicitSpawnFutureDropReleasePath = join(
  directory,
  'explicit-spawn-future-drop-release',
)
const explicitSpawnFutureDropPath = join(
  directory,
  'explicit-spawn-future-drop',
)
const explicitSpawnSettlementPath = join(directory, 'explicit-spawn-settlement')
const explicitSpawnShutdownPath = join(directory, 'explicit-spawn-shutdown')
const nestedDropPaths = [
  join(directory, 'nested-option-drop'),
  join(directory, 'nested-either-drop'),
  join(directory, 'nested-shared-1-drop'),
  join(directory, 'nested-shared-2-drop'),
  join(directory, 'nested-mutable-1-drop'),
  join(directory, 'nested-mutable-2-drop'),
]
let nestedWorker
let activePollWorker
let envCleanupWorker
let envSpawnWorker

try {
  const probe = new binding.CancellationBorrowProbe(1)
  let settled = false
  const pending = binding
    .customRuntimeCancellationBorrow(probe, enteredPath, releasePath)
    .then(
      () => {
        settled = true
        throw new Error('pending custom-runtime task unexpectedly resolved')
      },
      (error) => {
        settled = true
        return error
      },
    )

  binding.cancelCustomRuntimeForOrderProbe(cancellationPath)
  await waitForFile(enteredPath)
  await delay(100)

  assert.equal(
    settled,
    false,
    'cancellation settled before the task future finished dropping',
  )
  assert.throws(
    () => probe.setValue(2),
    /cannot be borrowed mutably while another borrow is active/i,
    'the owner-thread finalizer released the native borrow during future destruction',
  )
  assert.equal(probe.getValue(), 1)

  await writeFile(releasePath, 'release')
  const cancellationError = await pending
  assert.match(String(cancellationError), /cancel/i)
  await waitForFile(cancellationPath)
  assert.equal(await readFile(cancellationPath, 'utf8'), 'cancelled')

  probe.setValue(3)
  assert.equal(probe.getValue(), 3)

  binding.startRuntime()
  const reentrant = binding.customRuntimeCancellationReentry(reentryPath)
  binding.shutdownRuntime()
  await assert.rejects(reentrant, /cancel/i)
  const [status, ...reason] = (await readFile(reentryPath, 'utf8')).split('\n')
  assert.equal(status, 'GenericFailure')
  assert.match(reason.join('\n'), /async runtime is not running/i)

  binding.startRuntime()
  nestedWorker = new Worker(new URL(import.meta.url), {
    workerData: {
      bindingFile,
      role: 'nested-borrow',
      futureDropPath,
      optionDropPath: nestedDropPaths[0],
      eitherDropPath: nestedDropPaths[1],
      firstSharedDropPath: nestedDropPaths[2],
      secondSharedDropPath: nestedDropPaths[3],
      firstMutableDropPath: nestedDropPaths[4],
      secondMutableDropPath: nestedDropPaths[5],
    },
  })
  await waitForWorkerReady(nestedWorker, 'nested-borrow worker')

  binding.deferNextTaskWake()
  await withTimeout(
    nestedWorker.terminate(),
    timeoutMilliseconds,
    'worker cleanup waited for the scheduler to poll its cancelled task',
  )
  nestedWorker = undefined
  await waitForFile(futureDropPath)
  assert.equal(await readFile(futureDropPath, 'utf8'), '11,12,27,33')
  for (const dropPath of nestedDropPaths) {
    await waitForFile(dropPath)
  }

  activePollWorker = new Worker(new URL(import.meta.url), {
    workerData: {
      bindingFile,
      role: 'active-poll',
      wakePath: activePollWakePath,
      pollEnteredPath: activePollEnteredPath,
      pollReleasePath: activePollReleasePath,
      futureDropEnteredPath: activePollFutureDropEnteredPath,
      futureDropReleasePath: activePollFutureDropReleasePath,
      futureDropPath: activePollFutureDropPath,
      terminalOrderPath: activePollTerminalOrderPath,
      settlementPath: activePollSettlementPath,
      completionDropEnteredPath: activePollCompletionDropEnteredPath,
      completionDropReleasePath: activePollCompletionDropReleasePath,
    },
  })
  await waitForWorkerReady(activePollWorker, 'active-poll worker')
  await writeFile(activePollWakePath, 'wake')
  await waitForFile(activePollEnteredPath)
  await writeFile(activePollReleasePath, 'release')
  await waitForFile(activePollFutureDropEnteredPath)
  await waitForFile(activePollFutureDropPath)
  await waitForFile(activePollCompletionDropEnteredPath)

  binding.armCustomRuntimePollShutdownProbe(activePollShutdownEnteredPath)
  binding.cancelCustomRuntimeForOrderProbe(activePollShutdownCompletedPath)
  await waitForFile(activePollShutdownEnteredPath)
  await delay(100)
  await assertFileMissing(
    activePollSettlementPath,
    'completion settled while its success-side destructor was still active',
  )
  await assertFileMissing(
    activePollTerminalOrderPath,
    'the terminal callback ran while the success-side destructor was still active',
  )

  await writeFile(activePollCompletionDropReleasePath, 'release')
  await waitForFile(activePollShutdownCompletedPath)
  assert.equal(
    await readFile(activePollShutdownCompletedPath, 'utf8'),
    'cancelled',
  )
  await waitForFile(activePollFutureDropPath)
  await waitForFile(activePollTerminalOrderPath)
  assert.equal(await readFile(activePollFutureDropPath, 'utf8'), 'dropped')
  assert.equal(
    await readFile(activePollTerminalOrderPath, 'utf8'),
    'after-drop',
  )
  await waitForFile(activePollSettlementPath)
  assert.equal(await readFile(activePollSettlementPath, 'utf8'), 'resolved')
  await withTimeout(
    activePollWorker.terminate(),
    timeoutMilliseconds,
    'active-poll worker did not terminate after runtime shutdown',
  )
  activePollWorker = undefined

  binding.startRuntime()
  assert.equal(await binding.asyncDouble(6), 12)

  envCleanupWorker = new Worker(new URL(import.meta.url), {
    workerData: {
      bindingFile,
      role: 'env-active-poll',
      wakePath: envPollWakePath,
      pollEnteredPath: envPollEnteredPath,
      pollReleasePath: envPollReleasePath,
      futureDropEnteredPath: envPollFutureDropEnteredPath,
      futureDropReleasePath: envPollFutureDropReleasePath,
      futureDropPath: envPollFutureDropPath,
      terminalOrderPath: envPollTerminalOrderPath,
    },
  })
  await waitForWorkerReady(envCleanupWorker, 'environment-cleanup worker')
  await writeFile(envPollFutureDropReleasePath, 'release')
  await writeFile(envPollWakePath, 'wake')
  await waitForFile(envPollEnteredPath)

  let envCleanupTerminationSettled = false
  const envCleanupExit = new Promise((resolve, reject) => {
    envCleanupWorker.once('exit', (code) => {
      try {
        assert.equal(readFileSync(envPollFutureDropPath, 'utf8'), 'dropped')
        assert.equal(
          readFileSync(envPollTerminalOrderPath, 'utf8'),
          'after-drop',
        )
        resolve(code)
      } catch (error) {
        reject(error)
      }
    })
  })
  const envCleanupTermination = envCleanupWorker.terminate().then(
    (code) => {
      envCleanupTerminationSettled = true
      return code
    },
    (error) => {
      envCleanupTerminationSettled = true
      throw error
    },
  )
  await delay(100)
  assert.equal(
    envCleanupTerminationSettled,
    false,
    'Worker termination completed while its native task poll was active',
  )
  await assertFileMissing(
    envPollTerminalOrderPath,
    'environment cleanup finalized the task while its poll was active',
  )
  await assertFileMissing(
    envPollFutureDropPath,
    'environment cleanup destroyed the task future while its poll was active',
  )

  await writeFile(envPollReleasePath, 'release')
  await withTimeout(
    Promise.all([envCleanupTermination, envCleanupExit]),
    timeoutMilliseconds,
    'environment cleanup did not drop and finalize the task before Worker exit',
  )
  envCleanupWorker = undefined

  envSpawnWorker = new Worker(new URL(import.meta.url), {
    workerData: {
      bindingFile,
      role: 'env-spawn-future',
      pollEnteredPath: envSpawnPollEnteredPath,
      futureDropEnteredPath: envSpawnFutureDropEnteredPath,
      futureDropReleasePath: envSpawnFutureDropReleasePath,
      futureDropPath: envSpawnFutureDropPath,
      settlementPath: envSpawnSettlementPath,
    },
  })
  await waitForWorkerReady(envSpawnWorker, 'Env::spawn_future cleanup worker')
  await waitForFile(envSpawnPollEnteredPath)

  let envSpawnTerminationSettled = false
  const envSpawnExit = new Promise((resolve, reject) => {
    envSpawnWorker.once('exit', (code) => {
      try {
        assert.equal(readFileSync(envSpawnFutureDropPath, 'utf8'), 'dropped')
        assert.throws(
          () => readFileSync(envSpawnSettlementPath, 'utf8'),
          (error) => error?.code === 'ENOENT',
          'a closing environment ran the Env::spawn_future promise settlement callback',
        )
        resolve(code)
      } catch (error) {
        reject(error)
      }
    })
  })
  const envSpawnTermination = envSpawnWorker.terminate().then(
    (code) => {
      envSpawnTerminationSettled = true
      return code
    },
    (error) => {
      envSpawnTerminationSettled = true
      throw error
    },
  )
  await waitForFile(envSpawnFutureDropEnteredPath)
  await delay(100)
  assert.equal(
    envSpawnTerminationSettled,
    false,
    'Worker finalization completed while its Env::spawn_future future destructor was active',
  )
  await assertFileMissing(
    envSpawnFutureDropPath,
    'Worker finalization completed the Env::spawn_future destructor before its release barrier',
  )
  await assertFileMissing(
    envSpawnSettlementPath,
    'the Env::spawn_future promise settled while its environment was closing',
  )

  await writeFile(envSpawnFutureDropReleasePath, 'release')
  await withTimeout(
    Promise.all([envSpawnTermination, envSpawnExit]),
    timeoutMilliseconds,
    'Worker finalization did not wait for Env::spawn_future destruction',
  )
  envSpawnWorker = undefined

  let explicitSpawnSettled = false
  const explicitSpawn = binding
    .customRuntimeSpawnFutureCancellationOrder(
      explicitSpawnPollEnteredPath,
      explicitSpawnFutureDropEnteredPath,
      explicitSpawnFutureDropReleasePath,
      explicitSpawnFutureDropPath,
    )
    .then(
      () => {
        explicitSpawnSettled = true
        writeFileSync(
          explicitSpawnSettlementPath,
          `resolved-${futureDropOrder(explicitSpawnFutureDropPath)}`,
        )
        throw new Error('pending Env::spawn_future task unexpectedly resolved')
      },
      (error) => {
        explicitSpawnSettled = true
        writeFileSync(
          explicitSpawnSettlementPath,
          `rejected-${futureDropOrder(explicitSpawnFutureDropPath)}`,
        )
        return error
      },
    )
  await waitForFile(explicitSpawnPollEnteredPath)
  binding.cancelCustomRuntimeForOrderProbe(explicitSpawnShutdownPath)
  await waitForFile(explicitSpawnFutureDropEnteredPath)
  await delay(100)
  assert.equal(
    explicitSpawnSettled,
    false,
    'explicit shutdown rejected Env::spawn_future before its future destructor completed',
  )
  await assertFileMissing(
    explicitSpawnFutureDropPath,
    'explicit shutdown completed the Env::spawn_future destructor before its release barrier',
  )
  await assertFileMissing(
    explicitSpawnSettlementPath,
    'explicit shutdown settled Env::spawn_future while its future destructor was active',
  )
  await assertFileMissing(
    explicitSpawnShutdownPath,
    'explicit shutdown returned while the Env::spawn_future destructor was active',
  )

  await writeFile(explicitSpawnFutureDropReleasePath, 'release')
  const explicitSpawnError = await explicitSpawn
  assert.match(String(explicitSpawnError), /cancel/i)
  assert.equal(await readFile(explicitSpawnFutureDropPath, 'utf8'), 'dropped')
  assert.equal(
    await readFile(explicitSpawnSettlementPath, 'utf8'),
    'rejected-after-drop',
  )
  await waitForFile(explicitSpawnShutdownPath)
  assert.equal(await readFile(explicitSpawnShutdownPath, 'utf8'), 'cancelled')

  console.log('custom runtime cancellation ordering passed')
} finally {
  binding.drainRuntimeTasks()
  await writeFile(activePollWakePath, 'wake').catch(() => {})
  await writeFile(activePollReleasePath, 'release').catch(() => {})
  await writeFile(activePollFutureDropReleasePath, 'release').catch(() => {})
  await writeFile(activePollCompletionDropReleasePath, 'release').catch(
    () => {},
  )
  await writeFile(envPollWakePath, 'wake').catch(() => {})
  await writeFile(envPollReleasePath, 'release').catch(() => {})
  await writeFile(envPollFutureDropReleasePath, 'release').catch(() => {})
  await writeFile(envSpawnFutureDropReleasePath, 'release').catch(() => {})
  await writeFile(explicitSpawnFutureDropReleasePath, 'release').catch(() => {})
  await writeFile(releasePath, 'release').catch(() => {})
  await nestedWorker?.terminate().catch(() => {})
  await activePollWorker?.terminate().catch(() => {})
  await envCleanupWorker?.terminate().catch(() => {})
  await envSpawnWorker?.terminate().catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
