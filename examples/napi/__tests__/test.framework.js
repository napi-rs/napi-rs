const { bun } = process.versions

/**@type {import('ava').TestFn} */
let testRunner

if (bun) {
  const { test, expect, afterAll, afterEach, beforeAll, beforeEach } =
    await import('./bun-test.js')
  const testContext = {
    is: (actual, expected) => {
      expect(actual).toEqual(expected)
    },
    not: (actual, expected) => {
      expect(actual).not.toEqual(expected)
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
        expect(
          async () => await (typeof fn === 'function' ? fn() : fn),
        ).toThrow(expected)
      } else {
        expect(
          async () => await (typeof fn === 'function' ? fn() : fn),
        ).toThrow()
      }
    },
    notThrowsAsync: async (fn, expected) => {
      if (expected) {
        expect(
          async () => await (typeof fn === 'function' ? fn() : fn),
        ).not.toThrow(expected)
      } else {
        expect(
          async () => await (typeof fn === 'function' ? fn() : fn),
        ).not.toThrow()
      }
    },
    true: (actual, message) => {
      expect(actual).toBe(true, message)
    },
    false: (actual, message) => {
      expect(actual).toBe(false, message)
    },
    pass: () => {
      expect(true).toBe(true)
    },
    fail: () => {
      expect(true).toBe(false)
    },
    regex: (actual, expected) => {
      expect(actual).toMatch(expected)
    },
    snapshot: (..._args) => {
      // TODO: Ignore snapshots test at this moment
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
  testRunner.after = (fn) => {
    afterAll(fn)
  }
  testRunner.before = (fn) => {
    beforeAll(fn)
  }
  testRunner.afterEach = (fn) => {
    afterEach(fn)
  }
  testRunner.beforeEach = (fn) => {
    beforeEach(fn)
  }
} else {
  const test = (await import('ava')).default
  testRunner = test
}

export { testRunner as test }
