import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import test from 'ava'

import {
  applyStashedProperties,
  applyStashedPropertyValue,
  clearStashedProperties,
  reuseStashedPropertyOnObjectsAndClasses,
  shutdownRuntime,
  stashPropertiesWithNames,
  stashPropertiesWithNapiValues,
  stashPropertyValue,
  stashPropertyValueDuringPendingException,
} from '../index.cjs'
import { LOAD_IN_WORKER, runInWorker } from './multi-env-helpers.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

test.after(() => {
  clearStashedProperties()
  shutdownRuntime()
})

function runChild(scenario: string) {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'property-retention.js'), scenario],
    { encoding: 'utf8', env: process.env, timeout: 120_000 },
  )
  const output = `${result.stdout}\n${result.stderr}`
  return { result, output }
}

test('issue #3697: stashed Property::with_value survives across HandleScopes and slot churn', (t) => {
  stashPropertyValue('stashed value')
  const target: Record<string, unknown> = {}
  applyStashedPropertyValue(target)
  t.is(target.secret, 'stashed value')
  clearStashedProperties()
})

test('deferred Property::with_value error does not replay stale PendingException after catch', (t) => {
  t.throws(() => stashPropertyValueDuringPendingException('secret'), {
    message: 'pending before with_value',
  })
  const err = t.throws(() => applyStashedPropertyValue({})) as Error & {
    code?: string
  }
  t.is(err.code, 'GenericFailure')
  clearStashedProperties()
})

test('stashed Property::with_napi_value retains primitives, objects, functions, and symbols across scopes', (t) => {
  const obj = { nested: [1, 2, 3] }
  const func = () => 'callable'
  const sym = Symbol('retained-value-sym')

  stashPropertiesWithNapiValues(obj, func, sym)
  const target: Record<string, unknown> = {}
  applyStashedProperties(target)

  t.is(target.str, 'retained string')
  t.is(target.num, 42.5)
  t.is(target.bool, true)
  t.is(target.nil, null)
  t.true('undef' in target)
  t.is(target.undef, undefined)
  t.is(target.bigint, 9007199254740993n)
  t.is(target.obj, obj)
  t.is(target.func, func)
  t.is((target.func as () => string)(), 'callable')
  t.is(target.sym, sym)

  clearStashedProperties()
})

test('stashed Property::with_name retains string and symbol keys and supports key replacement', (t) => {
  const strKey = 'dynamicKey'
  const symKey = Symbol('dynamicSymKey')
  const strVal = { kind: 'string-keyed' }
  const symVal = 'symbol-keyed-value'

  stashPropertiesWithNames(strKey, symKey, strVal, symVal)
  const target: Record<PropertyKey, unknown> = {}
  applyStashedProperties(target)

  t.is(target[strKey], strVal)
  t.is(target[symKey], symVal)
  t.is(target.replacedUtf8, 'fromUtf8')
  t.is(target.replacedName, 'fromName')
  t.false('discardedName' in target)
  t.false('discardedUtf8' in target)

  clearStashedProperties()
})

test('cloned and reused stashed Property works across define_properties and Env::define_class', (t) => {
  stashPropertyValue('shared across targets')
  const [obj1, obj2, Class1, Class2] = reuseStashedPropertyOnObjectsAndClasses()

  t.is(obj1.secret, 'shared across targets')
  t.is(obj2.secret, 'shared across targets')
  t.is(new Class1().secret, 'shared across targets')
  t.is(new Class2().secret, 'shared across targets')

  // Dropping the stashed Property releases its reference without affecting defined targets.
  clearStashedProperties()
  t.is(obj1.secret, 'shared across targets')
  t.is(obj2.secret, 'shared across targets')
  t.is(new Class1().secret, 'shared across targets')
  t.is(new Class2().secret, 'shared across targets')
})

test.skipIf(Boolean(process.env.WASI_TEST))(
  'stashed Property left in thread_local survives worker exit and process exit cleanly',
  (t) => {
    for (const scenario of ['worker-exit', 'process-exit']) {
      const { result, output } = runChild(scenario)
      t.is(result.error, undefined, result.error?.stack)
      t.is(result.signal, null, `${scenario}: ${output}`)
      t.is(result.status, 0, `${scenario}: ${output}`)
      t.regex(result.stdout, new RegExp(`${scenario} ok`), output)
    }
  },
)

test.skipIf(Boolean(process.env.WASI_TEST))(
  'stashed Property cannot be materialized in a different napi_env on the same thread',
  async (t) => {
    const outcome = (await runInWorker(`
      ${LOAD_IN_WORKER}
      const first = load()
      const second = load()

      first.stashPropertyValue('from first env')
      let valueErr = null
      try {
        second.applyStashedPropertyValue({})
      } catch (err) {
        valueErr = { code: err.code, message: err.message }
      }

      const okTarget = {}
      first.applyStashedPropertyValue(okTarget)

      first.stashPropertiesWithNames('k', Symbol('s'), 'v1', 'v2')
      let nameErr = null
      try {
        second.applyStashedProperties({})
      } catch (err) {
        nameErr = { code: err.code, message: err.message }
      }

      first.clearStashedProperties()
      parentPort.postMessage({ valueErr, nameErr, okSecret: okTarget.secret })
    `)) as {
      valueErr: { code: string; message: string } | null
      nameErr: { code: string; message: string } | null
      okSecret: unknown
    }

    t.truthy(outcome.valueErr)
    t.is(outcome.valueErr?.code, 'InvalidArg')
    t.regex(outcome.valueErr?.message ?? '', /different JavaScript environment/)

    t.truthy(outcome.nameErr)
    t.is(outcome.nameErr?.code, 'InvalidArg')
    t.regex(outcome.nameErr?.message ?? '', /different JavaScript environment/)

    t.is(outcome.okSecret, 'from first env')
  },
)
