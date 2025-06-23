import { build } from 'esbuild'

import packageJson from './package.json' with { type: 'json' }

await build({
  entryPoints: ['./dist/index.js'],
  outfile: './dist/index.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: Object.keys(packageJson.dependencies),
  define: {
    'import.meta.url': '__filename',
  },
})
