import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const wasmPath = resolve(process.argv[2] ?? '')
const api = process.argv[3]

assert.ok(process.argv[2], 'WASI addon path is required')
assert.ok(api === 'napi3' || api === 'napi4', 'N-API version is required')

const imports = WebAssembly.Module.imports(
  new WebAssembly.Module(readFileSync(wasmPath)),
)
  .filter(({ name }) =>
    [
      'napi_add_env_cleanup_hook',
      'napi_remove_env_cleanup_hook',
    ].includes(name),
  )
  .sort((a, b) => a.name.localeCompare(b.name))

const addCleanupHook = {
  module: 'napi',
  name: 'napi_add_env_cleanup_hook',
  kind: 'function',
}
const removeCleanupHook = {
  module: 'napi',
  name: 'napi_remove_env_cleanup_hook',
  kind: 'function',
}

assert.deepEqual(
  imports,
  api === 'napi3'
    ? [addCleanupHook]
    : [addCleanupHook, removeCleanupHook],
)
