import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const scenarioTimeout = 45_000
const isWasi = Boolean(process.env.WASI_TEST)
const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDirectory = join(__dirname, '..', 'tsfn-retention')
const runnerPath = join(__dirname, 'tsfn-retention-runner.js')
const addonPath = join(fixtureDirectory, 'tsfn-retention.node')

function runProcess(
  command: string,
  args: string[],
  timeout: number,
  env: NodeJS.ProcessEnv = process.env,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: fixtureDirectory,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(`${command} ${args.join(' ')} timed out after ${timeout}ms`),
      )
    }, timeout)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0 && signal === null) {
        resolve()
      } else {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited with code ${code} and signal ${signal}\n${stdout}${stderr}`,
          ),
        )
      }
    })
  })
}

test.before(async () => {
  if (isWasi) {
    return
  }

  try {
    await access(addonPath)
  } catch {
    throw new Error(
      `TSFN retention fixture is missing at ${addonPath}; run the @examples/napi build first`,
    )
  }
})

async function runScenario(scenario: string) {
  await runProcess(
    process.execPath,
    [runnerPath, scenario, addonPath],
    scenarioTimeout,
  )
}

for (const [scenario, title] of [
  [
    'finalizer-panic',
    'registered quiescence finalizer panic retains the addon image',
  ],
  [
    'callback-drop-panic',
    'callback capture Drop panic after quiescence retains the addon image',
  ],
  [
    'unregistered-finalizer',
    'unregistered last-handle post-drop probe retains the addon image',
  ],
] as const) {
  test.skipIf(isWasi)(title, async (t) => {
    await t.notThrowsAsync(runScenario(scenario))
  })
}

test.skipIf(
  isWasi || (process.platform !== 'darwin' && process.platform !== 'linux'),
)(
  'last-handle Drop in a native TSFN finalizer does not release Node-owned TSFN state',
  async (t) => {
    await t.notThrowsAsync(
      runScenario('unregistered-finalizer-no-cleanup-hook'),
    )
  },
)
