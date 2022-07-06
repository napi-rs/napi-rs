import { readFileSync } from 'fs'
import { join } from 'path'

import alias from '@rollup/plugin-alias'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import toml from 'toml'

const NAPI_CARGO_TOML = readFileSync(
  join(__dirname, 'crates', 'napi', 'Cargo.toml'),
  'utf8',
)
const NAPI_DERIVE_CARGO_TOML = readFileSync(
  join(__dirname, 'crates', 'macro', 'Cargo.toml'),
  'utf8',
)
const NAPI_BUILD_CARGO_TOML = readFileSync(
  join(__dirname, 'crates', 'build', 'Cargo.toml'),
  'utf8',
)

const {
  package: { version: NAPI_VERSION },
} = toml.parse(NAPI_CARGO_TOML)
const {
  package: { version: NAPI_DERIVE_VERSION },
} = toml.parse(NAPI_DERIVE_CARGO_TOML)
const {
  package: { version: NAPI_BUILD_VERSION },
} = toml.parse(NAPI_BUILD_CARGO_TOML)

console.info('napi version: ', NAPI_VERSION)
console.info('napi-derive version: ', NAPI_DERIVE_VERSION)
console.info('napi-build version: ', NAPI_BUILD_VERSION)

export default {
  input: './scripts/cli/src/index.js',
  inlineDynamicImports: true,
  output: {
    banner: '#!/usr/bin/env node',
    file: './cli/scripts/index.js',
    format: 'cjs',
    sourcemap: 'inline',
  },
  plugins: [
    replace({
      NAPI_VERSION,
      NAPI_DERIVE_VERSION,
      NAPI_BUILD_VERSION,
      // Do not external `node:xx` because we need to replace it with `xx` to compatible with `node@12`
      'node:path': 'path',
      'node:os': 'os',
      'node:process': 'process',
      'node:tty': 'tty',
      'node:assert': 'assert',
      'node:readline': 'readline',
      preventAssignment: true,
    }),
    alias({
      entries: [{ find: 'readable-stream', replacement: 'stream' }],
    }),
    nodeResolve({
      preferBuiltins: true,
      exportConditions: ['node', 'default', 'module', 'export'],
    }),
    commonjs(),
    json(),
  ],
}
