// Helper for reflect-preload.spec.ts — NOT an ava test file (no `.spec.` in
// the name), run as a child process so the patch below happens before the
// addon is loaded for the first time.
//
// napi-rs#3423: a broken `Reflect.getOwnPropertyDescriptor` installed BEFORE
// the addon loads is inside the addon's trust boundary — nothing can establish
// the intrinsic's provenance through Node-API — but it must fail the
// registration-time behavioral sanity probe. Capture then degrades to an empty
// reason/cause permanently instead of invoking the impostor mid-capture, and
// the retained value keeps its identity (retention never depends on the
// descriptor reader).
'use strict'

const assert = require('node:assert')

let hits = 0
Reflect.getOwnPropertyDescriptor = function getOwnPropertyDescriptor() {
  hits += 1
  // A crude interposer: always fabricates a data descriptor. The probe asks it
  // about a data property with a known sentinel value, so this is caught at
  // registration.
  return { value: 'FAKE', writable: true, enumerable: true, configurable: true }
}

const addon = require('../index.cjs')

// The probe consulted the impostor at load — a defined moment — and rejected
// it. `>=` rather than `===`: unrelated code may legitimately use
// Reflect.getOwnPropertyDescriptor during require().
assert.ok(
  hits >= 1,
  `the registration probe should have consulted the impostor, hits=${hits}`,
)

hits = 0
const described = addon.describeCapturedValue(
  new TypeError('the message', { cause: new RangeError('the cause') }),
)
assert.strictEqual(
  hits,
  0,
  `the rejected impostor must never run during capture, hits=${hits}`,
)
// Degraded capture: the placeholder reason for an `Error` value, no cause.
assert.strictEqual(described, 'GenericFailure|JavaScript Error|-')

// A string primitive is its own reason — no descriptor read involved, so no
// degradation.
assert.strictEqual(addon.describeCapturedValue('boom'), 'GenericFailure|boom|-')

// Identity never depended on the descriptor reader.
const value = { tag: 'marker' }
assert.strictEqual(addon.jsErrorFromRetainedValue(value), value)
assert.strictEqual(hits, 0, `capture must stay off the impostor, hits=${hits}`)

console.log('ok')
