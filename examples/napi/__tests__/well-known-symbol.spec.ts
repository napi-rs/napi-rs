import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import { Worker } from 'node:worker_threads'

import test from 'ava'

import { WellKnownSymbolClass } from '../index.cjs'

test('toStringTag accessor names the object and can be replaced', (t) => {
  const value = new WellKnownSymbolClass(1)
  t.is(Object.prototype.toString.call(value), '[object WellKnownSymbolClass]')
  t.is(value[Symbol.toStringTag], 'WellKnownSymbolClass')
  value[Symbol.toStringTag] = 'Renamed'
  t.is(Object.prototype.toString.call(value), '[object Renamed]')
})

test('toPrimitive receives the conversion hint', (t) => {
  const value = new WellKnownSymbolClass(5)
  t.is(+value, 5)
  t.is(value[Symbol.toPrimitive]('number'), 5)
  t.is(String(value), 'value:5')
  t.is(`${value}`, 'value:5')
  // `+` and `==` pass the "default" hint.
  t.is((value as unknown as number) + 1, 6)
})

test('static toPrimitive converts the class, not its instances', (t) => {
  t.is(String(WellKnownSymbolClass), 'WellKnownSymbolClass:string')
  t.is(`${WellKnownSymbolClass}`, 'WellKnownSymbolClass:string')
  t.is(
    (WellKnownSymbolClass as unknown as string) + '',
    'WellKnownSymbolClass:default',
  )
  t.is(String(new WellKnownSymbolClass(3)), 'value:3')
  t.true(new WellKnownSymbolClass(1) instanceof WellKnownSymbolClass)
  t.false({} instanceof WellKnownSymbolClass)
})

test('dispose method runs', (t) => {
  const value = new WellKnownSymbolClass(1)
  t.false(value.disposed)
  value[Symbol.dispose]()
  t.true(value.disposed)
})

test('isConcatSpreadable field is read and written through the accessor', (t) => {
  const value = new WellKnownSymbolClass(1)
  t.false(value[Symbol.isConcatSpreadable])
  t.deepEqual([0].concat(value as never), [0, value])
  value[Symbol.isConcatSpreadable] = true
  t.true(value[Symbol.isConcatSpreadable])
  // Spread as an array-like without `length`, so nothing is added.
  t.deepEqual([0].concat(value as never), [0])
})

test('members are keyed by the well-known symbols with the usual flags', (t) => {
  const prototype = WellKnownSymbolClass.prototype
  t.deepEqual(
    Object.getOwnPropertySymbols(prototype).sort((a, b) =>
      a.toString().localeCompare(b.toString()),
    ),
    [
      Symbol.dispose,
      Symbol.isConcatSpreadable,
      Symbol.toPrimitive,
      Symbol.toStringTag,
    ],
  )
  t.deepEqual(Object.getOwnPropertySymbols(WellKnownSymbolClass), [
    Symbol.toPrimitive,
  ])

  // The getter and setter of one symbol share a single accessor.
  const tag = Object.getOwnPropertyDescriptor(prototype, Symbol.toStringTag)!
  t.is(typeof tag.get, 'function')
  t.is(typeof tag.set, 'function')
  t.true(tag.enumerable)
  t.true(tag.configurable)

  const field = Object.getOwnPropertyDescriptor(
    prototype,
    Symbol.isConcatSpreadable,
  )!
  t.is(typeof field.get, 'function')
  t.is(typeof field.set, 'function')

  const method = Object.getOwnPropertyDescriptor(prototype, Symbol.toPrimitive)!
  t.is(typeof method.value, 'function')
  t.true(method.writable)

  // Static methods keep their all-off default flags.
  const staticMethod = Object.getOwnPropertyDescriptor(
    WellKnownSymbolClass,
    Symbol.toPrimitive,
  )!
  t.is(typeof staticMethod.value, 'function')
  t.false(staticMethod.writable)
  t.false(staticMethod.enumerable)
  t.false(staticMethod.configurable)
})

