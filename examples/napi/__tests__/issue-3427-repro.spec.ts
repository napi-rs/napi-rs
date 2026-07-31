import test from 'ava'

import {
  RenamedForIssue3427,
  issue3427Either,
  issue3427Strict,
} from '../index.cjs'

// Regression test for issue #3427.
//
// `Either<&T, ..>` discrimination and strict argument validation both go through a class's
// generated `ValidateNapiValue::validate()`, which looks the constructor up in the registry
// by name. That key must be the class's `js_name`, not the Rust struct ident, since the
// constructor is only ever registered under `js_name`. `RenamedForIssue3427` has a Rust ident
// (`RenamedForIssue3427Rust`) that differs from its JS name, so before the fix the lookup
// missed and every one of these calls threw `Failed to get constructor of class ...` even for
// a valid instance.

test('Either<&T, ..> accepts an instance whose js_name differs from the Rust ident', (t) => {
  const instance = new RenamedForIssue3427(42)
  t.is(issue3427Either(instance), 42)
})

test('Either<&T, ..> still selects the fallback branch for a plain value', (t) => {
  t.is(issue3427Either(7), 7)
})

test('strict &T argument accepts an instance whose js_name differs from the Rust ident', (t) => {
  const instance = new RenamedForIssue3427(123)
  t.is(issue3427Strict(instance), 123)
})

test('strict &T argument rejects a value that is not an instance', (t) => {
  t.throws(() => issue3427Strict(5 as unknown as RenamedForIssue3427))
})
