import { readFile } from 'node:fs/promises'

import test from 'ava'

import {
  DisposableAlignedZst,
  DisposableCustomFinalize,
  DisposableDefaultCtor,
  DisposableFieldHook,
  DisposableNonDisposable,
  DisposableResource,
  DisposableSibling,
  DisposableWithLifetime,
  DisposableZst,
  RenamedDisposable,
  bumpDisposableMutRef,
  closeBorrowGate,
  createDisposableAlignedZst,
  createDisposableByValue,
  createDisposableZst,
  getDisposableAlignedZstDropCount,
  getDisposableDropCount,
  getDisposableFinalizeCount,
  getDisposableSharedViewDropCount,
  getDisposableSharedViewDropObservation,
  getDisposableZstDropCount,
  intoInstanceDisposedInCallback,
  openBorrowGate,
  openDisposableAsyncGate,
  readDisposableInstance,
  readDisposableInstanceFromObjectProperty,
  readDisposableRef,
  readDisposableRefStrict,
  releaseDisposableAsyncGate,
  waitDisposableAsyncGateEntered,
  waitForBorrowGateWaiters,
  wasmMemorySizeBytes,
  withDisposableInstanceCallback,
} from '../index.cjs'

let nextId = 10_000
const allocId = () => nextId++

const isWasi = Boolean(process.env.WASI_TEST)
const isThreadlessWasi =
  Boolean(process.env.NAPI_RS_TEST_THREADLESS_WASI_BUFFER) && !isWasi

const disposedMsg = (name: string) => ({
  message: `Instance of \`${name}\` has already been disposed`,
})

test('basic [Symbol.dispose]() drops immediately and is idempotent', (t) => {
  const id = allocId()
  const res = new DisposableResource(id, 10)
  t.is(res.read(), 10)
  t.is(getDisposableDropCount(id), 0)

  t.is(res[Symbol.dispose](), undefined)
  t.is(getDisposableDropCount(id), 1)

  // Calling [Symbol.dispose]() a second time is an idempotent no-op.
  t.is(res[Symbol.dispose](), undefined)
  t.is(getDisposableDropCount(id), 1)
})

test('works with JS `using` declaration (normal exit and throw)', (t) => {
  const normalId = allocId()
  let leakedRef: DisposableResource | undefined
  {
    using res = new DisposableResource(normalId, 21)
    leakedRef = res
    t.is(res.read(), 21)
    t.is(getDisposableDropCount(normalId), 0)
  }
  t.is(getDisposableDropCount(normalId), 1)
  t.throws(() => leakedRef!.read(), disposedMsg('DisposableResource'))

  const throwId = allocId()
  t.throws(
    () => {
      using res = new DisposableResource(throwId, 33)
      t.is(res.read(), 33)
      throw new Error('boom inside using')
    },
    { message: 'boom inside using' },
  )
  t.is(getDisposableDropCount(throwId), 1)
})

test('prototype [Symbol.dispose] descriptor flags and static symbol coexistence', (t) => {
  const desc = Object.getOwnPropertyDescriptor(
    DisposableResource.prototype,
    Symbol.dispose,
  )
  t.truthy(desc)
  t.is(typeof desc?.value, 'function')
  t.true(desc?.writable)
  t.false(desc?.enumerable)
  t.true(desc?.configurable)

  // Static [Symbol.dispose] does not conflict with prototype [Symbol.dispose].
  t.is(DisposableResource[Symbol.dispose](), 777)
})

test('generated .d.cts declares [globalThis.Symbol.dispose](): void', async (t) => {
  const dts = await readFile(new URL('../index.d.cts', import.meta.url), 'utf8')
  for (const className of [
    'DisposableResource',
    'DisposableDefaultCtor',
    'DisposableZst',
    'RenamedDisposable',
  ]) {
    const match = dts.match(
      new RegExp(`export declare class ${className} \\{([^}]+)\\}`),
    )
    t.truthy(match, `missing declaration for ${className}`)
    t.true(
      match![1].includes('[globalThis.Symbol.dispose](): void'),
      `missing [globalThis.Symbol.dispose](): void on ${className}`,
    )
  }
})

