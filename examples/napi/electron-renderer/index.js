const { ipcRenderer } = require('electron')

const { callThreadsafeFunction } = require('../index')

callThreadsafeFunction(() => {})

ipcRenderer.on('ping', () => ipcRenderer.send('pong'))
