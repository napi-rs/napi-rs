const { ipcRenderer } = require('electron')

const {
  callLongThreadsafeFunction,
  asyncTaskCounted,
  asyncTaskPromiseSettleMode,
  asyncTaskSettleCounters,
} = require('../index.cjs')

callLongThreadsafeFunction(() => {})

ipcRenderer.on('ping', async () => {
  const before = asyncTaskSettleCounters()
  const value = await asyncTaskCounted()
  ipcRenderer.send('pong', {
    mode: asyncTaskPromiseSettleMode(),
    value,
    statesFreed:
      asyncTaskSettleCounters().promiseStatesFreed - before.promiseStatesFreed,
  })
})
