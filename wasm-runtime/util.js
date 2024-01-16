import { inspect, format } from 'node-inspect-extracted'

function isBuffer(arg) {
  return (
    arg &&
    typeof arg === 'object' &&
    typeof arg.copy === 'function' &&
    typeof arg.fill === 'function' &&
    typeof arg.readUInt8 === 'function'
  )
}

// borrow from https://github.com/isaacs/inherits
function inherits(ctor, superCtor) {
  if (superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true,
      },
    })
  }
}

export { inherits, inspect, format, isBuffer }
