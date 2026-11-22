const { ipcRenderer } = require('electron')

const {
  callLongThreadsafeFunction,
  asyncFnSleep,
  asyncTaskCounted,
  asyncTaskPromiseSettleMode,
  asyncTaskSettleCounters,
} = require('../index.cjs')

callLongThreadsafeFunction(() => {})

// The page's Content Security Policy blocks `eval`.
function evalBlocked() {
  try {
    // oxlint-disable-next-line no-eval
    eval('0')
    return false
  } catch (error) {
    return error instanceof EvalError
  }
}

ipcRenderer.on('ping', async () => {
  const before = asyncTaskSettleCounters()
  const value = await asyncTaskCounted()
  const after = asyncTaskSettleCounters()
  // An async fn promise is made by the same wrapper.
  const asyncFnValue = await asyncFnSleep(1)
  const end = asyncTaskSettleCounters()
  ipcRenderer.send('pong', {
    mode: asyncTaskPromiseSettleMode(),
    value,
    statesFreed: after.promiseStatesFreed - before.promiseStatesFreed,
    evalBlocked: evalBlocked(),
    // This env's first task compiled its promise wrapper, under that policy.
    wrappersCompiled:
      after.promiseWrappersCompiled - before.promiseWrappersCompiled,
    wrapperFallbacks:
      after.promiseWrapperFallbacks - before.promiseWrapperFallbacks,
    asyncFnValue,
    asyncFnThenable:
      end.jsDeferredThenableCreated - after.jsDeferredThenableCreated,
    asyncFnFallbacks: end.jsDeferredFallbacks - after.jsDeferredFallbacks,
    asyncFnStatesFreed: end.promiseStatesFreed - after.promiseStatesFreed,
  })
})
