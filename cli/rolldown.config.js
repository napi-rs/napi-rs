// @ts-check

import { defineConfig } from 'rolldown'
import { pull } from 'lodash-es'

import packageJson from './package.json' with { type: 'json' }

export default defineConfig([
  // remove in the future, release esm output only
  {
    input: './src/index.ts',
    output: {
      file: './dist/index.cjs',
      format: 'cjs',
      sourcemap: 'inline',
      target: 'es2020',
    },
    platform: 'node',
    // bundle the esm deps into cjs output
    external: pull(
      Object.keys(packageJson.dependencies),
      '@octokit/rest',
      'lodash-es',
    ),
  },
  {
    input: './src/index.ts',
    output: {
      file: './dist/index.js',
      format: 'esm',
      sourcemap: 'inline',
      target: 'es2020',
    },
    external: Object.keys(packageJson.dependencies),
    platform: 'node',
  },
  {
    input: './src/cli.ts',
    output: {
      file: './dist/cli.js',
      format: 'esm',
      sourcemap: 'inline',
      target: 'es2020',
    },
    external: Object.keys(packageJson.dependencies),
    platform: 'node',
  },
])
