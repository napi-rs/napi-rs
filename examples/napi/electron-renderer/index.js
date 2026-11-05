const { ipcRenderer } = require('electron')

const {
  callLongThreadsafeFunction,
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
  })
})
