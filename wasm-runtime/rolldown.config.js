import { join } from 'node:path'

import { defineConfig } from 'rolldown'
import { replacePlugin as replace } from 'rolldown/plugins'

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
