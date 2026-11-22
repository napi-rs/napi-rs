import {
  acceptPromiseExternal,
  aliasEitherMutExternal,
  aliasExternalRefAndMut,
  aliasExternalRefAndRef,
  aliasExternalRefPair,
  aliasMutMutExternal,
  aliasMutRefExternal,
  aliasOptionalMutExternal,
  aliasRefMutExternal,
  aliasRefRefExternal,
  aliasVecMutExternal,
  closeBorrowGate,
  createClosureReadingExternal,
  createDuplicateExternalRef,
  createExternal,
  createExternalRef,
  createExternalString,
  createForeignExternal,
  escapeExternalFromObject,
  getExternal,
  getExternalRef,
  mutateExternal,
  openBorrowGate,
  readBorrowedExternalAsyncFn,
  readBorrowedExternalTask,
  readOptionalExternalAsyncFn,
  reenterDuringExternalArgConversion,
  reenterExternalCallback,
  reenterMutExternalCallback,
  tsfnReturnExternal,
} from '../index.cjs'

import { test } from './test.framework.js'

const BORROW_CONFLICT_MSG =
  /The same native value cannot be borrowed mutably while another borrow is active/
const SCOPE_BARRIER_MSG =
  /Native references can only be created by generated callback argument conversion/

// `napi_get_value_external` hands back whatever `data` pointer the external was
// created with. Externals produced outside this addon — other native modules,
// a sibling copy of napi-rs, or raw `napi_create_external` calls — can carry
// arbitrary payloads, so `&External<T>`/`ExternalRef<T>` parameters only accept
// payloads this binary created, and reject foreign ones without dereferencing
// them.

test('external round-trip still works', (t) => {
  t.is(getExternal(createExternal(42)), 42)
})

test('external ref round-trip still works', (t) => {
  t.is(getExternalRef(createExternalRef(7)), 7)
})

test('foreign external payload is rejected for &External<T>', (t) => {
  const foreign = createForeignExternal() as never
  t.throws(() => getExternal(foreign), { code: 'InvalidArg' })
})

test('foreign external payload is rejected for ExternalRef<T>', (t) => {
  const foreign = createForeignExternal() as never
  t.throws(() => getExternalRef(foreign), { code: 'InvalidArg' })
})

test('external of a different payload type is rejected', (t) => {
  // `createExternalString` produces `External<String>`; reading it back as
  // `External<u32>` must fail, not reinterpret the allocation.
  t.throws(() => getExternal(createExternalString('nope') as never), {
    code: 'InvalidArg',
  })
})

test('aliased mutable External<T> arguments are rejected, distinct succeed', (t) => {
  const h = createExternal(10)
  const h1 = createExternal(10)
  const h2 = createExternal(20)

  t.throws(() => aliasMutMutExternal(h, h), {
    code: 'InvalidArg',
    message: BORROW_CONFLICT_MSG,
  })
  t.is(aliasMutMutExternal(h1, h2), 33)
  t.is(getExternal(h1), 11)
  t.is(getExternal(h2), 22)

  t.throws(() => aliasMutRefExternal(h, h), {
    code: 'InvalidArg',
    message: BORROW_CONFLICT_MSG,
  })
  t.is(aliasMutRefExternal(h1, h2), 34)

  t.throws(() => aliasRefMutExternal(h, h), {
    code: 'InvalidArg',
    message: BORROW_CONFLICT_MSG,
  })
  t.is(aliasRefMutExternal(h1, h2), 35)

  // Shared + shared borrows of the same External<T> do not conflict.
  t.is(aliasRefRefExternal(h, h), 20)
  // After failed and successful calls, the borrow is released.
  mutateExternal(h, 77)
  t.is(getExternal(h), 77)
})

test('aliased External<T> inside Option, Vec, and Either containers is rejected', (t) => {
  const h = createExternal(5)
  const h1 = createExternal(5)
  const h2 = createExternal(6)

  t.throws(() => aliasOptionalMutExternal(h, h), {
    code: 'InvalidArg',
    message: BORROW_CONFLICT_MSG,
  })
  t.is(aliasOptionalMutExternal(h1, h2), 14)

  t.throws(() => aliasVecMutExternal([h, h]), {
    code: 'InvalidArg',
    message: BORROW_CONFLICT_MSG,
  })
  t.is(aliasVecMutExternal([h1, h2]), 16)

  t.throws(() => aliasEitherMutExternal(h, h), {
    code: 'InvalidArg',
    message: BORROW_CONFLICT_MSG,
  })
  t.is(aliasEitherMutExternal(h1, h2), 17)
})

