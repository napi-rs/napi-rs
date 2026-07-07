import { spawn } from 'node:child_process'
import { access, copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const isWasi = Boolean(process.env.WASI_TEST)
const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureDirectory = join(__dirname, '..', 'module-init-rollback')
const addonPath = join(fixtureDirectory, 'module-init-rollback.node')
const runnerPath = join(__dirname, 'module-init-rollback.js')

async function runScenario(
  runner: string,
  args: string[],
  name: string,
): Promise<void> {
  const child = spawn(process.execPath, ['--expose-gc', runner, ...args], {
    cwd: fixtureDirectory,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })

  await new Promise<void>((resolve, reject) => {
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 80_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (timedOut) {
        reject(new Error(`${name} timed out\n${output}`))
      } else if (code === 0 && signal === null) {
        resolve()
      } else {
        reject(
          new Error(
            `${name} exited with code ${code} and signal ${signal}\n${output}`,
          ),
        )
      }
    })
  })
}

test.before(async () => {
  if (!isWasi) {
    await access(addonPath)
  }
})

test.skipIf(isWasi)(
  'module initialization rollback retries the same image and cleans up its Worker environment',
  async (t) => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'napi-module-init-rollback-'),
    )
    const temporaryAddonPath = join(
      temporaryDirectory,
      'module-init-rollback.node',
    )
    try {
      await copyFile(addonPath, temporaryAddonPath)
      await t.notThrowsAsync(
        runScenario(
          runnerPath,
          [temporaryAddonPath],
          'module-init rollback scenario',
        ),
      )
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  },
)
