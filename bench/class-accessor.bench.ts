import { createRequire } from 'node:module'

import { bench } from 'vitest'

const require = createRequire(import.meta.url)

const { BenchFieldAccessor, BenchImplAccessor } = require('./index.node')

let sink = 0

class JsAccessor {
  #value: number

  constructor(value: number) {
    this.#value = value
  }

  get value() {
    return this.#value
  }

  set value(value: number) {
    this.#value = value
  }
}

const ITERATIONS = 1_000

bench('class accessor from #[napi] impl getter/setter', () => {
  const o = new BenchImplAccessor(0)
  let sum = 0

  for (let i = 0; i < ITERATIONS; i++) {
    o.value = i
    sum += o.value
  }

  sink = sum
})

bench('class accessor from #[napi(getter, setter)] field', () => {
  const o = new BenchFieldAccessor(0)
  let sum = 0

  for (let i = 0; i < ITERATIONS; i++) {
    o.value = i
    sum += o.value
  }

  sink = sum
})

bench('JavaScript getter/setter baseline', () => {
  const o = new JsAccessor(0)
  let sum = 0

  for (let i = 0; i < ITERATIONS; i++) {
    o.value = i
    sum += o.value
  }

  sink = sum
})