test('ExternalRef<T> shares borrow tracking with External<T> and JsExternal::create_ref', (t) => {
  const h = createExternal(10)
  const h1 = createExternal(10)
  const h2 = createExternal(20)

  t.throws(() => aliasExternalRefAndRef(h, h), {
    code: 'InvalidArg',
    message: BORROW_CONFLICT_MSG,
  })
  t.is(aliasExternalRefAndRef(h1, h2), 31)

  t.throws(() => aliasExternalRefAndMut(h, h), {
    code: 'InvalidArg',
    message: BORROW_CONFLICT_MSG,
  })
  t.is(aliasExternalRefAndMut(h1, h2), 34)

  t.throws(() => aliasExternalRefPair(h, h), {
    code: 'InvalidArg',
    message: BORROW_CONFLICT_MSG,
  })
  t.is(aliasExternalRefPair(h1, h2), 37)

  t.is(createDuplicateExternalRef(99), 99)
  // Guard released cleanly after rejection and drop.
  mutateExternal(h, 123)
  t.is(getExternal(h), 123)
})

test('re-entrant callbacks and in-body object getters obey External<T> borrow rules', (t) => {
  const h = createExternal(10)

  // Shared borrow allows re-entrant shared read, rejects re-entrant mutable borrow.
  let seen = 0
  t.is(
    reenterExternalCallback(h, () => {
      seen = getExternal(h)
    }),
    10,
  )
  t.is(seen, 10)
  t.throws(
    () =>
      reenterExternalCallback(h, () => {
        mutateExternal(h, 42)
      }),
    { code: 'InvalidArg', message: BORROW_CONFLICT_MSG },
  )

  // Exclusive borrow rejects both shared and mutable re-entrant borrows.
  t.throws(
    () =>
      reenterMutExternalCallback(h, () => {
        getExternal(h)
      }),
    { code: 'InvalidArg', message: BORROW_CONFLICT_MSG },
  )
  t.throws(
    () =>
      reenterMutExternalCallback(h, () => {
        mutateExternal(h, 42)
      }),
    { code: 'InvalidArg', message: BORROW_CONFLICT_MSG },
  )

  // Converting &mut External<T> inside a callback body is rejected by NativeBorrowBarrier.
  t.throws(() => escapeExternalFromObject({ ext: h }), {
    code: 'InvalidArg',
    message: SCOPE_BARRIER_MSG,
  })

  // Guard was released after all re-entrant failures.
  mutateExternal(h, 55)
  t.is(getExternal(h), 55)
})

test('closure trampoline, Promise, and ThreadsafeFunction reject borrowed External<T>', async (t) => {
  const h = createExternal(12)
  const readInClosure = createClosureReadingExternal()

  t.throws(() => readInClosure(h), {
    code: 'InvalidArg',
    message: SCOPE_BARRIER_MSG,
  })

  // Re-entering a closure trampoline during outer argument conversion must not
  // hijack the outer NativeBorrowScope.
  const arrayWithGetter: number[] = []
  Object.defineProperty(arrayWithGetter, '0', {
    enumerable: true,
    get() {
      t.throws(() => readInClosure(h), {
        code: 'InvalidArg',
        message: SCOPE_BARRIER_MSG,
      })
      return 7
    },
  })
  t.is(reenterDuringExternalArgConversion(arrayWithGetter, h), 19)

  // Async Promise resolution cannot hand out an unguarded &mut External<T>.
  await t.throwsAsync(() => acceptPromiseExternal(Promise.resolve(h)), {
    code: 'InvalidArg',
    message: SCOPE_BARRIER_MSG,
  })

  // Synchronous thenable during outer arg conversion cannot hijack the outer scope.
  const syncThenable = {
    // oxlint-disable-next-line unicorn/no-thenable
    then(resolve: (value: unknown) => void) {
      resolve(h)
    },
  } as unknown as Promise<typeof h>
  t.throws(() => acceptPromiseExternal(syncThenable), {
    code: 'InvalidArg',
    message: SCOPE_BARRIER_MSG,
  })

  // ThreadsafeFunction return conversion cannot hand out an unguarded &mut External<T>.
  await t.throwsAsync(() => tsfnReturnExternal((_err, _arg) => h), {
    code: 'InvalidArg',
    message: SCOPE_BARRIER_MSG,
  })

  mutateExternal(h, 88)
  t.is(getExternal(h), 88)
})

test('borrowed External<T> AsyncTask and async fn settle and release borrow guard', async (t) => {
  const gate = 40
  openBorrowGate(gate)
  closeBorrowGate(gate)

  const h = createExternal(33)
  t.is(await readBorrowedExternalTask(h, gate), 33)
  t.is(await readBorrowedExternalAsyncFn(h, gate), 33)

  const hs = createExternalString('hello-external')
  t.is(await readOptionalExternalAsyncFn(hs, gate), 'hello-external')
  t.is(await readOptionalExternalAsyncFn(null, gate), null)

  mutateExternal(h, 44)
  t.is(getExternal(h), 44)
})
