const configuration = {
  extensions: ['ts', 'tsx'],
  files: ['test_module/__test__/**/*.spec.ts'],
  require: [
    require('os').platform() === 'freebsd'
      ? 'ts-node/register/transpile-only'
      : '@swc-node/register',
  ],
  environmentVariables: {
    TS_NODE_PROJECT: './test_module/tsconfig.json',
  },
}

if (parseInt(process.versions.napi, 10) < 4) {
  configuration.compileEnhancements = false
}

module.exports = configuration
