import { cpus } from 'os'

const configuration = {
  extensions: {
    ts: 'commonjs',
  },
  files: ['cli/**/*.spec.ts', 'examples/**/__test__/**/*.spec.ts'],
  require: ['ts-node/register/transpile-only'],
  environmentVariables: {
    TS_NODE_PROJECT: './examples/tsconfig.json',
    RUST_BACKTRACE: '1',
  },
  timeout: '5m',
  workerThreads: true,
  concurrency: process.env.CI ? 2 : cpus().length,
  failFast: false,
  verbose: !!process.env.CI,
}

if (process.env.WASI_TEST) {
  configuration.extensions = {
    ts: 'module',
    js: true,
  }
  configuration.require = null
  configuration.nodeArguments = [
    '--experimental-wasi-unstable-preview1',
    '--loader=ts-node/esm',
    '--experimental-specifier-resolution=node',
  ]
  configuration.files = ['examples/napi/__test__/**/*.spec.ts']
}

if (parseInt(process.versions.napi, 10) < 4) {
  configuration.compileEnhancements = false
}

export default configuration
