import { execSync } from 'child_process'
import { join } from 'path'

import ava from 'ava'

import { napiVersion } from '../napi-version'

const bindings = require('../../index.node')

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
