import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['./dist/index.js'],
  outfile: './dist/index.cjs',
  bundle: true,
  platform: 'node',
  external: ['@napi-rs/lzma', '@napi-rs/tar', '@napi-rs/wasm-tools'],
  define: {
    'import.meta.url': '__filename',
  },
})
