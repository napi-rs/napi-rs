const configuration = {
  extensions: ['ts', 'tsx'],
  files: [
    'test_module/__test__/**/*.spec.ts',
    'examples/__test__/**/*.spec.ts',
    'cli/__test__/**/*.spec.ts',
  ],
  require: ['ts-node/register/transpile-only'],
  environmentVariables: {
    TS_NODE_PROJECT: './test_module/tsconfig.json',
  },
  timeout: '1m',
}

if (parseInt(process.versions.napi, 10) < 4) {
  configuration.compileEnhancements = false
}

export default configuration
