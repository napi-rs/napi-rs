const { bun } = process.versions

/**@type {import('ava').TestFn} */
let testRunner

if (bun) {
  const { test, expect } = await import('./bun-test.js')
  const testContext = {
    is: (actual, expected) => {
      expect(actual).toEqual(expected)
    },
    deepEqual: (actual, expected) => {
      expect(actual).toEqual(expected)
    },
    throws: (fn, expected) => {
      if (expected) {
        expect(fn).toThrow(expected)
      } else {
        expect(fn).toThrow()
      }
    },
    notThrows: (fn, expected) => {
      if (expected) {
        expect(fn).not.toThrow(expected)
      } else {
        expect(fn).not.toThrow()
      }
    },
    throwsAsync: async (fn, expected) => {
      if (expected) {
        expect(fn instanceof Promise ? fn : await fn()).rejects.toEqual(
          expected,
        )
      } else {
        expect(fn instanceof Promise ? fn : await fn()).rejects.toBeTruthy()
      }
    },
    notThrowsAsync: async (fn, expected) => {
      if (expected) {
        expect(fn instanceof Promise ? fn : await fn()).resolves.toBe(expected)
      } else {
        expect(fn instanceof Promise ? fn : await fn()).resolves.toBeTruthy()
      }
    },
    true: (actual, message) => {
      expect(actual).toBe(true, message)
    },
    false: (actual, message) => {
      expect(actual).toBe(false, message)
    },
  }
  testRunner = (title, spec) => {
    test(title, async () => {
      await Promise.resolve(spec(testContext))
    })
  }
  testRunner.skip = (label, fn) => {
    test.skip(label, () => {
      fn(testContext)
    })
  }
} else {
  const test = (await import('ava')).default
  testRunner = test
}

export { testRunner as test }
