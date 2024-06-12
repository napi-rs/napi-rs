import test from 'ava'

const bindings = require('../index.node')

test('should be able to concat string', (t) => {
  const fixture = 'JavaScript 🌳 你好 napi'
  t.snapshot(bindings.concatString(fixture))
})

test('should be able to concat string with char \0', (t) => {
  const fixture = 'JavaScript \0 🌳 你好 \0 napi'
  t.snapshot(fixture)
  t.snapshot(bindings.concatString(fixture))
})

test('should be able to concat utf16 string', (t) => {
  const fixture = 'JavaScript 🌳 你好 napi'
  t.snapshot(bindings.concatUTF16String(fixture))
})

test('should be able to concat latin1 string', (t) => {
  const fixture = 'æ¶½¾DEL'
  t.snapshot(bindings.concatLatin1String(fixture))
})

test('should be able to crate latin1 string', (t) => {
  t.snapshot(bindings.createLatin1())
})