test('constructor, factory, default struct ctor, and return-by-value all dispose cleanly', (t) => {
  const ctorId = allocId()
  const a = new DisposableResource(ctorId, 1)
  a[Symbol.dispose]()
  t.is(getDisposableDropCount(ctorId), 1)

  const factoryId = allocId()
  const b = DisposableResource.create(factoryId, 2)
  t.is(b.tag, `factory-${factoryId}`)
  b[Symbol.dispose]()
  t.is(getDisposableDropCount(factoryId), 1)
  t.throws(() => b.read(), disposedMsg('DisposableResource'))

  const byValId = allocId()
  const c = createDisposableByValue(byValId, 3)
  t.is(c.read(), 3)
  c[Symbol.dispose]()
  t.is(getDisposableDropCount(byValId), 1)
  t.throws(() => c.read(), disposedMsg('DisposableResource'))

  const defaultCtorId = allocId()
  const d = new DisposableDefaultCtor(defaultCtorId, 42)
  t.is(d.count, 42)
  d[Symbol.dispose]()
  t.is(getDisposableDropCount(defaultCtorId), 1)
  t.throws(() => d.count, disposedMsg('DisposableDefaultCtor'))
  t.throws(() => {
    d.count = 99
  }, disposedMsg('DisposableDefaultCtor'))
})

test('wrong receivers throw and never dispose unrelated instances', (t) => {
  const siblingId = allocId()
  const nonDispId = allocId()
  const resId = allocId()
  const sibling = new DisposableSibling(siblingId, 10)
  const nonDisp = new DisposableNonDisposable(nonDispId, 20)
  const res = new DisposableResource(resId, 30)

  const disposeMethod = DisposableResource.prototype[Symbol.dispose]
  for (const receiver of [
    sibling,
    nonDisp,
    {},
    null,
    undefined,
    42,
    'str',
    () => {},
  ]) {
    t.throws(() => disposeMethod.call(receiver as never))
  }
  // Neither sibling nor nonDisp was dropped or detached.
  t.is(getDisposableDropCount(siblingId), 0)
  t.is(sibling.read(), 10)
  t.is(getDisposableDropCount(nonDispId), 0)
  t.is(nonDisp.read(), 20)

  // Even a ZST's [Symbol.dispose] must reject a non-ZST receiver safely.
  t.throws(() => DisposableZst.prototype[Symbol.dispose].call(res as never))
  t.is(getDisposableDropCount(resId), 0)
  t.is(res.read(), 30)

  sibling[Symbol.dispose]()
  res[Symbol.dispose]()
  t.is(getDisposableDropCount(siblingId), 1)
  t.is(getDisposableDropCount(resId), 1)
})

test('use-after-dispose throws across methods, getters, setters, fields, This, &T, &mut T, ClassInstance, Reference', (t) => {
  const id = allocId()
  const res = new DisposableResource(id, 5)
  res[Symbol.dispose]()

  const expected = disposedMsg('DisposableResource')
  t.throws(() => res.read(), expected)
  t.throws(() => res.increment(1), expected)
  t.throws(() => res.tag, expected)
  t.throws(() => {
    res.tag = 'new'
  }, expected)
  t.throws(() => res.value, expected)
  t.throws(() => {
    res.value = 99
  }, expected)
  t.throws(() => DisposableResource.readViaThisRef.call(res), expected)
  t.throws(() => DisposableResource.bumpViaThisMut.call(res, 1), expected)
  t.throws(() => res.readViaReference(), expected)
  t.throws(() => readDisposableRef(res), expected)
  t.throws(() => readDisposableRefStrict(res), expected)
  t.throws(() => bumpDisposableMutRef(res, 1), expected)
  t.throws(() => readDisposableInstance(res), expected)

  // Custom js_name is reported in the disposed error.
  const renamedId = allocId()
  const renamed = new RenamedDisposable(renamedId, 7)
  renamed[Symbol.dispose]()
  t.throws(() => renamed.read(), disposedMsg('RenamedDisposable'))
  t.throws(() => renamed.value, disposedMsg('RenamedDisposable'))
})

