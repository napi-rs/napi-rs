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
          { find: 'path', replacement: 'path-browserify' },
          { find: 'stream', replacement: 'readable-stream' },
          { find: 'assert', replacement: join(dirname, 'assert.cjs') },
          { find: 'util', replacement: join(dirname, 'util') },
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
      sourcemap: 'inline',
      dir: './dist',
    },
  },
  {
    input: './runtime.js',
    treeshake: true,
    plugins: [
      replace({
        process: 'null',
        'process.env.NODE_ENV': '"production"',
        'process.env.NODE_DEBUG_NATIVE': false,
        __webpack_public_path__: undefined,
        preventAssignment: false,
      }),
      nodeResolve({
        preferBuiltins: false,
        mainFields: ['browser', 'module', 'main'],
      }),
    ],
    output: {
      format: 'esm',
      sourcemap: 'inline',
      dir: './dist',
    },
  },
])
