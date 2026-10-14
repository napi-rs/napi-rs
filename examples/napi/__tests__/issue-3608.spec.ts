import test from 'ava'

import {
  Issue3608Holder,
  Issue3608Other,
  Issue3608Wide,
  issue3608BumpOther,
  issue3608ReadOther,
  issue3608ReadOtherInstance,
} from '../index.cjs'

// Regression coverage for napi-rs/napi-rs#3608: JS can get an object of one
// `#[napi]` class that holds the Rust value of another class (a factory called
// with a foreign `this`, a subclass constructor that returns another object, or
// a constructor called without `new` on an object made during a factory call).
// Every use of such an object as the wrong class must throw before the Rust
// value is read. Native builds of this example use `napi8`, where the object
// type tag rejects it. WASI builds have no type tag and check the class that the
// runtime recorded when it wrapped the value. Both throw the same error.

const notOther = {
  message: 'Value is not an instance of class `Issue3608Other`',
}

// `ClassInstance<T>` and `Reference<T>` name the class by its full Rust path.
const notOtherFullPath = {
  message: /^Value is not an instance of class `[\w:]*::Issue3608Other`$/,
}

// `ClassA.prototype.method.call(objectOfClassB)`: V8 rejects the receiver before
// the native callback runs. emnapi (WASI) does not, so the runtime check does.
const wrongReceiver = {
  message:
    /^(Illegal invocation|Value is not an instance of class `Issue3608Other`)$/,
}

test('factory called with a foreign `this` cannot be used as that class', (t) => {
  const fake = Issue3608Holder.create.call(
    Issue3608Other,
  ) as unknown as Issue3608Other
  t.true(fake instanceof Issue3608Other)

  t.throws(() => fake.read(), notOther)
  t.throws(() => fake.bump(), notOther)
  t.throws(() => fake.a, notOther)
  t.throws(() => {
    fake.a = 1
  }, notOther)
  t.throws(() => issue3608ReadOther(fake), notOther)
  t.throws(() => issue3608BumpOther(fake), notOther)
  t.throws(() => issue3608ReadOtherInstance(fake), notOtherFullPath)
  t.throws(() => Issue3608Holder.readOtherReference(fake), notOtherFullPath)
})

test('subclass constructor that returns an object of another class', (t) => {
  class Evil extends Issue3608Holder {
    constructor() {
      super()
      return new Issue3608Other() as unknown as Evil
    }
  }

  const fake = Evil.create() as unknown as Issue3608Other
  t.true(fake instanceof Issue3608Other)

  t.throws(() => fake.read(), notOther)
  t.throws(() => fake.a, notOther)
  t.throws(() => issue3608ReadOther(fake), notOther)
})

test('constructor called without `new` on an object made during a factory call', (t) => {
  let stash: Issue3608Other | undefined
  class Sneaky extends Issue3608Holder {
    constructor() {
      super()
      // Constructors return early while a factory runs, so this object holds
      // no Rust value.
      stash = new Issue3608Other()
    }
  }

  const sneaky = Sneaky.create()
  t.true(sneaky instanceof Sneaky)
  t.is(sneaky.len(), 3)

  const other = stash!
  t.true(other instanceof Issue3608Other)
  t.throws(() => other.read(), { message: /^Failed to unwrap/ })

  // Wrap an `Issue3608Wide` value onto the `Issue3608Other` object.
  const callWithoutNew = Issue3608Wide as unknown as (this: object) => void
  callWithoutNew.call(other)

  t.throws(() => other.read(), notOther)
  t.throws(() => other.bump(), notOther)
  t.throws(() => other.a, notOther)
  t.throws(() => issue3608ReadOther(other), notOther)
})

test('object of another class as `&T`, `&mut T`, `ClassInstance<T>` and `Reference<T>` argument', (t) => {
  const holder = Issue3608Holder.create()
  const wide = new Issue3608Wide()

  for (const value of [holder, wide] as unknown as Issue3608Other[]) {
    t.throws(() => issue3608ReadOther(value), notOther)
    t.throws(() => issue3608BumpOther(value), notOther)
    t.throws(() => issue3608ReadOtherInstance(value), notOtherFullPath)
    t.throws(() => Issue3608Holder.readOtherReference(value), notOtherFullPath)
  }

  // The rejected `&mut T` calls did not write into the values.
  t.is(holder.len(), 3)
  t.is(wide.sum(), 3.75)
})

test('method or accessor called with a receiver of another class', (t) => {
  t.throws(
    () => Issue3608Other.prototype.read.call(Issue3608Holder.create()),
    wrongReceiver,
  )
  t.throws(
    () => Issue3608Other.prototype.bump.call(new Issue3608Wide()),
    wrongReceiver,
  )

  const accessor = Object.getOwnPropertyDescriptor(
    Issue3608Other.prototype,
    'a',
  )
  t.throws(() => accessor?.get?.call(new Issue3608Wide()), notOther)
  t.throws(() => accessor?.set?.call(new Issue3608Wide(), 1), notOther)
})

test('normal use, factories and subclasses still work', (t) => {
  const other = new Issue3608Other()
  t.deepEqual(other.read(), [11, 22, 3.5])
  t.is(other.bump(), 12)
  other.a = 40
  t.is(other.a, 40)
  t.deepEqual(issue3608ReadOther(other), [40, 22, 3.5])
  t.is(issue3608BumpOther(other), 41)
  t.deepEqual(issue3608ReadOtherInstance(other), [41, 22, 3.5])
  t.deepEqual(Issue3608Holder.readOtherReference(other), [41, 22, 3.5])

  t.is(Issue3608Holder.create().len(), 3)
  class Sub extends Issue3608Holder {}
  const sub = Sub.create()
  t.true(sub instanceof Sub)
  t.is(sub.len(), 3)

  class SubOther extends Issue3608Other {}
  t.deepEqual(issue3608ReadOther(new SubOther()), [11, 22, 3.5])
  t.is(new Issue3608Wide().sum(), 3.75)
})
