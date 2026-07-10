#!/usr/bin/env node

import { existsSync } from 'node:fs'

const isSourceCheckout = existsSync(new URL('../Cargo.toml', import.meta.url))

if (isSourceCheckout) {
  await import('@oxc-node/core/register')
  await import('./src/cli.ts')
} else {
  await import('./dist/cli.js')
}
