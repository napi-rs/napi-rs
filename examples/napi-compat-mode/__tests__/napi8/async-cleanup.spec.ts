import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import ava from 'ava'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

const __dirname = dirname(fileURLToPath(import.meta.url))

const test = napiVersion >= 8 ? ava : ava.skip

test('should be able to add async cleanup hook', (t) => {
  const output = execSync(
    `node ${join(__dirname, 'sub-process.js')}`,
  ).toString()
  t.is(output.trim(), 'Exit from sub process')
})

test('should be able to add removable async cleanup hook', (t) => {
  const output = execSync(
    `node ${join(__dirname, 'sub-process-removable.js')}`,
  ).toString()
  t.is(output.trim(), 'Exit from sub process')
})

test('should be able to remove cleanup hook after added', (t) => {
  t.notThrows(() => bindings.testRemoveAsyncCleanupHook())
})
