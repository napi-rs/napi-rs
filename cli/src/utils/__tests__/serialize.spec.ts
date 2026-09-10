import test from 'ava'

import { serializeJson, serializeToml, serializeYaml } from '../serialize.js'

test('serializeJson uses 2-space indent and a trailing newline', (t) => {
  t.is(
    serializeJson({ name: 'pkg', files: ['a.node'] }),
    `{
  "name": "pkg",
  "files": [
    "a.node"
  ]
}
`,
  )
})

test('serializeJson always ends with exactly one newline', (t) => {
  const serialized = serializeJson({ ok: true })
  t.true(serialized.endsWith('\n'))
  t.false(serialized.endsWith('\n\n'))
})

test('serializeToml strips the leading blank line @std/toml inserts', (t) => {
  const serialized = serializeToml({
    package: { name: 'demo', version: '0.1.0' },
    dependencies: {
      napi: { version: '3.0.0', features: ['napi4'] },
    },
  })
  t.false(serialized.startsWith('\n'))
  t.true(serialized.startsWith('[package]\n'))
  t.true(serialized.endsWith('\n'))
  t.false(serialized.endsWith('\n\n'))
})

test('serializeYaml always ends with a trailing newline', (t) => {
  const serialized = serializeYaml({ on: { push: null } })
  t.true(serialized.endsWith('\n'))
  t.false(serialized.endsWith('\n\n'))
})

test('serializeToml does not rewrite commas inside quoted strings', (t) => {
  const serialized = serializeToml({
    lib: { include: ['src/a,b.rs'] },
    package: {
      name: 'demo',
      description: 'uses = [a,b] in a scalar',
    },
  })
  t.true(serialized.includes('include = ["src/a,b.rs"]'))
  t.true(serialized.includes('description = "uses = [a,b] in a scalar"'))
  t.false(serialized.includes('src/a, b.rs'))
  t.false(serialized.includes('= [a, b]'))
})
