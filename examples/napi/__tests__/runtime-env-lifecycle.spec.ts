import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptPath = join(__dirname, 'runtime-env-lifecycle.js')

type Scenario =
  | 'sequential'
  | 'race'
  | 'duplicate-race'
  | 'timeout-retention'
  | 'finalizer-panic'
  | 'callback-drop-panic'
  | 'unregistered-finalizer'
  | 'pending-payload'
  | 'cleanup-blocked-call'

async function runScenario(mode: Scenario) {
  const child = spawn(process.execPath, [scriptPath, mode], {
    stdio: 'inherit',
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${mode} runtime lifecycle scenario timed out`))
    }, 30_000)

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
            `${mode} runtime lifecycle scenario exited with code ${code} and signal ${signal}`,
          ),
        )
      }
    })
  })
}

for (const scenario of ['sequential', 'race', 'duplicate-race'] as const) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `${scenario} environment teardown and restart survives repeated fresh processes`,
    async (t) => {
      for (let iteration = 0; iteration < 3; iteration += 1) {
        await t.notThrowsAsync(runScenario(scenario))
      }
    },
  )
}

for (const scenario of [
  'finalizer-panic',
  'callback-drop-panic',
  'unregistered-finalizer',
  'pending-payload',
  'cleanup-blocked-call',
] as const) {
  test.skipIf(Boolean(process.env.WASI_TEST))(
    `TSFN ${scenario} fallback is isolated in its own process`,
    async (t) => {
      await t.notThrowsAsync(runScenario(scenario))
    },
  )
}

test.skipIf(Boolean(process.env.WASI_TEST))(
  'cleanup timeout retains the module until Tokio retirement completes',
  async (t) => {
    await t.notThrowsAsync(runScenario('timeout-retention'))
  },
)
