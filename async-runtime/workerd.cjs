'use strict'

const {
  registerWorkerdCurrentThreadTaskHost,
} = require('./workerd-task-host.cjs')
const { registerWorkerdTimerHost } = require('./workerd-timer-host.cjs')

module.exports = {
  registerWorkerdCurrentThreadTaskHost,
  registerWorkerdTimerHost,
}