test('re-entrant dispose inside sync callback defers drop until borrow exits (&self, &mut self, nested, ClassInstance)', (t) => {
  // &self callback
  const id1 = allocId()
  const r1 = new DisposableResource(id1, 11)
  const out1 = r1.withCallback(() => {
    r1[Symbol.dispose]()
    // Already detached for JS, but Rust borrow still keeps T alive.
    t.is(getDisposableDropCount(id1), 0)
    t.throws(() => r1.read(), disposedMsg('DisposableResource'))
    // Double dispose while deferred is still idempotent.
    t.is(r1[Symbol.dispose](), undefined)
    t.is(getDisposableDropCount(id1), 0)
  })
  t.is(out1, 11)
  t.is(getDisposableDropCount(id1), 1)

  // &mut self callback
  const id2 = allocId()
  const r2 = new DisposableResource(id2, 20)
  const out2 = r2.withMutCallback(() => {
    r2[Symbol.dispose]()
    t.is(getDisposableDropCount(id2), 0)
    t.throws(() => r2.read(), disposedMsg('DisposableResource'))
  })
  t.is(out2, 30)
  t.is(getDisposableDropCount(id2), 1)

  // Overlapping shared borrows: drop waits until the OUTERMOST borrow exits.
  const id3 = allocId()
  const r3 = new DisposableResource(id3, 33)
  const out3 = r3.withCallback(() => {
    const inner = r3.withCallback(() => {
      r3[Symbol.dispose]()
      t.is(getDisposableDropCount(id3), 0)
    })
    t.is(inner, 33)
    // Inner borrow exited, outer borrow still active!
    t.is(getDisposableDropCount(id3), 0)
  })
  t.is(out3, 33)
  t.is(getDisposableDropCount(id3), 1)

  // ClassInstance<T> dispose pin: defers while callback holds ClassInstance.
  const id4 = allocId()
  const r4 = new DisposableResource(id4, 44)
  const out4 = withDisposableInstanceCallback(r4, () => {
    r4[Symbol.dispose]()
    t.is(getDisposableDropCount(id4), 0)
    t.throws(() => r4.read(), disposedMsg('DisposableResource'))
  })
  t.is(out4, 44)
  t.is(getDisposableDropCount(id4), 1)

  // ClassInstance<T>::from_napi_value outside argument conversion (object property lookup) is rejected.
  const id5 = allocId()
  const r5 = new DisposableResource(id5, 55)
  t.throws(() => readDisposableInstanceFromObjectProperty({ res: r5 }), {
    message: /Reference<T>/,
  })
  r5[Symbol.dispose]()
  t.is(getDisposableDropCount(id5), 1)

  // JavaScriptClassExt::into_instance pins the disposable instance for the active callback frame.
  const id6 = allocId()
  const out6 = intoInstanceDisposedInCallback(id6, 66, (arg) => {
    const res = arg as DisposableResource
    t.is(res.read(), 66)
    res[Symbol.dispose]()
    t.is(getDisposableDropCount(id6), 0)
    t.throws(() => res.read(), disposedMsg('DisposableResource'))
  })
  t.is(out6, 66)
  t.is(getDisposableDropCount(id6), 1)
})

