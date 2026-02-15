import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: './src/index.ts',
    fixedExtension: false,
    format: ['esm', 'cjs'],
    target: 'node16',
    sourcemap: 'inline',
    inlineOnly: false,
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
    fixedExtension: false,
    inlineOnly: false,
  },
])
