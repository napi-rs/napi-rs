import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import alias from '@rollup/plugin-alias'
import commonjs from '@rollup/plugin-commonjs'
import inject from '@rollup/plugin-inject'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import { defineConfig } from 'rollup'

const dirname = join(fileURLToPath(import.meta.url), '..')

export default defineConfig([
  {
    input: './fs.js',
    plugins: [
      commonjs(),
      alias({
        entries: [
          { find: 'node:events', replacement: 'events' },
          { find: 'node:path', replacement: 'path-browserify' },
          { find: 'node:stream', replacement: 'readable-stream' },
          { find: 'assert', replacement: join(dirname, 'assert.cjs') },
          { find: 'util', replacement: join(dirname, 'util') },
          { find: 'node:buffer', replacement: 'buffer' },
        ],
      }),
      inject({
        process: ['process', 'default'],
        Buffer: ['buffer', 'Buffer'],
      }),
      nodeResolve({
        preferBuiltins: false,
        mainFields: ['browser', 'module', 'main'],
      }),
      replace({
        'process.env.NODE_ENV': '"production"',
        'process.env.NODE_DEBUG': false,
        global: undefined,
        preventAssignment: false,
      }),
    ],
    treeshake: true,
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
    plugins: [nodeResolve()],
    treeshake: true,
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
