import * as esbuild from 'esbuild'

import packageJson from './package.json' assert { type: 'json' }

await esbuild.build({
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
