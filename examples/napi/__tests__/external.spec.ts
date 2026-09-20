import {
  createExternal,
  createExternalRef,
  createExternalString,
  createForeignExternal,
  getExternal,
  getExternalRef,
} from '../index.cjs'

import { test } from './test.framework.js'

// `napi_get_value_external` hands back whatever `data` pointer the external was
// created with. Externals produced outside this addon — other native modules,
// a sibling copy of napi-rs, or raw `napi_create_external` calls — can carry
// arbitrary payloads, so `&External<T>`/`ExternalRef<T>` parameters only accept
// payloads this binary created, and reject foreign ones without dereferencing
// them.

test('external round-trip still works', (t) => {
  t.is(getExternal(createExternal(42)), 42)
})

test('external ref round-trip still works', (t) => {
  t.is(getExternalRef(createExternalRef(7)), 7)
})

test('foreign external payload is rejected for &External<T>', (t) => {
  const foreign = createForeignExternal() as never
  t.throws(() => getExternal(foreign), { code: 'InvalidArg' })
})

test('foreign external payload is rejected for ExternalRef<T>', (t) => {
  const foreign = createForeignExternal() as never
  t.throws(() => getExternalRef(foreign), { code: 'InvalidArg' })
})

test('external of a different payload type is rejected', (t) => {
  // `createExternalString` produces `External<String>`; reading it back as
  // `External<u32>` must fail, not reinterpret the allocation.
  t.throws(() => getExternal(createExternalString('nope') as never), {
    code: 'InvalidArg',
  })
})
