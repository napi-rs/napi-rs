export default {
  extensions: {
    ts: 'module',
  },
  files: ['**/__tests__/**/*.spec.ts'],
  nodeArguments: ['--loader=ts-node/esm/transpile-only'],
  environmentVariables: {
    TS_NODE_PROJECT: './tsconfig.json',
  },
}
