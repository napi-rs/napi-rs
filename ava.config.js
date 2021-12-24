const configuration = {
  extensions: ['ts', 'tsx'],
  files: ['cli/**/*.spec.ts', 'examples/**/__test__/**/*.spec.ts'],
  require: ['@swc-node/register'],
  environmentVariables: {
    SWC_NODE_PROJECT: 'tsconfig.test.json',
  },
  timeout: '1m',
}

if (parseInt(process.versions.napi, 10) < 4) {
  configuration.compileEnhancements = false
}

export default configuration
