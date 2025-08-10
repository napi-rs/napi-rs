import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: './src/index.ts',
    // remove in the future, release esm output only
    format: ['esm', 'cjs'],
    target: 'es2020',
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
    target: 'es2020',
    dts: false,
  },
])
