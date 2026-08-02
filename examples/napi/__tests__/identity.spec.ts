import test from 'ava'

import {
  identityAcceptOptionalTimeSeries,
  identityAcceptTimeSeries,
  identityAcceptTimeSeriesOrString,
  identityMakeTimeSeries,
  identitySumTimeSeries,
  Sdk,
} from '../index.cjs'

// Cross-crate identity fixture: `Sdk.TimeSeries` is declared in
// `examples/napi-shared` as `#[napi(namespace = "Sdk", js_name =
// "TimeSeries")] pub struct TimeSeriesNapi`, and every function here is
// declared in THIS crate (`examples/napi/src/identity.rs`), referencing it
// across the crate boundary. This is the real-build proof for the
// `(namespace, js_name)` identity resolution fix — see
// `crates/backend/src/typegen.rs`'s `napi_type_ref_sentinel` and
// `cli/src/utils/typegen.ts`'s `resolveCrossFragmentTypeReferences`.

test('the cross-crate class is reachable only under its namespaced js_name, never its Rust ident', (t) => {
  t.is(typeof Sdk, 'object')
  t.is(typeof Sdk.TimeSeries, 'function')
  // The dead `module.exports.TimeSeriesNapi` alias must not exist — the
  // native binding only ever registers a class constructor under js_name.
  t.is((globalThis as any).TimeSeriesNapi, undefined)
  t.is((Sdk as any).TimeSeriesNapi, undefined)
})

test('a direct &T reference works across the crate boundary', (t) => {
  const series = Sdk.TimeSeries.fromValue(42)
  t.is(identityAcceptTimeSeries(series), 42)
})

test('an Option<&T> reference works across the crate boundary', (t) => {
  const series = Sdk.TimeSeries.fromValue(7)
  t.is(identityAcceptOptionalTimeSeries(series), 7)
  t.is(identityAcceptOptionalTimeSeries(null), -1)
})

test('an Either<&T, String> reference works across the crate boundary', (t) => {
  const series = Sdk.TimeSeries.fromValue(3)
  t.is(identityAcceptTimeSeriesOrString(series), 'series:3')
  t.is(identityAcceptTimeSeriesOrString('plain'), 'string:plain')
})

test('a Vec<T> reference works across the crate boundary', (t) => {
  const a = Sdk.TimeSeries.fromValue(1)
  const b = Sdk.TimeSeries.fromValue(2)
  const c = Sdk.TimeSeries.fromValue(3)
  t.is(identitySumTimeSeries([a, b, c]), 6)
})

test('a factory-style function returning the cross-crate class works', (t) => {
  const series = identityMakeTimeSeries(99)
  t.true(series instanceof Sdk.TimeSeries)
  t.is(series.value, 99)
})

test('the cross-crate class exposes its own factory and field getter correctly', (t) => {
  const series = Sdk.TimeSeries.fromValue(5)
  t.true(series instanceof Sdk.TimeSeries)
  t.is(series.value, 5)
})