test('members are not string-keyed', (t) => {
  const value = new WellKnownSymbolClass(1)
  const prototype = WellKnownSymbolClass.prototype
  // Symbol names and the Rust-derived names of the members.
  for (const key of [
    'toStringTag',
    'tag',
    'toPrimitive',
    'dispose',
    'isConcatSpreadable',
    'spreadable',
    'Symbol.dispose',
  ]) {
    t.false(key in value, key)
    t.false(Object.getOwnPropertyNames(prototype).includes(key), key)
  }
  for (const key of ['toPrimitive', 'classToPrimitive', 'Symbol.toPrimitive']) {
    t.false(Object.getOwnPropertyNames(WellKnownSymbolClass).includes(key), key)
  }
  t.deepEqual(Object.getOwnPropertyNames(prototype).sort(), [
    'constructor',
    'disposed',
  ])
})

test('declarations use computed well-known symbol keys', async (t) => {
  const declarations = await readFile(
    new URL('../index.d.cts', import.meta.url),
    'utf8',
  )
  const classBody = declarations.match(
    /export declare class WellKnownSymbolClass \{([^}]+)\}/,
  )![1]
  t.deepEqual(
    classBody
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('/**')),
    [
      '[globalThis.Symbol.isConcatSpreadable]: boolean',
      'constructor(value: number)',
      'get [globalThis.Symbol.toStringTag](): string',
      'set [globalThis.Symbol.toStringTag](tag: string)',
      '[globalThis.Symbol.toPrimitive](hint: string): number | string',
      'static [globalThis.Symbol.toPrimitive](hint: string): string',
      '[globalThis.Symbol.dispose](): void',
      'get disposed(): boolean',
    ],
  )
})

// Loads the native addon in a worker after `setup` has changed
// `globalThis.Symbol`, and returns the load error message.
async function loadWithSymbol(setup: string) {
  // The binding that index.cjs loaded, not any binding in the folder.
  const addons = Object.keys(createRequire(import.meta.url).cache).filter(
    (file) => /^example\..+\.node$/.test(basename(file)),
  )
  if (addons.length !== 1) {
    throw new Error(`expected one loaded addon, found ${addons.join(', ')}`)
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads')
      ${setup}
      try {
        process.dlopen({ exports: {} }, workerData)
        parentPort.postMessage('loaded')
      } catch (error) {
        parentPort.postMessage(error.message)
      }
    `,
      {
        eval: true,
        execArgv: [],
        workerData: addons[0],
      },
    )
    let result: unknown
    worker.on('message', (message) => {
      result = message
    })
    worker.on('error', reject)
    worker.on('exit', (code) => {
      if (code === 0) resolve(result)
      else reject(new Error(`Worker exited with code ${code}`))
    })
  })
}

// The class registration must fail instead of keying the member by a string.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'registration fails when a well-known symbol is missing',
  async (t) => {
    const message = await loadWithSymbol(`
      const RealSymbol = Symbol
      const FakeSymbol = function Symbol(description) {
        return RealSymbol(description)
      }
      for (const key of Object.getOwnPropertyNames(RealSymbol)) {
        if (!['length', 'name', 'prototype'].includes(key)) {
          FakeSymbol[key] = RealSymbol[key]
        }
      }
      FakeSymbol.dispose = 'dispose'
      globalThis.Symbol = FakeSymbol
    `)
    t.is(message, 'Symbol.dispose is not available in this runtime')
  },
)

// Reading a member of a missing `globalThis.Symbol` must not leave a JS
// exception that hides the registration error.
test.skipIf(Boolean(process.env.WASI_TEST))(
  'registration fails clearly when globalThis.Symbol is missing',
  async (t) => {
    for (const setup of [
      'delete globalThis.Symbol',
      'globalThis.Symbol = null',
      'globalThis.Symbol = 1',
    ]) {
      const message = await loadWithSymbol(setup)
      t.regex(
        String(message),
        /^Symbol\.\w+ is not available in this runtime$/,
        setup,
      )
    }
  },
)
