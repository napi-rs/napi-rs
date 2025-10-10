import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert'

import { napiVersion } from '../napi-version'

// @ts-expect-error
import bindings from '../../index.node'

const __dirname = dirname(fileURLToPath(import.meta.url))

const testFn = napiVersion >= 8 ? test : test.skip

testFn('should be able to add async cleanup hook', () => {
  const output = execSync(
    `node --import @oxc-node/core/register ${join(__dirname, 'sub-process.js')}`,
  ).toString()
  assert.strictEqual(output.trim(), 'Exit from sub process')
})

testFn('should be able to add removable async cleanup hook', () => {
  const output = execSync(
    `node --import @oxc-node/core/register ${join(__dirname, 'sub-process-removable.js')}`,
  ).toString()
  assert.strictEqual(output.trim(), 'Exit from sub process')
})

testFn('should be able to remove cleanup hook after added', () => {
  assert.doesNotThrow(() => bindings.testRemoveAsyncCleanupHook())
})
