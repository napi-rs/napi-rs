import('../index.js').then(
  ({ default: { threadsafeFunctionFatalModeError } }) => {
    return threadsafeFunctionFatalModeError(() => {})
  },
)
