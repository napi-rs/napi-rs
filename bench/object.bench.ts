import { createRequire } from 'node:module'

import { bench } from 'vitest'

const require = createRequire(import.meta.url)

const {
  benchReceiveStrictObject,
  benchReceiveAllOptionalObject,
  benchReceiveNestedMeta,
  benchValidateStructuredEnum,
} = require('./index.node')

bench('object bench: required object field', () => {
  benchReceiveStrictObject({ name: 'strict' })
})

bench('object bench: missing optional object fields', () => {
  benchReceiveAllOptionalObject({})
})

bench('object bench: nested optional js_name field', () => {
  benchReceiveNestedMeta({
    'vite:import-glob': {
      isSubImportsPattern: true,
    },
  })
})

bench('object bench: structured enum discriminant', () => {
  benchValidateStructuredEnum({
    type2: 'Birthday',
    name: 'Napi-rs',
    age: 10,
  })
})
