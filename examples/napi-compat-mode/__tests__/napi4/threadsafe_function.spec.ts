import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

const __dirname = dirname(fileURLToPath(import.meta.url))

test('should get js function called from a thread', async (t) => {
  let called = 0

  if (napiVersion < 4) {
    t.is(bindings.testThreadsafeFunction, undefined)
    return
  }

  await new Promise<void>((resolve, reject) => {
    bindings.testThreadsafeFunction((...args: any[]) => {
      called += 1
      try {
        if (args[1][0] === 0) {
          t.deepEqual(args, [null, [0, 1, 2, 3]])
        } else {
          t.deepEqual(args, [null, [3, 2, 1, 0]])
        }
      } catch (err) {
        reject(err)
      }

      if (called === 2) {
        resolve()
      }
    })
  })
})

test('should be able to throw error in tsfn', (t) => {
  if (napiVersion < 4) {
    t.is(bindings.testThreadsafeFunction, undefined)
    return
  }

  t.throws(() => {
    execSync(
      `node --import @oxc-node/core/register ${join(__dirname, 'tsfn-throw.js')}`,
    )
  })
})

test('tsfn dua instance', (t) => {
  if (napiVersion < 4) {
    t.is(bindings.A, undefined)
    return
  }
  t.notThrows(() => {
    execSync(
      `node --import @oxc-node/core/register ${join(__dirname, 'tsfn-dua-instance.js')}`,
    )
  })
})
