import os from 'os'

import test from 'ava'

import {
  parseTriple,
  getSystemDefaultTarget,
  AVAILABLE_TARGETS,
} from '../target.js'

test('should parse triple correctly', (t) => {
  t.snapshot(AVAILABLE_TARGETS.map(parseTriple))
})

test('should get system default target correctly', (t) => {
  const target = getSystemDefaultTarget()

  t.is(target.platform, os.platform())
})