test('re-entrant dispose during return-value conversion, field getter, and setter argument conversion', (t) => {
  // Return-value conversion hook (DeferredNativeBorrowScopeGuard active).
  const id1 = allocId()
  const r1 = new DisposableResource(id1, 55)
  const out1 = r1.readWithReturnHook(() => {
    r1[Symbol.dispose]()
    t.is(getDisposableDropCount(id1), 0)
    t.throws(() => r1.read(), disposedMsg('DisposableResource'))
  })
  t.is(out1, 55)
  t.is(getDisposableDropCount(id1), 1)

  // Default field getter using acquire_native_borrow_with_env:
  const id2 = allocId()
  let fieldObj!: DisposableFieldHook
  fieldObj = new DisposableFieldHook(id2, 66, () => {
    fieldObj[Symbol.dispose]()
    t.is(getDisposableDropCount(id2), 0)
    t.throws(() => fieldObj.hookValue, disposedMsg('DisposableFieldHook'))
  })
  t.is(fieldObj.hookValue, 66)
  // Completed synchronously on field getter exit!
  t.is(getDisposableDropCount(id2), 1)

  // Setter argument conversion disposes receiver before unwrap.
  const id3 = allocId()
  const r3 = new DisposableResource(id3, 1)
  t.throws(() => {
    r3.payloadValue = {
      get nextValue() {
        r3[Symbol.dispose]()
        t.is(getDisposableDropCount(id3), 1)
        return 99
      },
    }
  }, disposedMsg('DisposableResource'))
  t.is(getDisposableDropCount(id3), 1)
})

test.skipIf(isThreadlessWasi)(
  'async fn keeps disposed instance alive until future settles',
  async (t) => {
    const id = allocId()
    const gateId = allocId()
    openDisposableAsyncGate(gateId)
    const res = new DisposableResource(id, 100, 16)

    const pending = res.readAsyncGated(gateId)
    await waitDisposableAsyncGateEntered(gateId)

    res[Symbol.dispose]()
    t.is(getDisposableDropCount(id), 0)
    t.throws(() => res.read(), disposedMsg('DisposableResource'))

    releaseDisposableAsyncGate(gateId)
    t.is(await pending, 116)
    t.is(getDisposableDropCount(id), 1)
  },
)

test.skipIf(isThreadlessWasi)(
  'AsyncTask keeps disposed instance alive until task settles',
  async (t) => {
    const id = allocId()
    const gateId = allocId()
    openBorrowGate(gateId)
    const res = new DisposableResource(id, 200, 24)

    const pending = res.readInAsyncTask(gateId)
    await waitForBorrowGateWaiters(gateId, 1)

    res[Symbol.dispose]()
    t.is(getDisposableDropCount(id), 0)
    t.throws(() => res.read(), disposedMsg('DisposableResource'))

    closeBorrowGate(gateId)
    t.is(await pending, 224)
    t.is(getDisposableDropCount(id), 1)
  },
)

test('Reference, WeakReference, and SharedReference coordination', (t) => {
  // Reference keeps T alive across [Symbol.dispose](); WeakReference is invalidated immediately.
  const id1 = allocId()
  const r1 = new DisposableResource(id1, 71)
  const holder = r1.createRefHolder()
  const weak = r1.createWeakHolder()
  t.true(weak.isAlive())
  t.is(weak.tryGetValue(), 71)
  t.true(weak.tryUpgrade())

  r1[Symbol.dispose]()
  t.is(getDisposableDropCount(id1), 0)
  t.throws(() => r1.read(), disposedMsg('DisposableResource'))

  // WeakReference cannot resurrect a dying instance.
  t.false(weak.isAlive())
  t.is(weak.tryGetValue(), null)
  t.false(weak.tryUpgrade())
  t.throws(() => weak.tryToJs())

  // Existing Reference stays readable and cloneable until the last Reference drops.
  t.is(holder.read(), 71)
  const cloned = holder.cloneRef()
  holder.release()
  t.is(getDisposableDropCount(id1), 0)
  t.is(cloned.read(), 71)
  cloned.release()
  t.is(getDisposableDropCount(id1), 1)

  // Combined borrow + Reference: Reference drops inside callback, borrow drops on exit.
  const id2 = allocId()
  const r2 = new DisposableResource(id2, 82)
  const out2 = r2.withRefAndHolder((h) => {
    r2[Symbol.dispose]()
    t.is(getDisposableDropCount(id2), 0)
    t.is(h.read(), 82)
    h.release()
    // Reference dropped, but outer &DisposableResource borrow is still active.
    t.is(getDisposableDropCount(id2), 0)
  })
  t.is(out2, 82)
  t.is(getDisposableDropCount(id2), 1)

  // Combined borrow + Reference: borrow exits first, Reference drops later.
  const id3 = allocId()
  const r3 = new DisposableResource(id3, 83)
  let savedHolder!: ReturnType<DisposableResource['createRefHolder']>
  const out3 = r3.withRefAndHolder((h) => {
    savedHolder = h
    r3[Symbol.dispose]()
    t.is(getDisposableDropCount(id3), 0)
  })
  t.is(out3, 83)
  t.is(getDisposableDropCount(id3), 0)
  t.is(savedHolder.read(), 83)
  savedHolder.release()
  t.is(getDisposableDropCount(id3), 1)

  // SharedReference keeps T alive until released, then runs finalize_callbacks
  // (dropping child views S while T is still alive) BEFORE dropping T.
  const id4 = allocId()
  const r4 = new DisposableResource(id4, 94)
  const shared = r4.createSharedHolder()
  r4[Symbol.dispose]()
  t.is(getDisposableDropCount(id4), 0)
  t.is(getDisposableSharedViewDropCount(id4), 0)
  t.is(shared.read(), 94)
  shared.release()
  t.is(getDisposableDropCount(id4), 1)
  t.is(getDisposableSharedViewDropCount(id4), 1)
  // [observed_value, parent_drop_count_when_view_dropped]
  t.deepEqual(getDisposableSharedViewDropObservation(id4), [94, 0])
})

