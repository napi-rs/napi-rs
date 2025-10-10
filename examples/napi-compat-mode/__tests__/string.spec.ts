import { test } from 'node:test'
import assert from 'node:assert'

// @ts-expect-error
import bindings from '../index.node'

test('should be able to concat string', () => {
  const fixture = 'JavaScript 🌳 你好 napi'
  // Snapshot: bindings.concatString(fixture)
})

test('should be able to concat string with char \0', () => {
  const fixture = 'JavaScript \0 🌳 你好 \0 napi'
  // Snapshot: fixture
  // Snapshot: bindings.concatString(fixture)
})

test('should be able to concat utf16 string', () => {
  const fixture = 'JavaScript 🌳 你好 napi'
  // Snapshot: bindings.concatUTF16String(fixture)
})

test('should be able to concat latin1 string', () => {
  const fixture = 'æ¶½¾DEL'
  // Snapshot: bindings.concatLatin1String(fixture)
})

test('should be able to crate latin1 string', () => {
  // Snapshot: bindings.createLatin1()
})
