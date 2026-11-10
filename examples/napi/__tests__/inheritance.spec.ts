import test from 'ava'

import {
  InheritanceBase,
  InheritanceChild,
  InheritanceGrandchild,
  InheritanceSibling,
  inheritanceDropCounts,
  inheritanceExactArgument,
} from '../index.cjs'
import { LOAD_IN_WORKER, runInWorker } from './multi-env-helpers.js'

// `#[napi(extends = Parent)]` v1: instance prototype chains and inherited
// borrowed (`&self` / `&mut self`) members. Constructors and statics are not
// inherited, and ownership-sensitive paths (`Reference<Self>`, `&Parent`
// arguments) keep exact-class checks.

test('instance prototype chains are wired parent-first', (t) => {
  const child = InheritanceChild.create(3, 7)
  const grandchild = InheritanceGrandchild.create(1, 2, 9)
  t.is(
    Object.getPrototypeOf(InheritanceChild.prototype),
    InheritanceBase.prototype,
  )
  t.is(
    Object.getPrototypeOf(InheritanceGrandchild.prototype),
    InheritanceChild.prototype,
  )
  t.true(child instanceof InheritanceChild)
  t.true(child instanceof InheritanceBase)
  t.true(grandchild instanceof InheritanceChild)
  t.true(grandchild instanceof InheritanceBase)
  t.false(InheritanceSibling.create(1) instanceof InheritanceChild)
})

test('inherited field accessors and getters/setters read the embedded parent', (t) => {
  const child = InheritanceChild.create(3, 7)
  t.is(child.value, 3)
  t.is(child.amount, 3)
  child.amount = 10
  t.is(child.value, 10)
  child.value = 11
  t.is(child.amount, 11)
  t.is(child.extra, 7)
  // The embedded parent field is never exposed as an accessor.
  t.false('parent' in child)
})

test('inherited methods work across a multilevel chain', (t) => {
  const child = InheritanceChild.create(3, 7)
  t.is(child.doubled(), 6)
  child.increment()
  t.is(child.value, 4)
  t.is(+child, 4)
  t.is(child.ownValue(), 7)

  const grandchild = InheritanceGrandchild.create(1, 2, 9)
  t.is(grandchild.doubled(), 2)
  t.is(grandchild.ownValue(), 2)
  t.is(grandchild.leaf, 9)
  t.is(grandchild.extra, 2)
  t.is(grandchild.value, 1)
})

test('exact-only members reject descendants', (t) => {
  const child = InheritanceChild.create(3, 7)
  const base = new InheritanceBase(4)
  // `Reference<Self>` methods stay bound to the exact class.
  t.is(base.exactValue(), 4)
  // Native: V8's method signature (`Illegal invocation`). wasm: the exact
  // class-identity check in the callback.
  t.throws(() => child.exactValue())
  // `&Parent` arguments are not receivers and keep the exact check.
  t.is(inheritanceExactArgument(base), 4)
  t.throws(() => inheritanceExactArgument(child), {
    message: /not an instance of class `InheritanceRoot`/,
  })
})

test('receivers outside the hierarchy are rejected', (t) => {
  const base = new InheritanceBase(4)
  const sibling = InheritanceSibling.create(5)
  t.is(sibling.doubled(), 10)
  t.throws(() => InheritanceChild.prototype.ownValue.call(sibling), {
    message: /not an instance of class `InheritanceChild`/,
  })
  t.throws(() => InheritanceChild.prototype.ownValue.call(base), {
    message: /not an instance of class `InheritanceChild`/,
  })
  t.throws(() => InheritanceBase.prototype.doubled.call({}), {
    message: /InheritanceRoot/,
  })
  const amount = Object.getOwnPropertyDescriptor(
    InheritanceBase.prototype,
    'amount',
  )!
  t.throws(() => amount.get!.call({}), { message: /InheritanceRoot/ })
})

test('statics and constructors are not inherited', (t) => {
  t.is(typeof InheritanceBase.fromValue, 'function')
  t.is(
    (InheritanceChild as unknown as Record<string, unknown>).fromValue,
    undefined,
  )
  t.not(Object.getPrototypeOf(InheritanceChild), InheritanceBase)
  t.throws(() => new (InheritanceChild as any)(1))
})

test('inherited receivers keep the native borrow guard', (t) => {
  const child = InheritanceChild.create(3, 7)
  t.throws(() => child.reenter(() => child.increment()), {
    message: /cannot be borrowed mutably while another borrow is active/,
  })
  t.is(child.value, 3)
})

test('prototype chains are wired in every environment', async (t) => {
  if (process.env.WASI_TEST) {
    t.pass()
    return
  }
  const result = await runInWorker(`
    ${LOAD_IN_WORKER}
    const first = load()
    const second = load()
    parentPort.postMessage([first, second].map((m) => {
      const child = m.InheritanceChild.create(2, 3)
      return [
        Object.getPrototypeOf(m.InheritanceChild.prototype) === m.InheritanceBase.prototype,
        child instanceof m.InheritanceBase,
        child.doubled(),
      ]
    }))
  `)
  t.deepEqual(result, [
    [true, true, 4],
    [true, true, 4],
  ])
})

async function exposeGc(): Promise<undefined | (() => void)> {
  const { setFlagsFromString } = await import('node:v8')
  const { runInNewContext } = await import('node:vm')
  // setFlagsFromString does not update the current context's global; the
  // exposed gc must be pulled out of a freshly created context.
  setFlagsFromString('--expose-gc')
  return runInNewContext('gc') as undefined | (() => void)
}

test.serial(
  'a child is finalized once, dropping its embedded parent',
  async (t) => {
    if (process.env.WASI_TEST) {
      t.pass()
      return
    }
    const gc = await exposeGc()
    if (!gc) {
      t.pass()
      return
    }
    const [baseDrops, childDrops, baseFinalizes] = inheritanceDropCounts()
    ;(() => {
      InheritanceChild.create(1, 2)
    })()
    for (let i = 0; i < 20; i++) {
      gc()
      await new Promise((resolve) => setImmediate(resolve))
      if (inheritanceDropCounts()[1] > childDrops) break
    }
    const after = inheritanceDropCounts()
    const childDelta = after[1] - childDrops
    t.true(childDelta >= 1)
    // Each finalized child drops exactly one embedded parent.
    t.is(after[0] - baseDrops, childDelta)
    // The parent's ObjectFinalize belongs to the exact parent class only.
    t.is(after[2], baseFinalizes)
  },
)
