import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

const __dirname = dirname(fileURLToPath(import.meta.url))
const scriptPath = join(__dirname, 'reflect-preload.cjs')

test('a broken pre-load Reflect.getOwnPropertyDescriptor fails the registration probe', (t) => {
  // The probe runs when the addon registers, so the interposition has to happen
  // before the very first require — hence a child process; this test process
  // already loaded the addon with pristine intrinsics. The assertions live in
  // reflect-preload.cjs: the impostor is consulted (and rejected) at load,
  // never during capture, capture degrades to an empty reason/cause, and the
  // retained value keeps its identity.
  if (process.env.WASI_TEST) {
    // On the WASI lanes the addon's env lives in its own realm; patching the
    // host realm's Reflect does not reach the pair registration resolves.
    t.pass()
    return
  }
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    timeout: 60_000,
  })
  t.is(
    result.status,
    0,
    `probe fixture failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
  )
})
