import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, workerData } from 'node:worker_threads'

import native from '../index.cjs'

// Closure-backed accessors passed to `Env::define_class` used to be leaked:
// nothing ever freed their boxed data or the closures. They are now dropped
// when the env is torn down, never on GC, because an accessor taken off the
// prototype can outlive the constructor. Prints `drops <n>`, the number of
// closures dropped while the scenario ran.

function exercise(target) {
  if (target.value !== 42) {
    throw new Error(`getter returned ${target.value}`)
  }
  target.value = 1
  if (target.lastSet !== 1) {
    throw new Error(`setter stored ${target.lastSet}`)
  }
}

const scenarios = {
  // 10 classes with a getter and a setter closure each: 20 closures.
  class() {
    for (let i = 0; i < 10; i++) {
      const Class = native.defineClassWithClosures()
      exercise(new Class())
    }
  },
  // One property slice reused by two classes: still 2 closures.
  'class-twice'() {
    for (const Class of native.defineClassTwiceWithClosures()) {
      exercise(new Class())
    }
  },
  // One property slice reused by two objects: still 2 closures.
  'object-twice'() {
    for (const object of native.definePropertiesTwiceWithClosures()) {
      exercise(object)
    }
  },
}

async function runInWorker(scenario) {
  const before = native.closureDropCount()
  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: scenario,
  })
  const code = await new Promise((resolve, reject) => {
    worker.once('error', reject)
    worker.once('exit', resolve)
  })
  if (code !== 0) {
    throw new Error(`worker exited with ${code}`)
  }
  console.log(`drops ${native.closureDropCount() - before}`)
}

// Run with --expose-gc. Keeps only the getters, so the constructors can be
// collected, then calls every getter after GC.
async function keptGettersAfterGc() {
  const before = native.closureDropCount()
  const getters = []
  for (let i = 0; i < 1500; i++) {
    const Class = native.defineClassWithClosures()
    getters.push(Object.getOwnPropertyDescriptor(Class.prototype, 'value').get)
  }
  for (let i = 0; i < 10; i++) {
    globalThis.gc()
    await new Promise((resolve) => setImmediate(resolve))
  }
  const alive = getters.filter((getter) => getter.call({}) === 42).length
  console.log(`kept ${alive}/${getters.length}`)
  console.log(`drops ${native.closureDropCount() - before}`)
}

// Reuses the heap, so a read of freed accessor data shows up as a wrong value.
function churn() {
  for (let i = 0; i < 20000; i++) {
    native.contains('A'.repeat(1 + (i % 64)), 'B')
  }
}

// Calls the getter and the setter closures. Only the getter values are
// checked: after a WASI dispose emnapi rejects the setter's
// `set_named_property`, so `lastSet` is not written there.
function readAccessors(target, getter) {
  churn()
  target.value = 1
  return `get ${target.value} ${getter.call({})}`
}

// Reads the accessors from an `exit` listener added after the binding loaded.
// On WASI the loader's own `exit` listener runs first and disposes the binding
// (emnapi `Context.destroy()` runs the env cleanup hooks), then this one runs.
function readAtExit() {
  const Class = native.defineClassWithClosures()
  const target = new Class()
  const { get } = Object.getOwnPropertyDescriptor(Class.prototype, 'value')
  process.on('exit', () => {
    console.log(readAccessors(target, get))
    console.log(`drops ${native.closureDropCount()}`)
  })
}

// Reads the accessors after an explicit WASI dispose. Native bindings have no
// dispose symbol, so there it only reads them.
async function readAfterDispose() {
  const Class = native.defineClassWithClosures()
  const target = new Class()
  const { get } = Object.getOwnPropertyDescriptor(Class.prototype, 'value')
  await native[Symbol.for('napi.rs.wasi.dispose')]?.()
  console.log(readAccessors(target, get))
  console.log(`drops ${native.closureDropCount()}`)
}

if (!isMainThread) {
  scenarios[workerData]()
} else if (process.argv[2] === 'gc') {
  await keptGettersAfterGc()
} else if (process.argv[2] === 'exit') {
  readAtExit()
} else if (process.argv[2] === 'dispose') {
  await readAfterDispose()
} else {
  await runInWorker(process.argv[2])
}