test('custom_finalize runs once, propagates error on dispose, and never clobbers a method error', (t) => {
  // Immediate custom finalize (success)
  const id1 = allocId()
  const okObj = new DisposableCustomFinalize(id1, 1, false)
  t.is(okObj[Symbol.dispose](), undefined)
  t.is(getDisposableFinalizeCount(id1), 1)
  t.is(getDisposableDropCount(id1), 1)
  t.is(okObj[Symbol.dispose](), undefined)
  t.is(getDisposableFinalizeCount(id1), 1)

  // Immediate custom finalize (error)
  const id2 = allocId()
  const errObj = new DisposableCustomFinalize(id2, 2, true)
  t.throws(() => errObj[Symbol.dispose](), {
    message: `custom finalize failed for ${id2}`,
  })
  t.is(getDisposableFinalizeCount(id2), 1)
  t.is(getDisposableDropCount(id2), 1)
  // Second dispose is still idempotent and does not re-run finalize.
  t.is(errObj[Symbol.dispose](), undefined)
  t.is(getDisposableFinalizeCount(id2), 1)
  t.throws(() => errObj.read(), disposedMsg('DisposableCustomFinalize'))

  // Deferred custom finalize (error surfaces when method returns Ok)
  const id3 = allocId()
  const defErr = new DisposableCustomFinalize(id3, 3, true)
  t.throws(
    () =>
      defErr.withCallback(() => {
        defErr[Symbol.dispose]()
        t.is(getDisposableFinalizeCount(id3), 0)
      }, false),
    { message: `custom finalize failed for ${id3}` },
  )
  t.is(getDisposableFinalizeCount(id3), 1)
  t.is(getDisposableDropCount(id3), 1)

  // Deferred custom finalize must NOT clobber a Rust Err returned by the method.
  const id4 = allocId()
  const defRustErr = new DisposableCustomFinalize(id4, 4, true)
  t.throws(
    () =>
      defRustErr.withCallback(() => {
        defRustErr[Symbol.dispose]()
      }, true),
    { message: `method failed for ${id4}` },
  )
  t.is(getDisposableFinalizeCount(id4), 1)
  t.is(getDisposableDropCount(id4), 1)

  // Deferred custom finalize must NOT clobber a JS exception thrown inside callback.
  const id5 = allocId()
  const defJsErr = new DisposableCustomFinalize(id5, 5, true)
  t.throws(
    () =>
      defJsErr.withCallback(() => {
        defJsErr[Symbol.dispose]()
        throw new Error('callback threw')
      }, false),
    { message: 'callback threw' },
  )
  t.is(getDisposableFinalizeCount(id5), 1)
  t.is(getDisposableDropCount(id5), 1)
})

