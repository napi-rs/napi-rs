import { Buffer } from 'buffer'

import { describe, it, expect } from 'vitest'

global.Buffer = Buffer

// @ts-expect-error
const {
  // @ts-expect-error
  __fs,
  DEFAULT_COST,
  Bird,
  GetterSetterWithClosures,
  tsfnReturnPromise,
  tsfnReturnPromiseTimeout,
  asyncTaskReadFile,
}: typeof import('../index.cjs') = await import('../example.wasi-browser')

describe('NAPI-RS wasi browser test', function () {
  it('DEFAULT_COST', function () {
    expect(DEFAULT_COST).toBe(12)
  })

  it('async self in class', async function () {
    const b = new Bird('foo')
    expect(await b.getNameAsync()).toBe('foo')
  })

  it('Class with getter setter closures', () => {
    const instance = new GetterSetterWithClosures()
    // @ts-expect-error
    instance.name = 'Allie'
    // @ts-expect-error
    expect(instance.name).toBe(`I'm Allie`)
    // @ts-expect-error
    expect(instance.age).toBe(0.3)
  })

  it('threadsafe function return Promise and await in Rust', async () => {
    const value = await tsfnReturnPromise((err, value) => {
      if (err) {
        throw err
      }
      return Promise.resolve(value + 2)
    })
    expect(value).toBe(5)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    expect(
      tsfnReturnPromiseTimeout((err, value) => {
        if (err) {
          throw err
        }
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(value + 2)
          }, 300)
        })
      }),
    ).rejects.toMatchObject(new Error('Timeout'))
    // trigger Promise.then in Rust after `Promise` is dropped
    await new Promise((resolve) => setTimeout(resolve, 400))
  })

  it('readFileAsync', async () => {
    __fs.writeFileSync('/test.txt', 'hello world')
    const value = await asyncTaskReadFile('/test.txt')
    expect(value.toString('utf8')).toBe('hello world')
  })
})
