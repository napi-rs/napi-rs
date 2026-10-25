import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { defineConfig } from 'rolldown'
import { replacePlugin as replace } from 'rolldown/plugins'

// v2 plugins use private core context/ABI fields that can change between
// prereleases. A root resolution must not silently change the bundled plugins
// without updating the exact v2 peer contract and exercising the package tests.
const require = createRequire(import.meta.url)
const { version: coreVersion } = require('@emnapi/core/package.json')
const { devDependencies, peerDependencies } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
)
if (
  coreVersion !== devDependencies['@emnapi/core'] ||
  !peerDependencies['@emnapi/core'].split(' || ').includes(coreVersion) ||
  !peerDependencies['@emnapi/runtime'].split(' || ').includes(coreVersion)
) {
  throw new Error(
    `Bundled emnapi ${coreVersion} must match the exact v2 development and peer versions`,
  )
}

export default defineConfig([
  {
    input: './fs.js',
    platform: 'browser',
    resolve: {
      alias: {
        'node:events': 'events',
        'node:path': 'path-browserify',
        'node:stream': 'readable-stream',
        assert: join(import.meta.dirname, 'assert.cjs'),
        util: join(import.meta.dirname, 'util'),
        'node:buffer': 'buffer',
        'node:url': join(import.meta.dirname, 'url'),
      },
    },
    transform: {
      inject: {
        process: ['process', 'default'],
        Buffer: ['buffer', 'Buffer'],
      },
    },
    plugins: [
      replace(
        {
          'process.env.NODE_ENV': '"production"',
          'process.env.NODE_DEBUG': false,
          global: undefined,
        },
        { preventAssignment: false },
      ),
    ],
    output: {
      format: 'esm',
      dir: './dist',
    },
  },
  {
    input: './fs-proxy.js',
    output: {
      format: 'commonjs',
      file: './dist/fs-proxy.cjs',
    },
  },
  {
    input: './emnapi-plugins.js',
    output: [
      {
        format: 'esm',
        file: './dist/emnapi-plugins.js',
      },
      {
        format: 'commonjs',
        exports: 'named',
        file: './dist/emnapi-plugins.cjs',
      },
    ],
  },
])
