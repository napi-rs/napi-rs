import('../index.cjs').then(
  ({ threadsafeFunctionFatalModeError }) => {
    return threadsafeFunctionFatalModeError(() => {})
  },
)
