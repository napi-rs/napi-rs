import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: './src/{index,cli}.ts',
  sourcemap: 'inline',
  exports: true,
})
