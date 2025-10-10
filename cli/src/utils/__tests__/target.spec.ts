import os from 'os'

import { test } from 'node:test'
import assert from 'node:assert'

import {
  parseTriple,
  getSystemDefaultTarget,
  AVAILABLE_TARGETS,
} from '../target.js'

test('should parse triple correctly', () => {
  // Snapshot: AVAILABLE_TARGETS.map(parseTriple)
})

test('should get system default target correctly', () => {
  const target = getSystemDefaultTarget()

  assert.strictEqual(target.platform, os.platform())
})
