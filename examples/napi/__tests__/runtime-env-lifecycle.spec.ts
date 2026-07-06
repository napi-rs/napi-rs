import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptPath = join(__dirname, 'runtime-env-lifecycle.js')

async function runScenario(mode: 'sequential' | 'race') {
  const child = spawn(process.execPath, [scriptPath, mode], {
    stdio: 'inherit',
  })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${mode} runtime lifecycle scenario timed out`))
    }, 10_000)

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

test.serial.skipIf(Boolean(process.env.WASI_TEST))(
  'last environment teardown finalizes pending work and a later environment restarts the runtime',
  async (t) => {
    await t.notThrowsAsync(runScenario('sequential'))
  },
)

test.serial.skipIf(Boolean(process.env.WASI_TEST))(
  'environment registration can race the previous last environment teardown',
  async (t) => {
    await t.notThrowsAsync(runScenario('race'))
  },
)
