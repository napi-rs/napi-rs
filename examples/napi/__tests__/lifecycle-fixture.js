export const lifecycleFixtureGlobal = '__NAPI_RS_LIFECYCLE_FIXTURE__'
export const lifecycleFixtureTokenProperty = '__napiRsLifecycleFixtureToken'
export const lifecycleFixtureToken = 'napi-rs-internal-lifecycle-fixture-v1'

export function requireLifecycleFixture(
  require,
  specifier,
  configuration = {},
) {
  const fixture = {
    [lifecycleFixtureTokenProperty]: lifecycleFixtureToken,
    ...configuration,
  }
  const initialKeyCount = Object.keys(fixture).length
  globalThis[lifecycleFixtureGlobal] = fixture
  try {
    const binding = require(specifier)
    if (globalThis[lifecycleFixtureGlobal] !== fixture) {
      throw new Error('lifecycle fixture global was replaced during addon load')
    }
    if (Object.keys(fixture).length === initialKeyCount) {
      throw new Error(
        'addon was already loaded before the lifecycle fixture was installed',
      )
    }
    return { binding, fixture }
  } finally {
    delete globalThis[lifecycleFixtureGlobal]
  }
}
