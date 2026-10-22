import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import test from 'ava'

import { SymbolNamedClass, SymbolNamedFields } from '../index.cjs'

const valueKey = Symbol.for('_value')
const field = Symbol.for('napi.test.field')
const method = Symbol.for('_method')

test('symbol accessors and string accessors with the same name stay independent', (t) => {
  const value = new SymbolNamedClass(3)
  t.is(value[valueKey], 3)
  t.is(value._value, 103)
  value[valueKey] = 5
  t.is(value[valueKey], 5)
  t.is(value._value, 105)
  value._value = 7
  t.is(value[valueKey], 107)
  t.is(value._value, 207)
  t.is(value[method](), 108)
  t.is(value['_method'](), 308)
  t.is(SymbolNamedClass[method](8), 9)
  const factoryValue = SymbolNamedClass[Symbol.for('napi.test.factory')](9)
  t.true(factoryValue instanceof SymbolNamedClass)
  t.is(factoryValue[valueKey], 9)
})

test('symbol fields support setters, readonly fields and generated constructors', (t) => {
  const value = new SymbolNamedClass(4)
  t.is(value[field], 4)
  value[field] = 6
  t.is(value[field], 6)
  const readonly = Symbol.for('napi.test.readonly')
  t.is(value[readonly], 4)
  t.throws(
    () => {
      value[readonly] = 7
    },
    { instanceOf: TypeError },
  )
  const generated = new SymbolNamedFields(8, 'test')
  t.is(generated[Symbol.for('napi.test.autoField')], 8)
  t.is(generated.label, 'test')
  t.is(generated.value, undefined)
})

test('symbol names are exact registry keys, including empty, Unicode and NUL keys', (t) => {
  const value = new SymbolNamedClass(12)
  t.is(value[Symbol.for('')](), 12)
  t.is(value[Symbol.for('内部\0属性')], 12)
  t.is(value[Symbol.for('napiTestField')], undefined)
  t.is(value[Symbol('napi.test.field')], undefined)
})

test('symbols are absent from string lookup and enumeration but remain reflectable', (t) => {
  const value = new SymbolNamedClass(3)
  const prototype = SymbolNamedClass.prototype
  for (const key of [
    'napi.test.field',
    'napi.test.readonly',
    'staticMethod',
    'increment',
    'field',
  ]) {
    t.is(value[key], undefined)
    t.false(key in value)
    t.false(Object.keys(prototype).includes(key))
    t.false(Object.getOwnPropertyNames(prototype).includes(key))
  }
  const keys = []
  for (const key in value) keys.push(key)
  t.deepEqual(keys.sort(), ['_method', '_value'])
  t.deepEqual(Object.keys(value), [])
  t.is(JSON.stringify(value), '{}')
  t.true(Object.getOwnPropertySymbols(prototype).includes(valueKey))
  t.true(Reflect.ownKeys(prototype).includes(field))
  const accessor = Object.getOwnPropertyDescriptor(prototype, valueKey)
  t.is(typeof accessor.get, 'function')
  t.is(typeof accessor.set, 'function')
  t.false(accessor.enumerable)
  const descriptor = Object.getOwnPropertyDescriptor(prototype, method)
  t.false(descriptor.writable)
  t.false(descriptor.configurable)
})

test('symbol registrations work in concurrent workers and after worker teardown', async (t) => {
  const filename = fileURLToPath(new URL('../index.cjs', import.meta.url))
  async function runWorker() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        `
        const { parentPort, workerData } = require('node:worker_threads')
        const { SymbolNamedClass } = require(workerData)
        const value = new SymbolNamedClass(10)
        value[Symbol.for('_value')] = 20
        parentPort.postMessage([value[Symbol.for('_value')], value[Symbol.for('napi.test.field')]])
      `,
        { eval: true, workerData: filename },
      )
      let result
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
  t.deepEqual(await Promise.all([runWorker(), runWorker()]), [
    [20, 10],
    [20, 10],
  ])
  t.deepEqual(await runWorker(), [20, 10])
  t.is(new SymbolNamedClass(30)[valueKey], 30)
})

test('declarations omit symbol members and retain constructor arguments', async (t) => {
  const declarations = await readFile(
    new URL('../index.d.cts', import.meta.url),
    'utf8',
  )
  const classBody = declarations.match(
    /export declare class SymbolNamedClass \{([^}]+)\}/,
  )[1]
  t.is(classBody.trim(), 'constructor(value: number)')
  const fieldsBody = declarations.match(
    /export declare class SymbolNamedFields \{([^}]+)\}/,
  )[1]
  t.regex(fieldsBody, /constructor\(value: number, label: string\)/)
  t.notRegex(fieldsBody, /^\s+value:/m)
})
