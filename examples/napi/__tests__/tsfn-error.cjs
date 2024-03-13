const { threadsafeFunctionFatalModeError } = require('../index.cjs')

threadsafeFunctionFatalModeError(() => {
  return false
})
