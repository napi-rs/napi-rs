const { ipcRenderer } = require('electron')

const { callLongThreadsafeFunction } = require('../index.cjs')

callLongThreadsafeFunction(() => {})

ipcRenderer.on('ping', () => ipcRenderer.send('pong'))
