import { cpus } from 'os'

const configuration = {
  extensions: ['ts', 'tsx'],
  files: ['**/__tests__/**/*.spec.ts'],
  require: ['ts-node/register/transpile-only'],
  environmentVariables: {
    TS_NODE_PROJECT: './examples/tsconfig.json',
  },
  timeout: '1m',
  workerThreads: true,
  concurrency: process.env.CI ? 2 : cpus().length,
  failFast: false,
  verbose: !!process.env.CI,
}

if (parseInt(process.versions.napi, 10) < 4) {
  configuration.compileEnhancements = false
}

export default configuration
