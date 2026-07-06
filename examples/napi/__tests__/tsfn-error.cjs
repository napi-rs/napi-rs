const {
  threadsafeFunctionFatalModeError,
  threadsafeFunctionRustPanic,
} = require('../index.cjs')

if (process.argv[2] === 'rust-panic') {
  threadsafeFunctionRustPanic(() => {})
} else {
  threadsafeFunctionFatalModeError(() => {
    return false
  })
}