test('zero-sized disposable struct drops cleanly across constructor, factory, and return-by-value', (t) => {
  const before = getDisposableZstDropCount()
  const a = new DisposableZst()
  const b = DisposableZst.create()
  const c = createDisposableZst()
  t.is(a.ping(), 42)
  t.is(b.ping(), 42)
  t.is(c.ping(), 42)

  a[Symbol.dispose]()
  a[Symbol.dispose]()
  b[Symbol.dispose]()
  c[Symbol.dispose]()
  t.is(getDisposableZstDropCount(), before + 3)

  t.throws(() => a.ping(), disposedMsg('DisposableZst'))
  t.throws(() => b.ping(), disposedMsg('DisposableZst'))
  t.throws(() => c.ping(), disposedMsg('DisposableZst'))
})

test('aligned zero-sized disposable struct allocates distinct placeholders across instances', (t) => {
  const before = getDisposableAlignedZstDropCount()
  const a = new DisposableAlignedZst()
  const b = DisposableAlignedZst.create()
  const c = createDisposableAlignedZst()
  t.is(a.ping(), 16)
  t.is(b.ping(), 16)
  t.is(c.ping(), 16)

  // Disposing `a` must not collide with `b` or `c`.
  a[Symbol.dispose]()
  t.is(getDisposableAlignedZstDropCount(), before + 1)
  t.throws(() => a.ping(), disposedMsg('DisposableAlignedZst'))
  t.is(b.ping(), 16)
  t.is(c.ping(), 16)

  b[Symbol.dispose]()
  t.is(getDisposableAlignedZstDropCount(), before + 2)
  t.throws(() => b.ping(), disposedMsg('DisposableAlignedZst'))
  t.is(c.ping(), 16)

  c[Symbol.dispose]()
  c[Symbol.dispose]()
  t.is(getDisposableAlignedZstDropCount(), before + 3)
  t.throws(() => c.ping(), disposedMsg('DisposableAlignedZst'))
})

test('disposable struct with lifetime parameter disposes cleanly and assign_to_this rejects disposable inner classes', (t) => {
  const outerId = allocId()
  const innerId = allocId()
  const obj = new DisposableWithLifetime(outerId, innerId, 123)
  t.is(obj.readInner(), 123)
  t.is(getDisposableDropCount(outerId), 0)

  obj[Symbol.dispose]()
  t.is(getDisposableDropCount(outerId), 1)
  obj[Symbol.dispose]()
  t.is(getDisposableDropCount(outerId), 1)
  t.throws(() => obj.readInner(), disposedMsg('DisposableWithLifetime'))

  const host = new DisposableNonDisposable(allocId(), 1)
  t.throws(() => host.tryAssignDisposableToThis(allocId()), {
    message: /assign_to_this.*Reference/,
  })
  t.throws(() => host.tryAssignDisposableToThisWithAttributes(allocId()), {
    message: /assign_to_this_with_attributes.*Reference/,
  })
})

test('repeated allocate + dispose does not grow wasm linear memory', (t) => {
  const chunkSize = 256 * 1024
  // Warm up allocator arena.
  {
    using warm = new DisposableResource(allocId(), 0, chunkSize)
    t.is(warm.payloadLen(), chunkSize)
  }

  const memoryBefore = wasmMemorySizeBytes()
  for (let i = 0; i < 128; i++) {
    const id = allocId()
    {
      using res = new DisposableResource(id, i, chunkSize)
      t.is(res.payloadLen(), chunkSize)
    }
    t.is(getDisposableDropCount(id), 1)
  }
  const memoryAfter = wasmMemorySizeBytes()
  if (memoryBefore > 0) {
    t.is(
      memoryAfter,
      memoryBefore,
      `expected zero wasm memory growth across 32 MiB of disposed instances (before=${memoryBefore}, after=${memoryAfter})`,
    )
  }
})
