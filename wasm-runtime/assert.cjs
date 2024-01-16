function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed')
  }
}

module.exports = assert

module.exports.strictEqual = function strictEqual(a, b) {
  if (a !== b) {
    throw new Error(`Expected ${a} to strict equal ${b}`)
  }
}
