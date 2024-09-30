import * as esbuild from 'esbuild'
import { pull } from 'lodash-es'

import packageJson from './package.json' with { type: 'json' }

await esbuild.build({
  entryPoints: ['./dist/index.js'],
  outfile: './dist/index.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: pull(Object.keys(packageJson.dependencies), '@octokit/rest', 'lodash-es'),
  define: {
    'import.meta.url': '__filename',
  },
})
