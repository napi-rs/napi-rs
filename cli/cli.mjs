#!/usr/bin/env node

import { execSync } from 'child_process'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

execSync(
  `node --import @oxc-node/core/register ${resolve(
    fileURLToPath(import.meta.url),
    '../src/cli.ts',
  )} ${process.argv.slice(2).join(' ')}`,
  {
    stdio: 'inherit',
  },
)
