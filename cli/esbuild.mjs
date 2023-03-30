import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['./dist/index.js'],
  outfile: './dist/index.cjs',
  bundle: true,
  platform: 'node',
  define: {
    'import.meta.url': '__filename',
  },
})
