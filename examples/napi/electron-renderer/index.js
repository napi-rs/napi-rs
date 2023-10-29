const { ipcRenderer } = require('electron')

const { callLongThreadsafeFunction } = require('../index.node')

callLongThreadsafeFunction(() => {})

ipcRenderer.on('ping', () => ipcRenderer.send('pong'))
