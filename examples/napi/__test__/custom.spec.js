const { callThreadsafeFunction } = require('..')

callThreadsafeFunction(() => {
  return 123
})
