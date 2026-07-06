import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const isWasi = Boolean(process.env.WASI_TEST)
const __dirname = dirname(fileURLToPath(import.meta.url))
const runnerPath = join(__dirname, 'tsfn-finalizer-liveness.js')
const operationTimeout = 10_000
const referencedLivenessWindow = 1_000

type Completion = {
  code: number | null
  error?: Error
  signal: NodeJS.Signals | null
}

function waitForCompletion(
  completion: Promise<Completion>,
  timeout: number,
): Promise<Completion | undefined> {
  return Promise.race([completion, delay(timeout).then(() => undefined)])
}

async function pathExists(path: string) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function waitForJoinedMarker(path: string) {
  const deadline = Date.now() + operationTimeout
  while (Date.now() < deadline) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      await delay(10)
    }
  }
  throw new Error('timed out waiting for the TSFN finalizer joined marker')
}

async function runScenario(
  mode: 'referenced' | 'weak',
  verify: (scenario: {
    completion: Promise<Completion>
    joinedPath: string
    manualStopPath: string
  }) => Promise<void>,
) {
  const directory = await mkdtemp(
    join(tmpdir(), `napi-tsfn-finalizer-liveness-${mode}-`),
  )
  const manualStopPath = join(directory, 'manual-stop')
  const joinedPath = join(directory, 'joined')
  const child = spawn(
    process.execPath,
    [runnerPath, mode, manualStopPath, joinedPath],
    {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const completion = new Promise<Completion>((resolve) => {
    child.once('error', (error) => {
      resolve({ code: null, error, signal: null })
    })
    child.once('exit', (code, signal) => {
      resolve({ code, signal })
    })
  })

  try {
    const readyDeadline = Date.now() + operationTimeout
    while (!stdout.includes('ready\n') && Date.now() < readyDeadline) {
      const earlyCompletion = await waitForCompletion(completion, 10)
      if (earlyCompletion && !stdout.includes('ready\n')) {
        throw new Error(
          `TSFN liveness child exited before setup completed: ${JSON.stringify(earlyCompletion)}\n${stdout}${stderr}`,
        )
      }
    }
    if (!stdout.includes('ready\n')) {
      throw new Error(`timed out waiting for TSFN liveness setup\n${stderr}`)
    }

    await verify({ completion, joinedPath, manualStopPath })
  } finally {
    await writeFile(manualStopPath, 'stop').catch(() => {})
    let result = await waitForCompletion(completion, 1_000)
    if (!result) {
      child.kill('SIGTERM')
      result = await waitForCompletion(completion, 1_000)
    }
    if (!result) {
      child.kill('SIGKILL')
      await completion
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function assertCleanExit(result: Completion | undefined, output: string) {
  if (!result) {
    throw new Error(`TSFN liveness child did not exit: ${output}`)
  }
  if (result.error) {
    throw result.error
  }
  if (result.code !== 0 || result.signal !== null) {
    throw new Error(
      `TSFN liveness child exited with code ${result.code} and signal ${result.signal}: ${output}`,
    )
  }
}

test.skipIf(isWasi)(
  'a referenced TSFN retained by its worker blocks natural finalization',
  async (t) => {
    await runScenario(
      'referenced',
      async ({ completion, joinedPath, manualStopPath }) => {
        const earlyResult = await waitForCompletion(
          completion,
          referencedLivenessWindow,
        )
        t.is(earlyResult, undefined)
        t.false(await pathExists(joinedPath))

        await writeFile(manualStopPath, 'stop')
        const result = await waitForCompletion(completion, operationTimeout)
        assertCleanExit(result, 'after manually stopping the referenced worker')
        t.is(await waitForJoinedMarker(joinedPath), 'joined')
      },
    )
  },
)

test.skipIf(isWasi)(
  'a weak TSFN lets natural teardown run its worker-joining finalizer',
  async (t) => {
    await runScenario('weak', async ({ completion, joinedPath }) => {
      const result = await waitForCompletion(completion, operationTimeout)
      assertCleanExit(result, 'while waiting for weak TSFN teardown')
      t.is(await waitForJoinedMarker(joinedPath), 'joined')
    })
  },
)
