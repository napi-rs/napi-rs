const configuration = {
  extensions: ['ts', 'tsx'],
  files: ['test_module/__test__/**/*.spec.ts'],
  require: ['@swc-node/register'],
}

if (parseInt(process.versions.napi, 10) < 4) {
  configuration.compileEnhancements = false
}

export default configuration
