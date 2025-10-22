import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: './src/index.ts',
    format: ['esm', 'cjs'],
    target: 'node16',
    sourcemap: 'inline',
    inputOptions(options, format) {
      if (format === 'cjs') {
        options.external = ['@octokit/rest']
      }
      return options
    },
  },
  {
    entry: './src/cli.ts',
    sourcemap: 'inline',
    target: 'node16',
    dts: false,
  },
])
